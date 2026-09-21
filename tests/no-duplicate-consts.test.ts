import type { Context, ESTree } from "@oxlint/plugins";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";

import { noDuplicateConstsRule } from "../src/rules/no-duplicate-consts.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
});

function declaration(name: string, value: ESTree.Expression): ESTree.VariableDeclaration {
	return { type: "VariableDeclaration", kind: "const", declarations: [{ type: "VariableDeclarator", id: { type: "Identifier", name }, init: value }] } as unknown as ESTree.VariableDeclaration;
}

describe("no-duplicate-consts lifecycle", () => {
	it("reports matching constants declared in separate files", () => {
		const reports: Array<{ data?: Record<string, string> }> = [];
		const context = { filename: "/repo/first.ts", report: (report: { data?: Record<string, string> }) => reports.push(report) };
		if (!("createOnce" in noDuplicateConstsRule)) throw new Error("Expected a createOnce rule");
		const visitor = noDuplicateConstsRule.createOnce(context as unknown as Context);

		visitor.Program?.({} as ESTree.Program);
		visitor.VariableDeclaration?.(declaration("DEFAULT_PORT", { type: "Literal", value: 3000 } as ESTree.Expression));
		context.filename = "/repo/second.ts";
		visitor.Program?.({} as ESTree.Program);
		visitor.VariableDeclaration?.(declaration("DEFAULT_PORT", { type: "Literal", value: 3000 } as ESTree.Expression));

		expect(reports).toHaveLength(1);
		expect(reports[0]?.data).toEqual({ name: "DEFAULT_PORT", firstFile: "/repo/first.ts" });
	});
});

ruleTester.run("no-duplicate-consts", noDuplicateConstsRule, {
	valid: [
		"const DEFAULT_PORT = 3000; const DEFAULT_TIMEOUT = 3000;",
		"let DEFAULT_PORT = 3000;",
		"const defaultPort = 3000;",
		"const DEFAULT_PORT = getPort();",
		"const DEFAULT_OPTIONS = { retry: 3, timeout: 1000 };",
	],
	invalid: [],
});
