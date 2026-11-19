import fs from "node:fs";
import path from "node:path";
import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

import { resolveVariable } from "../vendor/anti-slop/shared/scope.ts";
import { addBindingNames } from "./shared/module-scope.ts";

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

// TS ESM style: a `.js` specifier may refer to a `.ts` source file, etc.
const SOURCE_EXTENSIONS_FOR_SPECIFIER: Record<string, Array<string>> = {
	".js": [".ts", ".tsx"],
	".jsx": [".tsx"],
	".mjs": [".mts"],
	".cjs": [".cts"],
};

function readFile(filePath: string): string | undefined {
	const stats = fs.statSync(filePath, { throwIfNoEntry: false });
	return stats?.isFile() ? fs.readFileSync(filePath, "utf8") : undefined;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTestFile(filename?: string): boolean {
	if (!filename) return false;
	return /(?:^|[/\\])(?:__tests__|tests?)(?:[/\\]|$)|(?:[._](?:test|spec))\.[cm]?[jt]sx?$/i.test(filename);
}

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

	const importedName =
		definition.node.type === "ImportSpecifier"
			? definition.node.imported.type === "Identifier"
				? definition.node.imported.name
				: definition.node.imported.value
			: definition.node.type === "ImportDefaultSpecifier"
				? "default"
				: null;

	if (!importedName) return false;

	const dir = path.dirname(currentFilename);
	const specifierExtension = path.extname(source);
	const stem = source.slice(0, source.length - specifierExtension.length);
	const candidates = [
		path.resolve(dir, source),
		...(SOURCE_EXTENSIONS_FOR_SPECIFIER[specifierExtension] ?? []).map((extension) =>
			path.resolve(dir, `${stem}${extension}`),
		),
		path.resolve(dir, `${source}.ts`),
		path.resolve(dir, `${source}.tsx`),
		path.resolve(dir, `${source}.mts`),
		path.resolve(dir, `${source}.cts`),
		path.resolve(dir, `${source}.js`),
		path.resolve(dir, `${source}.jsx`),
		path.resolve(dir, `${source}.mjs`),
		path.resolve(dir, source, "index.ts"),
		path.resolve(dir, source, "index.js"),
	];
	const pattern = new RegExp(`export\\s+const\\s+${escapeRegExp(importedName)}\\s*=\\s*(["'\`])`);

	for (const candidate of candidates) {
		try {
			const content = readFile(candidate);
			if (content === undefined) continue;

			if (pattern.test(content)) {
				return true;
			}
		} catch {
			// ignore file read errors
		}
	}

	return false;
}

/** Whether `isConstantString` can be true for this expression before any binding is resolved. */
function mayBeConstantString(expression: ESTree.Expression): boolean {
	const current = unwrapExpression(expression);
	switch (current.type) {
		case "Literal":
			return typeof current.value === "string";
		case "TemplateLiteral":
		case "Identifier":
			return true;
		case "BinaryExpression":
			return current.operator === "+";
		case "CallExpression":
			return current.callee.type === "Identifier" && current.callee.name === "String";
		default:
			return false;
	}
}

/**
 * Names that can resolve to a constant string: bindings of declarators whose initializer may be one,
 * and imports from relative modules. Complete at Program:exit.
 */
type ConstantCandidates = ReadonlySet<string>;

function isConstantString(
	expression: ESTree.Expression,
	sourceCode: SourceCode,
	candidates: ConstantCandidates,
	currentFilename: string,
	visited: Array<Variable>,
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
			isConstantString(expr, sourceCode, candidates, currentFilename, visited),
		);
	}

	if (current.type === "BinaryExpression" && current.operator === "+") {
		return (
			isConstantString(current.left, sourceCode, candidates, currentFilename, visited) &&
			isConstantString(current.right, sourceCode, candidates, currentFilename, visited)
		);
	}

	if (
		current.type === "CallExpression" &&
		current.callee.type === "Identifier" &&
		current.callee.name === "String" &&
		current.arguments.length === 1 &&
		current.arguments[0]?.type !== "SpreadElement"
	) {
		return isConstantString(current.arguments[0], sourceCode, candidates, currentFilename, visited);
	}

	// Scope analysis is only needed for a name that some declarator or relative import binds.
	if (current.type === "Identifier" && candidates.has(current.name)) {
		const variable = resolveVariable(sourceCode, current);
		if (variable === null || visited.includes(variable)) {
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
					visited.push(variable);
					return isConstantString(def.node.init, sourceCode, candidates, currentFilename, visited);
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
		// Keep only calls with a possible constant-string subject. Check bindings at exit.
		const calls: Array<ESTree.CallExpression> = [];
		const subjects: Array<ESTree.Expression> = [];
		const alternatives: Array<ESTree.Expression | null> = [];
		const candidates = new Set<string>();
		const visited: Array<Variable> = [];

		function addImportedName(node: ESTree.ImportSpecifier | ESTree.ImportDefaultSpecifier) {
			const declaration = node.parent;
			if (declaration.type === "ImportDeclaration" && declaration.source.value.startsWith(".")) candidates.add(node.local.name);
		}

		function collectCall(node: ESTree.CallExpression) {
			const callee = node.callee;
			const root = rootIdentifierName(callee);
			if (root !== "expect" && root !== "assert") return;
			const argument = node.arguments[0];
			const firstArg = argument?.type === "SpreadElement" ? undefined : argument;
			let subject: ESTree.Expression | null = null;
			if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
				const method = callee.property.name;
				if (root === "expect") {
					// expect(subject).toContain(sub) or expect(subject).toEqual(expect.stringContaining(sub)).
					if (SUBSTRING_MATCHERS.has(method) || (firstArg && isExpectStringContaining(firstArg))) {
						subject = extractExpectSubject(callee);
					}
				} else if (firstArg && ASSERT_MATCHERS.has(method)) {
					// assert.include(subject, "sub").
					subject = firstArg;
				}
			}
			// expect(subject.includes("sub")), assert.ok(subject.includes("sub")), etc.
			let alternative = firstArg ? extractSubstringCallSubject(firstArg) : null;
			if (alternative !== null && !mayBeConstantString(alternative)) alternative = null;
			if (subject === null || !mayBeConstantString(subject)) {
				subject = alternative;
				alternative = null;
			}
			if (subject === null) return;
			calls.push(node);
			subjects.push(subject);
			alternatives.push(alternative);
		}

		function isConstant(subject: ESTree.Expression): boolean {
			visited.length = 0;
			return isConstantString(subject, context.sourceCode, candidates, context.filename, visited);
		}

		return {
			before() {
				if (!isTestFile(context.filename)) return false;
				// Every pattern needs an `expect` or `assert` callee. `\u` covers escaped identifiers.
				const text = context.sourceCode.text;
				if (!text.includes("expect") && !text.includes("assert") && !text.includes("\\u")) return false;
				calls.length = 0;
				subjects.length = 0;
				alternatives.length = 0;
				candidates.clear();
			},
			CallExpression: collectCall,
			VariableDeclarator(node) {
				if (node.init !== null && mayBeConstantString(node.init)) addBindingNames(node.id, candidates);
			},
			ImportSpecifier: addImportedName,
			ImportDefaultSpecifier: addImportedName,
			"Program:exit"() {
				for (let i = 0; i < calls.length; i++) {
					const alternative = alternatives[i];
					if (isConstant(subjects[i]) || (alternative !== null && isConstant(alternative))) {
						context.report({ node: calls[i], messageId: "poorSubstringTest" });
					}
				}
				visited.length = 0;
			},
		};
	},
});
