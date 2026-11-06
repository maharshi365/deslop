import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { maxBooleanConditionsRule } from "../src/rules/max-boolean-conditions.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
});

ruleTester.run("max-boolean-conditions", maxBooleanConditionsRule, {
	valid: [
		"if (a && b && c) {}",
		"if (a && b && (c || d || e || f)) {}",
		"if ((a && b && c && d) || e) {}",
		"if (((a && b && c))) {}",
		"if (!(a && b && c && d)) {}",
		"if (check(a && b && c && d)) {}",
		"const eligible = a && b && c && d; if (eligible) {}",
		"const result = a && b && c && d ? yes : no;",
		"for (let i = a && b && c && d; ; i = a && b && c && d) {}",
		"for (const item of items) {}",
		"for (const key in object) {}",
		"if ((a ?? b) && c && d) {}",
		"if (a && b && (/* grouped */ c || d || e || f /* grouped */)) {}",
		{
			code: "while (a && b && c && d) {}",
			options: [{ maxConditions: 4 }],
		},
		{
			code: "if (a) {}",
			options: [{ maxConditions: 1 }],
		},
	],
	invalid: [
		...[
			"if (a && b && c && d) {}",
			"if (a || b || c || d) {}",
			"if (a || b && c || d) {}",
			"while (a && b && c && d) {}",
			"do {} while (a && b && c && d);",
			"for (let i = 0; a && b && c && d; i++) {}",
			"if (ready) {} else if (a && b && c && d) {}",
			"if (((a && b && c && d))) {}",
			"if (a && b && (c || d) && e) {}",
			"if (a /* comment */ && b && c && d) {}",
			"if (a && (b) && c && (d)) {}",
			"if ((a) && b && c && d) {}",
		].map((code) => ({
			code,
			errors: [{ message: "This condition has 4 top-level terms (maximum 3). Prefer a named variable that describes what these conditions mean." }],
		})),
		{
			code: "if ((a && b && c && d) || e) {}",
			options: [{ maxConditions: 1 }],
			errors: [{ message: "This condition has 2 top-level terms (maximum 1). Prefer a named variable that describes what these conditions mean." }],
		},
		{
			code: "if (a && b && c) {}",
			options: [{ maxConditions: 2, message: "Use a meaningful variable name." }],
			errors: [{ message: "Use a meaningful variable name." }],
		},
		{
			code: "if (a && b && c && d) {}",
			options: [{ message: "Simplify this condition." }],
			errors: [{ message: "Simplify this condition." }],
		},
	],
});
