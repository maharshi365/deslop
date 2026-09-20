import fs from "node:fs";
import path from "node:path";
import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";

const SUBSTRING_MATCHERS = new Set([
	"toContain",
	"toInclude",
	"toMatch",
	"include",
	"contain",
	"string",
	"match",
]);

const CHAIN_MODIFIERS = new Set([
	"not",
	"resolves",
	"rejects",
	"to",
	"be",
	"have",
	"that",
	"which",
	"and",
	"is",
	"deep",
	"nested",
	"own",
]);

const SUBSTRING_METHODS = new Set([
	"includes",
	"startsWith",
	"endsWith",
	"indexOf",
	"search",
	"match",
]);

const ASSERT_MATCHERS = new Set([
	"include",
	"includes",
	"notInclude",
	"notIncludes",
	"match",
	"notMatch",
]);

const fileContentCache = new Map<string, string>();

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

function unwrapExpression(expression: ESTree.Expression): ESTree.Expression {
	let current = expression;
	while (true) {
		if (
			current.type === "ParenthesizedExpression" ||
			current.type === "TSAsExpression" ||
			current.type === "TSTypeAssertion" ||
			current.type === "TSNonNullExpression" ||
			current.type === "TSSatisfiesExpression"
		) {
			current = current.expression;
		} else {
			break;
		}
	}
	return current;
}

function isStableConstVariable(variable: Variable, declarator: ESTree.VariableDeclarator): boolean {
	if (declarator.parent.type !== "VariableDeclaration") return false;
	if (declarator.parent.kind === "const") return true;
	return variable.references.every((ref) => ref.init || !ref.isWrite());
}

function isImportedConstantString(variable: Variable, currentFilename?: string): boolean {
	if (!currentFilename || !path.isAbsolute(currentFilename)) return false;
	const definition = variable.defs[0];
	if (definition?.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
		return false;
	}
	const source = definition.parent.source.value;
	if (typeof source !== "string" || !source.startsWith(".")) {
		return false;
	}

	const dir = path.dirname(currentFilename);
	const candidates = [
		path.resolve(dir, source),
		path.resolve(dir, `${source}.ts`),
		path.resolve(dir, `${source}.tsx`),
		path.resolve(dir, `${source}.js`),
		path.resolve(dir, `${source}.mjs`),
		path.resolve(dir, source, "index.ts"),
		path.resolve(dir, source, "index.js"),
	];

	for (const candidate of candidates) {
		try {
			let content = fileContentCache.get(candidate);
			if (content === undefined) {
				if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
					continue;
				}
				content = fs.readFileSync(candidate, "utf8");
				fileContentCache.set(candidate, content);
			}

			const importedName =
				definition.node.type === "ImportSpecifier"
					? definition.node.imported.type === "Identifier"
						? definition.node.imported.name
						: definition.node.imported.value
					: definition.node.type === "ImportDefaultSpecifier"
						? "default"
						: null;

			if (!importedName) continue;

			const pattern = new RegExp(`export\\s+const\\s+${importedName}\\s*=\\s*(["'\`])`);
			if (pattern.test(content)) {
				return true;
			}
		} catch {
			// ignore file read errors
		}
	}

	return false;
}

function isConstantString(
	expression: ESTree.Expression,
	sourceCode: SourceCode,
	currentFilename?: string,
	visited = new Set<Variable>(),
): boolean {
	const current = unwrapExpression(expression);

	if (current.type === "Literal" && typeof current.value === "string") {
		return true;
	}

	if (current.type === "TemplateLiteral") {
		if (current.expressions.length === 0) {
			return true;
		}
		return current.expressions.every((expr) =>
			isConstantString(expr, sourceCode, currentFilename, visited),
		);
	}

	if (current.type === "BinaryExpression" && current.operator === "+") {
		return (
			isConstantString(current.left, sourceCode, currentFilename, visited) &&
			isConstantString(current.right, sourceCode, currentFilename, visited)
		);
	}

	if (
		current.type === "CallExpression" &&
		current.callee.type === "Identifier" &&
		current.callee.name === "String" &&
		current.arguments.length === 1 &&
		current.arguments[0]?.type !== "SpreadElement"
	) {
		return isConstantString(current.arguments[0], sourceCode, currentFilename, visited);
	}

	if (current.type === "Identifier") {
		const variable = resolveVariable(sourceCode, current);
		if (variable === null || visited.has(variable)) {
			return false;
		}

		if (variable.defs.length === 1) {
			const [def] = variable.defs;
			if (
				def?.type === "Variable" &&
				def.node.type === "VariableDeclarator" &&
				def.node.init !== null
			) {
				if (isStableConstVariable(variable, def.node)) {
					visited.add(variable);
					return isConstantString(def.node.init, sourceCode, currentFilename, visited);
				}
			}

			if (def?.type === "ImportBinding") {
				return isImportedConstantString(variable, currentFilename);
			}
		}
	}

	return false;
}

