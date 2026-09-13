/**
 * `tailwind-canonical/canonical-class-names` — enforce canonical Tailwind
 * CSS class spellings with an auto-fixer.
 *
 * Source of truth: Tailwind v4's `designSystem.canonicalizeCandidates()`,
 * the same API behind the Tailwind language server's
 * `suggestCanonicalClasses` diagnostic (what you see as "The class `X` can
 * be written as `Y`" quick-fixes in the editor) and the
 * `tailwindcss canonicalize` CLI. This rule brings those suggestions into
 * `oxlint` so `oxlint --fix` applies them across the repo instead of
 * clicking through them one by one.
 *
 * Intentionally out of scope (owned by the formatter, oxfmt
 * `sortTailwindcss`): class ordering, whitespace normalization,
 * de-duplication, and multi-utility collapsing (`mt-2 mr-2 …` -> `m-2`).
 * The fixer only rewrites the spelling of individual candidates.
 *
 * Performance notes (see "Writing JS Plugins" in the oxlint docs):
 * - The rule uses the `createOnce` API: `createOnce` runs a single time and
 *   the returned visitor is reused for every file. All per-file setup lives
 *   in `before()`. `plugin.js` wraps the plugin in `eslintCompatPlugin`,
 *   which adds an ESLint-compatible `create` delegating to `createOnce`.
 * - `before()` returns `false` to skip files whose text cannot contain a
 *   class list (no configured attribute/callee name present), avoiding AST
 *   traversal entirely for those files. This is sound: both visitors only
 *   fire on nodes whose attribute/callee name appears literally in source.
 * - The rule keeps no per-file state on the shared `context` object (oxlint
 *   reuses one context across files); module-level caches are keyed by
 *   stylesheet path + mtime.
 */
import { defineRule } from '@oxlint/plugins';
import { rewriteClassValue, summarizeChanges, uniqueTokens } from './candidates.js';
import { canonicalizeTokens, ensureDesignSystem, resolveCssPath } from './design-system.js';

export const PLUGIN_NAME = 'tailwind-canonical';
export const RULE_ID = 'canonical-class-names';

const DEFAULT_ATTRIBUTES = ['class', 'className'];
const DEFAULT_CALLEE_FUNCTIONS = ['cn', 'clsx', 'cva', 'twMerge', 'tw', 'classNames', 'cx'];
const DEFAULT_ROOT_FONT_SIZE = 16;

/**
 * @typedef {{ cssPath: string, rootFontSize?: number, attributes?: string[], calleeFunctions?: string[] }} RuleOptions
 */

/** @type {import("@oxlint/plugins").RuleOptionsSchema} */
const OPTIONS_SCHEMA = {
  type: 'object',
  properties: {
    cssPath: {
      type: 'string',
      description:
        'Path to the Tailwind v4 entry CSS (absolute, or relative to the working directory).',
    },
    rootFontSize: {
      type: 'number',
      description: 'Root font size in px used for rem<->px normalization.',
    },
    attributes: {
      type: 'array',
      items: { type: 'string' },
      description: 'JSX attribute names treated as class lists.',
    },
    calleeFunctions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Function names whose string arguments are treated as class lists.',
    },
  },
  required: ['cssPath'],
  additionalProperties: false,
};

