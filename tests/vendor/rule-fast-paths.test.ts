import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noKnownValueWideningRule } from "../../src/vendor/anti-slop/rules/no-known-value-widening.ts";
import { noModuleMockingRule } from "../../src/vendor/anti-slop/rules/no-module-mocking.ts";
import { noObjectParametersRule } from "../../src/vendor/anti-slop/rules/no-object-parameters.ts";
import { noReduceAccumulatorCopyRule } from "../../src/vendor/anti-slop/rules/no-reduce-accumulator-copy.ts";
import { noReflectApplyRule } from "../../src/vendor/anti-slop/rules/no-reflect-apply.ts";
import { noReflectGetRule } from "../../src/vendor/anti-slop/rules/no-reflect-get.ts";
import { noRuntimeTypeofRule } from "../../src/vendor/anti-slop/rules/no-runtime-typeof.ts";
import { noForbiddenTermInSymbolNamesRule } from "../../src/vendor/anti-slop/rules/no-shape-in-symbol-names.ts";
import { noWidenThenAssertRule } from "../../src/vendor/anti-slop/rules/no-widen-then-assert.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
});

ruleTester.run("no-object-parameters", noObjectParametersRule, {
	valid: [
		{ name: "allows files without type declarations", code: "function f(value: string) {}" },
		{
			name: "respects a nested alias that shadows an object alias",
			code: "type Input = object;\nfunction g() { type Input = string; function f(value: Input) {} }",
		},
	],
	invalid: [
		{
			name: "reports a parameter whose local alias resolves to object",
			code: "type Input = object;\nfunction f(value: Input) {}",
			errors: [{ messageId: "objectParameter" }],
		},
		{
			name: "reports an alias declared inside a namespace",
			code: "namespace Space { type Input = object; export function f(value: Input) {} }",
			errors: [{ messageId: "objectParameter" }],
		},
	],
});

ruleTester.run("no-widen-then-assert", noWidenThenAssertRule, {
	valid: [
		{ name: "allows files without assertions", code: "const widened: unknown = { a: 1 };" },
		{
			name: "allows assertions on non-identifier expressions",
			code: "const widened: unknown = { a: 1 };\nconst narrowed = { b: 2 } as { b: number };",
		},
	],
	invalid: [
		{
			name: "reports a widened const binding asserted back to a narrower type",
			code: "const widened: unknown = { a: 1 };\nconst narrowed = widened as { a: number };",
			errors: [{ messageId: "widenThenAssert", data: { name: "widened" } }],
		},
	],
});

ruleTester.run("no-module-mocking", noModuleMockingRule, {
	valid: [
		{ name: "allows non-mock methods on the framework object", code: "vi.fn();" },
		{ name: "allows mock methods on other objects", code: "other.mock('module');" },
		{
			name: "allows mock methods on a local object named vi",
			code: "const vi = { mock() {} };\nvi.mock('module');",
		},
		{
			name: "allows mocking through vi bound to another vitest export",
			code: "import { fn as vi } from 'vitest';\nvi.mock('module');",
		},
		{
			name: "allows mocking through a local vi spelled with a Unicode escape",
			code: "const \\u0076i = { mock() {} };\nvi.mock('module');",
		},
	],
	invalid: [
		{
			name: "reports vi.mock when a dotted namespace name only mentions vi, as scope analysis does",
			code: "namespace vi.inner {}\nvi.mock('module');",
			errors: [{ messageId: "moduleMock" }],
		},
		{
			name: "reports vi.mock through vi imported from vitest",
			code: "import { vi } from 'vitest';\nvi.mock('module');\nvi.fn();",
			errors: [{ messageId: "moduleMock" }],
		},
		{
			name: "reports global vi.mock",
			code: "vi.mock('module');",
			errors: [{ messageId: "moduleMock" }],
		},
		{
			name: "reports a computed jest doMock call",
			code: "jest['doMock']('module');",
			errors: [{ messageId: "moduleMock" }],
		},
		{
			name: "reports mocking through a renamed vitest import",
			code: "import { vi as v } from 'vitest';\nv.unstable_mockModule('module');",
			errors: [{ messageId: "moduleMock" }],
		},
	],
});

ruleTester.run("no-reduce-accumulator-copy", noReduceAccumulatorCopyRule, {
	valid: [
		{
			name: "allows mutating the accumulator with a non-copy method",
			code: "items.reduce((acc, item) => { acc.push(item); return acc; }, []);",
		},
		{
			name: "allows array copies when the initial value is not a known array",
			code: "items.reduce((acc, item) => acc.concat(item), start);",
		},
		{ name: "allows Object.assign outside a reducer", code: "Object.assign({}, acc);" },
	],
	invalid: [
		{
			name: "reports Object.assign copies of the accumulator",
			code: "items.reduce((acc, item) => Object.assign({}, acc, item), {});",
			errors: [{ messageId: "accumulatorCopy" }],
		},
		{
			name: "reports Array.from copies of the accumulator",
			code: "items.reduce((acc, item) => Array.from(acc), []);",
			errors: [{ messageId: "accumulatorCopy" }],
		},
		{
			name: "reports concat copies of an array accumulator",
			code: "items.reduce((acc, item) => acc.concat(item), []);",
			errors: [{ messageId: "accumulatorCopy" }],
		},
	],
});

