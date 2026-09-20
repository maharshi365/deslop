import path from "node:path";
import { fileURLToPath } from "node:url";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noPoorSubstringTestsRule } from "../src/rules/no-poor-substring-tests.ts";

const fixtureTestFile = fileURLToPath(new URL("./fixtures/test.ts", import.meta.url));

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
});

ruleTester.run("no-poor-substring-tests", noPoorSubstringTestsRule, {
	valid: [
		{
			name: "allows checking substrings on dynamic function results",
			code: `
				const result = formatMessage("test");
				expect(result).toContain("test");
			`,
		},
		{
			name: "allows includes check on dynamic function results",
			code: `
				const result = getPrompt();
				expect(result.includes("test")).toBe(true);
			`,
		},
		{
			name: "allows regex matching on dynamic function results",
			code: `
				const result = renderView();
				expect(result).toMatch(/Hello/);
			`,
		},
		{
			name: "allows array element containment checks",
			code: `
				const roles = ["admin", "user"];
				expect(roles).toContain("admin");
			`,
		},
		{
			name: "allows array literal element containment checks",
			code: `
				expect(["a", "b"]).toContain("a");
			`,
		},
		{
			name: "allows Set element containment checks",
			code: `
				const set = new Set(["a", "b"]);
				expect(set).toContain("a");
			`,
		},
		{
			name: "allows exact equality checks on constant strings",
			code: `
				const PROMPT = "You are a helpful assistant.";
				expect(PROMPT).toBe("You are a helpful assistant.");
			`,
		},
		{
			name: "allows exact toEqual checks on constant strings",
			code: `
				const PROMPT = "You are a helpful assistant.";
				expect(PROMPT).toEqual("You are a helpful assistant.");
			`,
		},
		{
			name: "allows checking substrings on dynamic template literals",
			code: `
				const template = \`Hello \${getName()}!\`;
				expect(template).toContain("Hello");
			`,
		},
		{
			name: "allows checking substrings on member expressions",
			code: `
				expect(user.bio).toContain("developer");
			`,
		},
		{
			name: "allows checking substrings on function parameters",
			code: `
				function checkOutput(text: string) {
					expect(text).toContain("expected");
				}
			`,
		},
		{
			name: "allows includes in application logic outside assertions",
			code: `
				const STR = "hello world";
				if (STR.includes("hello")) {
					doSomething();
				}
			`,
		},
		{
			name: "allows checking substrings on reassigned variables",
			code: `
				let output = "initial";
				output = getNext();
				expect(output).toContain("next");
			`,
		},
		{
			name: "allows assert on dynamic expression",
			code: `
				const result = computeOutput();
				assert(result.includes("success"));
			`,
		},
		{
			name: "allows checking elements of imported array",
			filename: fixtureTestFile,
			code: `
				import { ROLES } from "./prompt.ts";
				expect(ROLES).toContain("admin");
			`,
		},
	],
	invalid: [
		{
			name: "rejects toContain on direct string literal",
			code: `expect("The quick brown fox").toContain("brown");`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects toContain on constant string variable",
			code: `
				const PROMPT = "You are a helpful assistant.";
				expect(PROMPT).toContain("assistant");
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects poor substring test inside it block",
			code: `
				it("contains assistant", () => {
					const PROMPT = "You are a helpful assistant.";
					expect(PROMPT).toContain("assistant");
				});
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects multiple substring assertions against constant string (AI-slop pattern)",
			code: `
				const PROMPT = "You are an assistant. Do not lie. Be concise.";
				test("has assistant", () => {
					expect(PROMPT).toContain("assistant");
				});
				test("has concise", () => {
					expect(PROMPT).toContain("concise");
				});
			`,
			errors: [
				{ messageId: "poorSubstringTest" },
				{ messageId: "poorSubstringTest" },
			],
		},
		{
			name: "rejects toContain on template literal with no expressions",
			code: `
				const PROMPT = \`System Prompt:
				You are an AI.\`;
				expect(PROMPT).toContain("AI");
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects toContain on template literal with constant expressions",
			code: `
				const PROMPT = \`Prefix: \${"constant"} suffix\`;
				expect(PROMPT).toContain("Prefix");
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects toContain on string concatenation",
			code: `
				const A = "Hello, " + "world!";
				expect(A).toContain("world");
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects toMatch regex on constant string",
			code: `
				const PROMPT = "You are a helpful assistant.";
				expect(PROMPT).toMatch(/assistant/);
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects toMatch string on constant string",
			code: `
				const PROMPT = "You are a helpful assistant.";
				expect(PROMPT).toMatch("assistant");
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects expect.stringContaining on constant string",
			code: `
				const PROMPT = "You are an assistant.";
				expect(PROMPT).toEqual(expect.stringContaining("assistant"));
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects includes call on constant string inside expect",
			code: `
				const PROMPT = "You are an assistant.";
				expect(PROMPT.includes("assistant")).toBe(true);
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects startsWith call on constant string inside expect",
			code: `
				const PROMPT = "You are an assistant.";
				expect(PROMPT.startsWith("You are")).toBe(true);
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects endsWith call on constant string inside expect",
			code: `
				const PROMPT = "You are an assistant.";
				expect(PROMPT.endsWith("assistant.")).toBe(true);
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects indexOf check on constant string inside expect",
			code: `
				const PROMPT = "You are an assistant.";
				expect(PROMPT.indexOf("assistant") !== -1).toBe(true);
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects regex.test on constant string inside expect",
			code: `
				const PROMPT = "You are an assistant.";
				expect(/assistant/.test(PROMPT)).toBe(true);
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects assert.include on constant string",
			code: `
				const PROMPT = "You are an assistant.";
				assert.include(PROMPT, "assistant");
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects assert with includes on constant string",
			code: `
				const PROMPT = "You are an assistant.";
				assert(PROMPT.includes("assistant"));
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects Chai to.include on constant string",
			code: `
				const PROMPT = "You are an assistant.";
				expect(PROMPT).to.include("assistant");
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects Chai to.have.string on constant string",
			code: `
				const PROMPT = "You are an assistant.";
				expect(PROMPT).to.have.string("assistant");
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects not.toContain on constant string",
			code: `
				const PROMPT = "You are an assistant.";
				expect(PROMPT).not.toContain("forbidden");
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects let variable never reassigned",
			code: `
				let PROMPT = "You are an assistant.";
				expect(PROMPT).toContain("assistant");
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects aliased constant string variable",
			code: `
				const BASE = "hello world";
				const ALIAS = BASE;
				expect(ALIAS).toContain("hello");
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
		{
			name: "rejects toContain on imported constant string",
			filename: fixtureTestFile,
			code: `
				import { SYSTEM_PROMPT } from "./prompt.ts";
				expect(SYSTEM_PROMPT).toContain("assistant");
			`,
			errors: [{ messageId: "poorSubstringTest" }],
		},
	],
});
