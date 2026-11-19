import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";
import { mentionsName, type Rewrite } from "./candidates.ts";
import { loadDesignSystem, postClassValues, resolveCssPath, takeRewrites } from "./design-system.ts";

export const PLUGIN_NAME = "deslop";
export const RULE_ID = "canonical-class-names";

const DEFAULT_ATTRIBUTES: ReadonlyArray<string> = ["class", "className"];
const DEFAULT_CALLEE_FUNCTIONS: ReadonlyArray<string> = ["cn", "clsx", "cva", "twMerge", "tw", "classNames", "cx"];
const DEFAULT_ROOT_FONT_SIZE = 16;
const NON_WHITESPACE = /\S/;
const CHUNK_SIZE = 8;

interface RuleOptions {
	cssPath: string;
	rootFontSize?: number;
	attributes?: Array<string>;
	calleeFunctions?: Array<string>;
}

const OPTIONS_SCHEMA = {
	type: "object",
	properties: {
		cssPath: { type: "string", description: "Path to the Tailwind v4 entry CSS." },
		rootFontSize: { type: "number", description: "Root font size in px used for rem normalization." },
		attributes: { type: "array", items: { type: "string" }, description: "JSX class-list attributes." },
		calleeFunctions: { type: "array", items: { type: "string" }, description: "Class-list helper functions." },
	},
	required: ["cssPath"],
	additionalProperties: false,
} as const;

type StringNode = ESTree.StringLiteral | ESTree.TemplateLiteral;

export const canonicalClassNames = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Enforce canonical Tailwind CSS class spellings." },
		fixable: "code",
		messages: {
			nonCanonical: "Tailwind class '{{original}}' can be written as '{{canonical}}'.{{suffix}}",
			cssNotFound: "Could not load Tailwind CSS entry file: {{path}}",
		},
		schema: [OPTIONS_SCHEMA],
	},
	createOnce(context) {
		// The option lists are short, so linear search beats hashing them into a Set for every file.
		let attributes = DEFAULT_ATTRIBUTES;
		let callees = DEFAULT_CALLEE_FUNCTIONS;
		let options: Partial<RuleOptions> = {};
		let file = "";
		let rem = DEFAULT_ROOT_FONT_SIZE;
		let preloaded = false;
		// Class strings in this file, in source order. They go to the worker while the traversal
		// continues: the first at once, then in chunks. `chunkEnds` marks where each posted chunk ends.
		const nodes: Array<StringNode> = [];
		const values: Array<string> = [];
		const chunkEnds: Array<number> = [];
		let posted = 0;
		let outstanding = 0;

		function cssFile(): string {
			try {
				return resolveCssPath(options.cssPath);
			} catch {
				return options.cssPath ?? "";
			}
		}

		function post(end: number) {
			if (posted === 0) {
				file = cssFile();
				// Pick up CSS changes once per file, before its first strings.
				loadDesignSystem(file);
			}
			postClassValues(file, values.slice(posted, end), rem);
			chunkEnds.push(end);
			posted = end;
			outstanding++;
		}

		function collect(node: StringNode, value: string) {
			if (!NON_WHITESPACE.test(value)) return;
			nodes.push(node);
			values.push(value);
			if (posted === 0 || values.length - posted === CHUNK_SIZE) post(values.length);
		}

		function report(node: StringNode, rewrite: Rewrite | null) {
			if (rewrite === null) return;
			const [fixed, original, canonical, changes] = rewrite;
			context.report({
				node,
				messageId: "nonCanonical",
				data: { original, canonical, suffix: changes > 1 ? ` (+${changes - 1} more in this string)` : "" },
				fix(fixer) {
					const first = context.sourceCode.getText(node)[0];
					const quote = first === "'" || first === '"' || first === "`" ? first : '"';
					return fixer.replaceText(node, `${quote}${fixed}${quote}`);
				},
			});
		}

		// `undefined` means the worker failed on this chunk; its strings are skipped.
		function take(): ReturnType<typeof takeRewrites> | undefined {
			outstanding--;
			try {
				return takeRewrites();
			} catch {
				return undefined;
			}
		}

		function collectExpression(node: ESTree.Expression | ESTree.JSXEmptyExpression) {
			if (node.type === "Literal" && typeof node.value === "string") collect(node, node.value);
			else if (node.type === "TemplateLiteral" && node.expressions.length === 0 && node.quasis.length === 1) {
				collect(node, node.quasis[0].value.raw);
			}
		}

		return {
			before() {
				// A file whose lint stopped early leaves results behind; drop them to stay in step.
				while (outstanding > 0) take();
				options = (context.options?.[0] ?? {}) as Partial<RuleOptions>;
				attributes = options.attributes ?? DEFAULT_ATTRIBUTES;
				callees = options.calleeFunctions ?? DEFAULT_CALLEE_FUNCTIONS;
				rem = options.rootFontSize ?? DEFAULT_ROOT_FONT_SIZE;
				nodes.length = 0;
				values.length = 0;
				chunkEnds.length = 0;
				posted = 0;
				// Tailwind takes a while to load; start it in the background on the first file.
				if (!preloaded) {
					preloaded = true;
					loadDesignSystem(cssFile());
				}
				// Every checked string is in an attribute or call with one of these names.
				const text = context.sourceCode.text;
				return attributes.some(name => mentionsName(text, name)) || callees.some(name => mentionsName(text, name));
			},
			JSXAttribute(node) {
				if (node.name.type !== "JSXIdentifier" || !attributes.includes(node.name.name) || !node.value) return;
				if (node.value.type === "Literal" && typeof node.value.value === "string") collect(node.value, node.value.value);
				else if (node.value.type === "JSXExpressionContainer") collectExpression(node.value.expression);
			},
			CallExpression(node) {
				let name: string | null = null;
				if (node.callee.type === "Identifier") name = node.callee.name;
				else if (node.callee.type === "MemberExpression" && !node.callee.computed && node.callee.property.type === "Identifier") name = node.callee.property.name;
				if (name === null || !callees.includes(name)) return;
				for (const arg of node.arguments) if (arg.type === "Literal" || arg.type === "TemplateLiteral") collectExpression(arg);
			},
			"Program:exit"() {
				if (values.length === 0) return;
				if (posted < values.length) post(values.length);
				let start = 0;
				for (const end of chunkEnds) {
					const rewrites = take();
					if (rewrites === null) {
						for (let i = start; i < end; i++) context.report({ node: nodes[i], messageId: "cssNotFound", data: { path: file } });
					} else if (rewrites !== undefined) {
						for (let i = start; i < end; i++) report(nodes[i], rewrites[i - start]);
					}
					start = end;
				}
			},
		};
	},
});
