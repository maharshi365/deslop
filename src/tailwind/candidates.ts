/** A class string with every non-canonical token replaced, plus its first change and change count. */
export type Rewrite = readonly [fixed: string, original: string, canonical: string, changes: number];

const TOKEN = /\S+/g;

/** Rewrite each whitespace-separated class token. Returns null when every token is canonical. */
export function rewriteClassValue(value: string, canonicalize: (token: string) => string): Rewrite | null {
	let fixed = "";
	let end = 0;
	let changes = 0;
	let original = "";
	let canonical = "";
	for (const match of value.matchAll(TOKEN)) {
		const token = match[0];
		const replacement = canonicalize(token);
		if (replacement === token) continue;
		if (changes++ === 0) {
			original = token;
			canonical = replacement;
		}
		fixed += value.slice(end, match.index) + replacement;
		end = match.index + token.length;
	}
	return changes === 0 ? null : [fixed + value.slice(end), original, canonical, changes];
}

/** Whether `text` contains `name` with no ASCII identifier character on either side. */
export function mentionsName(text: string, name: string): boolean {
	if (name === "") return false;
	for (let index = text.indexOf(name); index !== -1; index = text.indexOf(name, index + 1)) {
		if (!isIdentifierCode(text.charCodeAt(index - 1)) && !isIdentifierCode(text.charCodeAt(index + name.length))) return true;
	}
	return false;
}

// NaN (out of range) and non-ASCII codes count as boundaries, so a real occurrence is never missed.
function isIdentifierCode(code: number): boolean {
	return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 36 || code === 95;
}
