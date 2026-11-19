import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { preferLiteralUnionRule } from "../src/rules/prefer-literal-union.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
	languageOptions: { parserOptions: { lang: "tsx" } },
});

function message(name: string, type: string, literals: string, union: string): string {
	return `\`${name}\` is typed \`${type}\` but is only compared to ${literals}. Type it as a literal union, such as \`${union}\`, or a named union type. Before you create a new type or inline one, search the codebase for an existing type for these values.`;
}

const ab = message("x", "string", '"a" and "b"', '"a" | "b"');

ruleTester.run("prefer-literal-union", preferLiteralUnionRule, {
	valid: [
		{
			name: "keeps same-named variables apart when each is compared to one literal",
			code: 'function f(x: string) { return x === "a"; }\nfunction g(x: string) { return x === "b"; }',
		},
		'function f(x: "a" | "b") { if (x === "a") return 1; if (x === "b") return 2; }',
		'type Mode = "a" | "b"; function f(x: Mode) { if (x === "a") return 1; if (x === "b") return 2; }',
		'import type { Props } from "./props"; function F({ x }: Props) { if (x === "a") return 1; if (x === "b") return 2; }',
		'const x = read(); if (x === "a" || x === "b") run();',
		'function f(x: string) { if (x === "a") return 1; if (x === "a") return 2; }',
		'function f(x: string, y: string) { return x === "a" || y === "b"; }',
		// Interpolated templates are not fixed values.
		'function f(x: string, y: string) { return x === `a${y}` || x === "b"; }',
		// Comparisons to non-literals do not count.
		'function f(x: string, a: string, b: string) { return x === a || x === b; }',
		// Ordering operators do not imply a closed set.
		'function f(x: string) { return x < "a" || x > "b"; }',
		// A shadowing binding with another type owns its comparisons.
		'function f(x: string) { if (x === "a") return 1; return ((x: number) => x === 1)(2); }',
		// A local type that shadows an outer props type is not resolved.
		'type Props = { x: string }; function g() { type Props = { x: "a" | "b" }; return ({ x }: Props) => x === "a" || x === "b"; }',
		// useState without a type argument is inferred.
		'const [x] = useState("a"); if (x === "a" || x === "b") run();',
		// Other unions are not plain strings.
		'function f(x: string | number) { return x === "a" || x === "b"; }',
	],
	invalid: [
		{
			code: 'function f(x: string) { if (x === "a") return 1; if (x === "b") return 2; }',
			errors: [{ message: ab, line: 1, column: 11 }],
		},
		{
			code: 'function f(x: string | null) { return x === "a" || x === "b"; }',
			errors: [{ message: message("x", "string | null", '"a" and "b"', '"a" | "b" | null') }],
		},
		{
			code: 'function F({ x }: { x: string }) { return x === "a" ? 1 : x === "b" ? 2 : 3; }',
			errors: [{ message: ab, column: 13 }],
		},
		{
			code: 'type Props = { x: string };\nfunction F({ x }: Props) { if (x === "a") return 1; if (x === "b") return 2; }',
			errors: [{ message: ab, line: 2 }],
		},
		{
			code: 'interface Props { x: string }\nfunction F({ x }: Props) { if (x === "a") return 1; if (x === "b") return 2; }',
			errors: [{ message: ab, line: 2 }],
		},
		{
			code: 'const [x] = useState<string | null>(null);\nswitch (x) { case "a": break; case "b": break; }',
			errors: [{ message: message("x", "string | null", '"a" and "b"', '"a" | "b" | null'), line: 1, column: 7 }],
		},
		{
			code: 'const [x] = React.useState<string>("");\nif (x === "a" || x === "b") run();',
			errors: [{ message: ab }],
		},
		{
			code: 'let x: string = read();\nconst n = x === "a" ? 1 : x === "b" ? 2 : 3;',
			errors: [{ message: ab, line: 1, column: 4 }],
		},
		{
			code: 'function f(x: string) { return "a" === x || "b" === x; }',
			errors: [{ message: ab }],
		},
		{
			code: 'function f(x: string) { if (x === "a") return 1; return x === "b" ? 2 : 3; }',
			errors: [{ message: ab }],
		},
		{
			code: 'const f = (x: string) => x !== "a" && x != `b`;',
			errors: [{ message: ab }],
		},
		{
			code: 'const f = (x: string = "a") => x == "a" || x == "b";',
			errors: [{ message: ab }],
		},
		{
			code: 'function F({ x: mode }: { x?: string | undefined }) { return mode === "a" || mode === "b"; }',
			errors: [{ message: message("mode", "string | undefined", '"a" and "b"', '"a" | "b" | undefined') }],
		},
		{
			code: 'function f(x: string) { if (x === "b") return 1; if (x === "a") return 2; return x === "c" || x === "b"; }',
			errors: [{ message: message("x", "string", '"b", "a", and "c"', '"b" | "a" | "c"') }],
		},
		{
			code: 'function f(dialog: string) { if (dialog === "edit") return "Edit"; if (dialog === "archive") return "Archive"; return ""; }',
			errors: [{ message: message("dialog", "string", '"edit" and "archive"', '"edit" | "archive"') }],
		},
	],
});
