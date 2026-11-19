import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noCallOnlyAssertionsRule } from "../src/rules/no-call-only-assertions.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
});
const error = { messageId: "callOnlyAssertions" };

tester.run("no-call-only-assertions", noCallOnlyAssertionsRule, {
	valid: [
		{
			name: "allows call checks next to a value assertion",
			code: `test("saves", () => { save(); expect(store.save).toHaveBeenCalled(); expect(store.size).toBe(1); });`,
		},
		{
			name: "allows call checks next to assert.equal",
			code: `test("saves", () => { save(); expect(store.save).toHaveBeenCalled(); assert.equal(store.size, 1); });`,
		},
		{
			name: "allows call checks next to assert.strictEqual",
			code: `it("saves", () => { save(); expect(store.save).toHaveBeenCalledTimes(1); assert.strictEqual(store.size, 1); });`,
		},
		{
			name: "allows call checks next to assert.deepEqual",
			code: `it("saves", () => { save(); expect(store.save).toHaveBeenCalledOnce(); assert.deepEqual(store.items, [item]); });`,
		},
		{
			name: "allows call checks next to a bare assert call",
			code: `it("saves", () => { save(); expect(store.save).toHaveBeenCalled(); assert(store.size === 1); });`,
		},
		{
			name: "allows call checks next to a nested assert member call",
			code: `it("saves", () => { save(); expect(store.save).toHaveBeenCalled(); assert.strict.equal(store.size, 1); });`,
		},
	],
	invalid: [
		{
			name: "rejects a test whose only assertion is toHaveBeenCalled",
			code: `test("saves", () => { save(); expect(store.save).toHaveBeenCalled(); });`,
			errors: [error],
		},
		{
			name: "rejects a test whose only assertion is the toBeCalled alias",
			code: `test("saves", () => { save(); expect(store.save).toBeCalled(); });`,
			errors: [error],
		},
		{
			name: "rejects a test whose only assertion is the toBeCalledTimes alias",
			code: `test("saves", () => { save(); expect(store.save).toBeCalledTimes(1); });`,
			errors: [error],
		},
		{
			name: "rejects a test that mixes call-only matchers and their aliases",
			code: `it("saves", () => { save(); expect(store.save).toBeCalled(); expect(store.flush).not.toHaveBeenCalledTimes(2); });`,
			errors: [error],
		},
		{
			name: "reports a nested call-only test even after its parent made a value assertion",
			code: `test("outer", () => {
	expect(store.size).toBe(1);
	test("inner", () => { expect(store.save).toBeCalled(); });
});`,
			errors: [{ ...error, line: 3 }],
		},
	],
});
