import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

import { resolveVariable } from "../vendor/anti-slop/shared/scope.ts";

const TEST_FILE = /(?:^|[/\\])(?:__tests__|tests?)(?:[/\\]|$)|(?:[._](?:test|spec))\.[cm]?[jt]sx?$/i;
const TEST_MODULES = new Set(["bun:test", "@jest/globals", "vitest"]);
const CLOSING_TOKENS = new Set([")", "]", "}"]);

function isExpect(identifier: ESTree.CallExpression["callee"], sourceCode: SourceCode): boolean {
	if (identifier.type !== "Identifier") return false;
	const variable = resolveVariable(sourceCode, identifier);
	if (variable?.defs.length) {
		return variable.defs.some(
			(definition) =>
				definition.type === "ImportBinding" &&
				definition.node.type === "ImportSpecifier" &&
				definition.node.imported.type === "Identifier" &&
				definition.node.imported.name === "expect" &&
				definition.parent?.type === "ImportDeclaration" &&
				TEST_MODULES.has(definition.parent.source.value),
		);
	}
	return identifier.name === "expect";
}

/** Shape of `expect(call()).matcher()`. Whether the callee really is `expect` is checked separately. */
function assertionCall(statement: ESTree.Node): ESTree.CallExpression | null {
	if (statement.type !== "ExpressionStatement") return null;
	let expression = statement.expression;
	if (expression.type === "AwaitExpression") expression = expression.argument;
	if (expression.type !== "CallExpression" || expression.callee.type !== "MemberExpression") return null;
	let assertion = expression.callee.object;
	while (assertion.type === "MemberExpression") assertion = assertion.object;
	if (
		assertion.type !== "CallExpression" ||
		assertion.arguments.length !== 1 ||
		assertion.callee.type !== "Identifier"
	) return null;
	let call = assertion.arguments[0];
	if (call.type === "AwaitExpression") call = call.argument;
	return call.type === "CallExpression" ? call : null;
}

function expectCallee(call: ESTree.CallExpression): ESTree.CallExpression["callee"] {
	// The shape check above guarantees `expect(call)` is the call's nearest CallExpression ancestor.
	let assertion: ESTree.Node = call.parent;
	if (assertion.type === "AwaitExpression") assertion = assertion.parent;
	return (assertion as ESTree.CallExpression).callee;
}

/** Remove whitespace and commas. Equal token lists without comments always strip to equal text. */
function strippedText(text: string): string {
	return text.replace(/[\s,]+/g, "");
}

function sameCall(left: ESTree.CallExpression, right: ESTree.CallExpression, sourceCode: SourceCode): boolean {
	const leftText = sourceCode.getText(left);
	const rightText = sourceCode.getText(right);
	if (leftText === rightText) return true;
	// Tokens ignore whitespace, comments, and trailing commas. Without a `/`, neither text has a
	// comment, so different stripped text means different tokens. A `\` escape can spell the same
	// token two ways, so it disables this check.
	const plain = !leftText.includes("/") && !rightText.includes("/") && !leftText.includes("\\") && !rightText.includes("\\");
	if (plain && strippedText(leftText) !== strippedText(rightText)) return false;
	const leftTokens = sourceCode.getTokens(left);
	const rightTokens = sourceCode.getTokens(right);
	let leftIndex = 0;
	let rightIndex = 0;
	while (leftIndex < leftTokens.length && rightIndex < rightTokens.length) {
		const leftToken = leftTokens[leftIndex];
		const rightToken = rightTokens[rightIndex];
		if (
			leftToken.value === "," && CLOSING_TOKENS.has(leftTokens[leftIndex + 1]?.value) &&
			leftTokens[leftIndex - 1]?.value !== "[" && leftTokens[leftIndex - 1]?.value !== ","
		) {
			leftIndex++;
			continue;
		}
		if (
			rightToken.value === "," && CLOSING_TOKENS.has(rightTokens[rightIndex + 1]?.value) &&
			rightTokens[rightIndex - 1]?.value !== "[" && rightTokens[rightIndex - 1]?.value !== ","
		) {
			rightIndex++;
			continue;
		}
		if (leftToken.type !== rightToken.type || leftToken.value !== rightToken.value) return false;
		leftIndex++;
		rightIndex++;
	}
	return leftIndex === leftTokens.length && rightIndex === rightTokens.length;
}

export const noRepeatedExpectCallRule = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Disallow repeated calls across adjacent assertions; call once and reuse the result." },
		schema: [],
		messages: { repeatedCall: "Call once and reuse the result across assertions." },
	},
	createOnce(context) {
		function checkStatements(node: ESTree.Program | ESTree.BlockStatement) {
			let previous: ESTree.CallExpression | null = null;
			for (const statement of node.body) {
				const call = assertionCall(statement);
				// Resolving `expect` needs scope analysis, so check it only for repeated calls.
				if (
					call && previous && sameCall(previous, call, context.sourceCode) &&
					isExpect(expectCallee(previous), context.sourceCode) && isExpect(expectCallee(call), context.sourceCode)
				) {
					context.report({ node: call, messageId: "repeatedCall" });
				}
				previous = call;
			}
		}
		return {
			before() {
				return TEST_FILE.test(context.filename);
			},
			Program: checkStatements,
			BlockStatement: checkStatements,
		};
	},
});
