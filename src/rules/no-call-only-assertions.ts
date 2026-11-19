import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

// Tests whose every assertion is a "was it called" mock check verify orchestration, not behavior.
// `toHaveBeenCalledWith` is allowed because it asserts on real data.

const CALL_ONLY_MATCHERS = new Set([
	"toHaveBeenCalled",
	"toHaveBeenCalledTimes",
	"toHaveBeenCalledOnce",
	"toBeCalled",
	"toBeCalledTimes",
]);
const TEST_NAMES = new Set(["it", "test"]);
const MODIFIERS = new Set(["not", "resolves", "rejects"]);

function rootIdentifierName(node: ESTree.Expression): string | undefined {
	let current: ESTree.Expression = node;
	while (true) {
		if (current.type === "Identifier") return current.name;
		if (current.type === "MemberExpression") {
			current = current.object;
		} else if (current.type === "CallExpression" || current.type === "TaggedTemplateExpression") {
			current = current.type === "CallExpression" ? current.callee : current.tag;
		} else {
			return undefined;
		}
	}
}

function isTestCall(node: ESTree.CallExpression): boolean {
	const args = node.arguments;
	const callback = args[args.length - 1];
	if (callback?.type !== "FunctionExpression" && callback?.type !== "ArrowFunctionExpression") return false;
	const name = rootIdentifierName(node.callee);
	return name !== undefined && TEST_NAMES.has(name);
}

function matcherName(node: ESTree.CallExpression): string | undefined {
	if (node.callee.type !== "MemberExpression" || node.callee.computed) return undefined;
	if (node.callee.property.type !== "Identifier") return undefined;
	let object: ESTree.Expression = node.callee.object;
	while (
		object.type === "MemberExpression" &&
		!object.computed &&
		object.property.type === "Identifier" &&
		MODIFIERS.has(object.property.name)
	) {
		object = object.object;
	}
	const isExpectCall = object.type === "CallExpression" && rootIdentifierName(object.callee) === "expect";
	return isExpectCall ? node.callee.property.name : undefined;
}

// `assert(...)`, `assert.equal(...)`, `assert.strict.equal(...)`: real assertions.
function isAssertCall(node: ESTree.CallExpression): boolean {
	let callee: ESTree.Expression = node.callee;
	while (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
		callee = callee.object;
	}
	return callee.type === "Identifier" && callee.name === "assert";
}

const NO_ASSERTION = 0;
const CALL_ONLY = 1;
const HAS_OTHER_ASSERTION = 2;

/** Tests must assert on behavior, not only that a mock was called. */
export const noCallOnlyAssertionsRule = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Tests must assert on behavior, not only that a mock was called" },
		messages: {
			callOnlyAssertions:
				"Every assertion in this test only checks that a mock was called. First check whether this is a valuable test; remove it if not. Otherwise, assert on returned values, state, or call arguments instead.",
		},
		schema: [],
	},
	createOnce(context) {
		const tests: Array<ESTree.CallExpression> = [];
		const assertionKinds: Array<number> = [];

		return {
			before() {
				tests.length = 0;
				assertionKinds.length = 0;
				// Every call-only matcher name contains "Called". `\u` covers escaped identifiers.
				const text = context.sourceCode.text;
				return text.includes("Called") || text.includes("\\u");
			},
			CallExpression(node) {
				if (isTestCall(node)) {
					tests.push(node);
					assertionKinds.push(NO_ASSERTION);
					return;
				}
				const index = tests.length - 1;
				if (index < 0 || assertionKinds[index] === HAS_OTHER_ASSERTION) return;
				if (isAssertCall(node)) {
					assertionKinds[index] = HAS_OTHER_ASSERTION;
					return;
				}
				const matcher = matcherName(node);
				if (matcher) assertionKinds[index] = CALL_ONLY_MATCHERS.has(matcher) ? CALL_ONLY : HAS_OTHER_ASSERTION;
			},
			"CallExpression:exit"(node) {
				if (tests[tests.length - 1] !== node) return;
				tests.pop();
				if (assertionKinds.pop() === CALL_ONLY) {
					context.report({ messageId: "callOnlyAssertions", node: node.callee });
				}
			},
		};
	},
});