function extractExpectSubject(callee: ESTree.MemberExpression): ESTree.Expression | null {
	let object: ESTree.Expression = callee.object;
	while (
		object.type === "MemberExpression" &&
		!object.computed &&
		object.property.type === "Identifier" &&
		CHAIN_MODIFIERS.has(object.property.name)
	) {
		object = object.object;
	}
	if (
		object.type === "CallExpression" &&
		rootIdentifierName(object.callee) === "expect" &&
		object.arguments.length > 0 &&
		object.arguments[0]?.type !== "SpreadElement"
	) {
		return object.arguments[0];
	}
	return null;
}

function extractSubstringCallSubject(node: ESTree.Expression): ESTree.Expression | null {
	const unwrapped = unwrapExpression(node);

	if (
		unwrapped.type === "CallExpression" &&
		unwrapped.callee.type === "MemberExpression" &&
		!unwrapped.callee.computed &&
		unwrapped.callee.property.type === "Identifier"
	) {
		const method = unwrapped.callee.property.name;
		if (SUBSTRING_METHODS.has(method)) {
			return unwrapped.callee.object;
		}
		if (method === "test" && unwrapped.arguments.length > 0 && unwrapped.arguments[0]?.type !== "SpreadElement") {
			return unwrapped.arguments[0];
		}
	}

	if (unwrapped.type === "BinaryExpression") {
		if (unwrapped.left.type !== "PrivateIdentifier") {
			const leftSubject = extractSubstringCallSubject(unwrapped.left);
			if (leftSubject) return leftSubject;
		}
		const rightSubject = extractSubstringCallSubject(unwrapped.right);
		if (rightSubject) return rightSubject;
	}

	return null;
}

function isExpectStringContaining(node: ESTree.Expression): boolean {
	const unwrapped = unwrapExpression(node);
	if (
		unwrapped.type === "CallExpression" &&
		unwrapped.callee.type === "MemberExpression" &&
		!unwrapped.callee.computed &&
		unwrapped.callee.property.type === "Identifier" &&
		unwrapped.callee.property.name === "stringContaining" &&
		rootIdentifierName(unwrapped.callee.object) === "expect"
	) {
		return true;
	}
	return false;
}

/** Disallow testing that a constant string contains substrings. */
export const noPoorSubstringTestsRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Disallow testing that a constant string contains substrings; tests must assert on dynamic behavior or verify full contracts.",
		},
		messages: {
			poorSubstringTest:
				"Testing that a constant string contains a substring provides little signal. Assert against dynamic behavior, or verify the complete contract with an exact match or snapshot instead.",
		},
		schema: [],
	},
	createOnce(context) {
		return {
			CallExpression(node) {
				// Pattern 1: expect(subject).toContain(sub), expect(subject).toMatch(regex), etc.
				if (
					node.callee.type === "MemberExpression" &&
					!node.callee.computed &&
					node.callee.property.type === "Identifier"
				) {
					const propertyName = node.callee.property.name;
					if (SUBSTRING_MATCHERS.has(propertyName)) {
						const subject = extractExpectSubject(node.callee);
						if (subject && isConstantString(subject, context.sourceCode, context.filename)) {
							context.report({ node, messageId: "poorSubstringTest" });
							return;
						}
					}

					// Pattern 1b: expect(subject).toEqual(expect.stringContaining(sub))
					if (
						node.arguments.length > 0 &&
						node.arguments[0] !== undefined &&
						node.arguments[0].type !== "SpreadElement" &&
						isExpectStringContaining(node.arguments[0])
					) {
						const subject = extractExpectSubject(node.callee);
						if (subject && isConstantString(subject, context.sourceCode, context.filename)) {
							context.report({ node, messageId: "poorSubstringTest" });
							return;
						}
					}
				}

				// Pattern 2: expect(subject.includes("sub")), expect(subject.startsWith("sub")), expect(/regex/.test(subject)), etc.
				if (rootIdentifierName(node.callee) === "expect" && node.arguments.length > 0) {
					const firstArg = node.arguments[0];
					if (firstArg && firstArg.type !== "SpreadElement") {
						const subject = extractSubstringCallSubject(firstArg);
						if (subject && isConstantString(subject, context.sourceCode, context.filename)) {
							context.report({ node, messageId: "poorSubstringTest" });
							return;
						}
					}
				}

				// Pattern 3: assert(subject.includes("sub")), assert.ok(subject.includes("sub")), assert.isTrue(subject.includes("sub"))
				if (
					rootIdentifierName(node.callee) === "assert" &&
					node.arguments.length > 0 &&
					node.arguments[0] !== undefined &&
					node.arguments[0].type !== "SpreadElement"
				) {
					const firstArg = node.arguments[0];

					// 3a: assert.include(subject, "sub"), assert.match(subject, /regex/)
					if (
						node.callee.type === "MemberExpression" &&
						!node.callee.computed &&
						node.callee.property.type === "Identifier" &&
						ASSERT_MATCHERS.has(node.callee.property.name)
					) {
						if (isConstantString(firstArg, context.sourceCode, context.filename)) {
							context.report({ node, messageId: "poorSubstringTest" });
							return;
						}
					}

					// 3b: assert(subject.includes("sub")), assert.ok(subject.includes("sub"))
					const subject = extractSubstringCallSubject(firstArg);
					if (subject && isConstantString(subject, context.sourceCode, context.filename)) {
						context.report({ node, messageId: "poorSubstringTest" });
					}
				}
			},
		};
	},
});