export const canonicalClassNames = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        "Enforce canonical Tailwind CSS class spellings (same source of truth as the Tailwind language server's suggestCanonicalClasses).",
    },
    fixable: 'code',
    messages: {
      nonCanonical: "Tailwind class '{{original}}' can be written as '{{canonical}}'.{{suffix}}",
      cssNotFound: 'Could not load Tailwind CSS entry file: {{path}}',
    },
    schema: [OPTIONS_SCHEMA],
  },

  createOnce(context) {
    // Per-file state. NEVER access `context.*` here: file-bound properties
    // (options, sourceCode, report, …) are unset until `before()`/visitors.
    /** @type {Set<string>} */
    let attributes = new Set(DEFAULT_ATTRIBUTES);
    /** @type {Set<string>} */
    let callees = new Set(DEFAULT_CALLEE_FUNCTIONS);
    /** @type {number} */
    let rem = DEFAULT_ROOT_FONT_SIZE;
    /** @type {string} */
    let cssFile = '';
    /** @type {string | false | null} Resolved design key; null = not attempted, false = failed. */
    let designKey = null;
    /** @type {boolean} */
    let initialized = false;

    function initFile() {
      const options = /** @type {RuleOptions} */ (context.options?.[0] ?? {});
      attributes = new Set(options.attributes ?? DEFAULT_ATTRIBUTES);
      callees = new Set(options.calleeFunctions ?? DEFAULT_CALLEE_FUNCTIONS);
      rem = options.rootFontSize ?? DEFAULT_ROOT_FONT_SIZE;
      try {
        cssFile = resolveCssPath(options.cssPath);
      } catch {
        cssFile = options.cssPath ?? '';
      }
      designKey = null;
      initialized = true;
    }

    /** @returns {string | null} */
    function getDesignKey() {
      if (designKey === null) {
        try {
          designKey = ensureDesignSystem(cssFile);
        } catch {
          designKey = false;
        }
      }
      return designKey === false ? null : designKey;
    }

    /** @returns {string} first quote char (`'`, `"`, or backtick) */
    function getQuoteChar(
      /** @type {import("@oxlint/plugins").ESTree.StringLiteral | import("@oxlint/plugins").ESTree.TemplateLiteral} */ node
    ) {
      const first = context.sourceCode.getText(node)[0];
      return first === "'" || first === '"' || first === '`' ? first : '"';
    }

    /**
     * Check one string-like node and report (with fix) when any candidate
     * has a non-canonical spelling.
     */
    function checkStringNode(
      /** @type {import("@oxlint/plugins").ESTree.StringLiteral | import("@oxlint/plugins").ESTree.TemplateLiteral} */ node,
      /** @type {string} */ value
    ) {
      const tokens = uniqueTokens(value);
      if (tokens.length === 0) return;

      const key = getDesignKey();
      if (key === null) {
        context.report({ node, messageId: 'cssNotFound', data: { path: cssFile } });
        return;
      }

      let canonicalOf;
      try {
        canonicalOf = canonicalizeTokens(key, tokens, rem);
      } catch {
        return;
      }
      const { fixed, changes } = rewriteClassValue(value, canonicalOf);
      if (changes.length === 0) return;

      const summary = summarizeChanges(changes);
      context.report({
        node,
        messageId: 'nonCanonical',
        data: summary,
        fix(fixer) {
          const quote = getQuoteChar(node);
          return fixer.replaceText(node, `${quote}${fixed}${quote}`);
        },
      });
    }

    function checkExpression(
      /** @type {import("@oxlint/plugins").ESTree.Expression | import("@oxlint/plugins").ESTree.JSXEmptyExpression} */ node
    ) {
      if (node.type === 'Literal' && typeof node.value === 'string') {
        checkStringNode(node, node.value);
      } else if (
        node.type === 'TemplateLiteral' &&
        node.expressions.length === 0 &&
        node.quasis.length === 1
      ) {
        // Static template only. Templates with interpolations are skipped:
        // a replacement could shift `${}` boundaries.
        checkStringNode(node, node.quasis[0].value.raw);
      }
    }

    return {
      before() {
        initFile();
        // Skip files that cannot contain a class list. Sound: `JSXAttribute`
        // only fires for a configured attribute name and `CallExpression`
        // only for a configured callee — both appear literally in source.
        const text = context.sourceCode.text;
        for (const name of attributes) {
          if (name !== '' && text.includes(name)) return;
        }
        for (const name of callees) {
          if (name !== '' && text.includes(name)) return;
        }
        return false;
      },

      JSXAttribute(node) {
        if (!initialized) initFile();
        if (node.name.type !== 'JSXIdentifier' || !attributes.has(node.name.name)) return;
        const value = node.value;
        if (!value) return;
        if (value.type === 'Literal' && typeof value.value === 'string') {
          checkStringNode(value, value.value);
        } else if (value.type === 'JSXExpressionContainer') {
          checkExpression(value.expression);
        }
      },

      CallExpression(node) {
        if (!initialized) initFile();
        const callee = node.callee;
        /** @type {string | null} */
        let name = null;
        if (callee.type === 'Identifier') {
          name = callee.name;
        } else if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier'
        ) {
          name = callee.property.name;
        }
        if (name === null || !callees.has(name)) return;
        for (const arg of node.arguments) {
          if (arg.type === 'Literal' || arg.type === 'TemplateLiteral') {
            checkExpression(arg);
          }
        }
      },
    };
  },
});
