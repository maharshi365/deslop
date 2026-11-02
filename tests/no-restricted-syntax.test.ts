import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noRestrictedSyntaxRule } from "../src/rules/no-restricted-syntax.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
});

const mapRestriction = {
	selector: "NewExpression[callee.name='Map'][arguments.length=0]:not([typeArguments])",
	message: "Bare new Map() infers Map<any, any>. Provide entries so types can be inferred.",
};

ruleTester.run("no-restricted-syntax", noRestrictedSyntaxRule, {
	valid: [
		{ code: "new Map();", options: [] },
		{ code: "new Map<string, number>();", options: [mapRestriction] },
		{ code: "const map: Map<string, number> = new Map([]);", options: [mapRestriction] },
		{ code: "new Map([['key', 1]]);", options: [mapRestriction] },
		{ code: "type Value = { id: number }; const value: Value = { id: 1 }; new Map([['key', value]]);", options: [mapRestriction] },
		{ code: "type Value = { id: number }; new Map<string, Value>();", options: [mapRestriction] },
		{ code: "new Set();", options: [mapRestriction] },
	],
	invalid: [
		{
			code: "new Map();",
			options: [mapRestriction],
			errors: [{ message: mapRestriction.message, type: "NewExpression" }],
		},
		{
			code: "debugger;",
			options: ["DebuggerStatement"],
			errors: [{ message: "Using 'DebuggerStatement' is not allowed." }],
		},
		{
			code: "debugger;",
			options: [{ selector: "DebuggerStatement" }],
			errors: [{ message: "Using 'DebuggerStatement' is not allowed." }],
		},
		{
			code: "debugger; new Map();",
			options: ["DebuggerStatement", mapRestriction],
			errors: [
				{ message: "Using 'DebuggerStatement' is not allowed." },
				{ message: mapRestriction.message },
			],
		},
		{
			code: "debugger;",
			options: [
				{ selector: "DebuggerStatement", message: "First restriction." },
				{ selector: "DebuggerStatement", message: "Second restriction." },
			],
			errors: [{ message: "First restriction." }, { message: "Second restriction." }],
		},
	],
});
