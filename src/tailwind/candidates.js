/**
 * Pure string helpers for canonical Tailwind class replacement.
 *
 * These functions are intentionally free of any Tailwind / ESLint / oxlint
 * dependencies so they are trivially unit-testable. The fixer strategy is
 * deliberately minimal: only the spelling of individual class candidates is
 * replaced. Whitespace, ordering, and duplicates are left untouched — class
 * sorting/dedup belongs to the formatter (oxfmt `sortTailwindcss`), not the
 * linter.
 */

/**
 * @typedef {{ original: string, canonical: string }} SpellingChange
 */

/**
 * Replace every whitespace-separated token in `value` according to
 * `canonicalOf` (token -> canonical spelling), preserving the original
 * separators byte-for-byte.
 *
 * @param {string} value the raw class string (without surrounding quotes)
 * @param {Map<string, string>} canonicalOf canonical spelling per token
 * @returns {{ fixed: string, changes: SpellingChange[] }}
 */
export function rewriteClassValue(value, canonicalOf) {
  /** @type {SpellingChange[]} */
  const changes = [];
  const fixed = value.replace(/\S+/g, (token) => {
    const canonical = canonicalOf.get(token);
    if (canonical !== undefined && canonical !== token) {
      changes.push({ original: token, canonical });
      return canonical;
    }
    return token;
  });
  return { fixed, changes };
}

/**
 * Collect the unique whitespace-separated tokens of a class string, in order
 * of first appearance. `canonicalizeCandidates` de-duplicates its output, so
 * callers must de-duplicate inputs first to keep input/output aligned.
 *
 * @param {string} value
 * @returns {string[]}
 */
export function uniqueTokens(value) {
  const tokens = value.match(/\S+/g) ?? [];
  return [...new Set(tokens)];
}

/**
 * Build a one-line human summary of the changes, mirroring the language
 * server's "The class `X` can be written as `Y`" phrasing.
 *
 * @param {SpellingChange[]} changes
 * @returns {{ original: string, canonical: string, suffix: string }}
 */
export function summarizeChanges(changes) {
  const first = changes[0];
  return {
    original: first.original,
    canonical: first.canonical,
    suffix: changes.length > 1 ? ` (+${changes.length - 1} more in this string)` : '',
  };
}