ruleTester.run("no-known-value-widening", noKnownValueWideningRule, {
	valid: [
		{
			name: "allows calls in files without type predicates",
			code: "function take(value: unknown): void {}\ntake({ id: 'a' });",
		},
		{
			name: "allows predicate keywords that do not belong to the called function",
			code: "const is = 1;\nfunction take(value: unknown): void {}\ntake({ id: 'a' });",
		},
		{
			name: "allows predicate calls with an argument that has no known evidence",
			code: "function isUser(value: unknown): value is { id: string } { return true; }\nisUser(input);",
		},
		{
			name: "resolves an assignment to the nearest binding, not an annotated one with the same name",
			code: "let target: unknown;\nfunction f() { let target = 1; target = 2; }",
		},
		{
			name: "allows identifiers bound by let, which carry no evidence",
			code: "let value = { a: 1 };\nconst widened: unknown = value;",
		},
	],
	invalid: [
		{
			name: "reports a call that precedes its hoisted predicate function",
			code: "isUser({ id: 'a' });\nfunction isUser(value: unknown): value is { id: string } { return true; }",
			errors: [{ messageId: "widening" }],
		},
		{
			name: "reports a call to a predicate arrow function bound to a const",
			code: "const isUser = (value: unknown): value is { id: string } => true;\nisUser({ id: 'a' });",
			errors: [{ messageId: "widening" }],
		},
		{
			name: "reports an assignment that precedes the annotated declaration it targets",
			code: "function f() { target = { a: 1 }; }\nlet target: unknown;",
			errors: [{ messageId: "widening", data: { subject: "binding `target`", target: "unknown" } }],
		},
		{
			name: "reports evidence through a const declared after its use",
			code: "function f(): unknown { return value; }\nconst value = { a: 1 };",
			errors: [{ messageId: "widening", data: { subject: "return value of `f`", target: "unknown" } }],
		},
		{
			name: "reports evidence through a destructured const binding",
			code: "const { a } = { a: { b: 1 } };\nconst widened: unknown = a;",
			errors: [{ messageId: "widening", data: { subject: "binding `widened`", target: "unknown" } }],
		},
		{
			name: "reports a known value passed to an unknown type-predicate parameter",
			code: "function isUser(value: unknown): value is { id: string } { return true; }\nisUser({ id: 'a' });",
			errors: [{ messageId: "widening" }],
		},
		{
			name: "reports a known value passed to an unknown assertion-function parameter",
			code: "function assertUser(value: unknown): asserts value {}\nassertUser({ id: 'a' });",
			errors: [{ messageId: "widening" }],
		},
	],
});

ruleTester.run("no-shape-in-symbol-names", noForbiddenTermInSymbolNamesRule, {
	valid: [
		{ name: "allows files without the term", code: "const user = 1;" },
		{ name: "allows borrowed member names", code: "value.shape;" },
		{ name: "allows the term in strings", code: "const label = 'shape';" },
	],
	invalid: [
		{
			name: "reports the term in a binding name",
			code: "const userShape = 1;",
			errors: [{ messageId: "forbiddenSymbolName", data: { name: "userShape" } }],
		},
		{
			name: "reports the term in any letter case",
			code: "const SHAPE = 1;",
			errors: [{ messageId: "forbiddenSymbolName", data: { name: "SHAPE" } }],
		},
	],
});

ruleTester.run("no-runtime-typeof", noRuntimeTypeofRule, {
	valid: [
		{ name: "allows files without typeof", code: "const value = 1;" },
		{ name: "allows existence probes", code: "if (typeof window === 'undefined') {}" },
	],
	invalid: [
		{
			name: "reports a runtime typeof check",
			code: "if (typeof value === 'string') {}",
			errors: [{ messageId: "runtimeTypeof" }],
		},
	],
});

ruleTester.run("no-reflect-get", noReflectGetRule, {
	valid: [
		{ name: "allows files without Reflect", code: "store.get(key);" },
		{
			name: "allows a local object named Reflect",
			code: "const Reflect = { get() {} };\nReflect.get(target, 'key');",
		},
	],
	invalid: [
		{
			name: "reports global Reflect.get",
			code: "Reflect.get(target, 'key');",
			errors: [{ messageId: "reflectGet" }],
		},
	],
});

ruleTester.run("no-reflect-apply", noReflectApplyRule, {
	valid: [
		{ name: "allows files without Reflect", code: "handler.apply(null, []);" },
		{ name: "allows other Reflect methods", code: "Reflect.ownKeys(target);" },
	],
	invalid: [
		{
			name: "reports computed global Reflect.apply",
			code: "Reflect['apply'](handler, null, []);",
			errors: [{ messageId: "reflectApply" }],
		},
	],
});
