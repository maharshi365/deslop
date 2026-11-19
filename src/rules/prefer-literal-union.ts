import { defineRule } from "@oxlint/plugins";
import type { ESTree, Variable } from "@oxlint/plugins";

import { resolveVariable } from "../vendor/anti-slop/shared/scope.ts";

type TypeDeclaration = ESTree.TSTypeAliasDeclaration | ESTree.TSInterfaceDeclaration | null;

type Comparisons = Map<Variable, Set<string>>;

/** Type names declared in this file, as parallel arrays. A 
ull node is a non-alias type binding. */
interface TypeDeclarations {
	readonly names: Array<string>;
	readonly nodes: Array<TypeDeclaration>;
}

/** The declaration for 
ame when exactly one binding declares it. */
function onlyDeclaration(declarations: TypeDeclarations, name: string): TypeDeclaration | undefined {
	let found: TypeDeclaration | undefined;
	let count = 0;
	for (let i = 0; i < declarations.names.length; i++) {
		if (declarations.names[i] !== name) continue;
		if (++count > 1) return undefined;
		found = declarations.nodes[i];
	}
	return found;
}

const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);
const NO_EXTRAS: readonly string[] = [];

function stringLiteralValue(node: ESTree.Node | null): string | null {
	if (node === null) return null;
	if (node.type === "Literal") return typeof node.value === "string" ? node.value : null;
	if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
		return node.quasis[0]?.value.cooked ?? null;
	}
	return null;
}

/** Return the non-string members of a `string`, `string | null`, or `string | undefined` type, or null for any other type. */
function nullableStringExtras(type: ESTree.TSType): readonly string[] | null {
	if (type.type === "TSStringKeyword") return NO_EXTRAS;
	if (type.type !== "TSUnionType") return null;
	let hasString = false;
	const extras: string[] = [];
	for (const member of type.types) {
		if (member.type === "TSStringKeyword") hasString = true;
		else if (member.type === "TSNullKeyword") extras.push("null");
		else if (member.type === "TSUndefinedKeyword") extras.push("undefined");
		else return null;
	}
	return hasString ? extras : null;
}

function propertyKeyName(key: ESTree.Node, computed: boolean): string | null {
	if (computed) return null;
	if (key.type === "Identifier") return key.name;
	if (key.type === "Literal" && typeof key.value === "string") return key.value;
	return null;
}

function memberType(members: readonly ESTree.Node[], name: string): ESTree.TSType | null {
	for (const member of members) {
		if (member.type !== "TSPropertySignature") continue;
		if (propertyKeyName(member.key, member.computed) !== name) continue;
		return member.typeAnnotation?.typeAnnotation ?? null;
	}
	return null;
}

function annotationType(node: ESTree.Node): ESTree.TSType | null {
	if ("typeAnnotation" in node && node.typeAnnotation !== null && node.typeAnnotation !== undefined) {
		const annotation = node.typeAnnotation;
		if (annotation.type === "TSTypeAnnotation") return annotation.typeAnnotation;
	}
	return null;
}

/** Return the declared type of a binding inside `{ key }: Type`, resolving `Type` to an inline type literal or a single local alias or interface. */
function destructuredPropertyType(
	identifier: ESTree.Node,
	typeDeclarations: TypeDeclarations,
): ESTree.TSType | null {
	let value: ESTree.Node = identifier;
	if (value.parent?.type === "AssignmentPattern" && value.parent.left === value) value = value.parent;
	const property = value.parent;
	if (property?.type !== "Property" || property.value !== value) return null;
	const pattern = property.parent;
	if (pattern?.type !== "ObjectPattern") return null;
	const name = propertyKeyName(property.key, property.computed);
	if (name === null) return null;

	const container = annotationType(pattern);
	if (container === null) return null;
	if (container.type === "TSTypeLiteral") return memberType(container.members, name);
	if (container.type !== "TSTypeReference" || container.typeName.type !== "Identifier") return null;
	if (container.typeArguments) return null;

	const declaration = onlyDeclaration(typeDeclarations, container.typeName.name);
	if (declaration === null || declaration === undefined) return null;
	if (declaration.type === "TSInterfaceDeclaration") return memberType(declaration.body.body, name);
	if (declaration.typeAnnotation.type !== "TSTypeLiteral") return null;
	return memberType(declaration.typeAnnotation.members, name);
}

function isUseStateCallee(callee: ESTree.Node): boolean {
	if (callee.type === "Identifier") return callee.name === "useState";
	return (
		callee.type === "MemberExpression" &&
		!callee.computed &&
		callee.property.type === "Identifier" &&
		callee.property.name === "useState"
	);
}

/** Return the type written for a variable in this file, or null when it is inferred or comes from elsewhere. */
function declaredType(
	variable: Variable,
	typeDeclarations: TypeDeclarations,
): { readonly name: ESTree.Node; readonly type: ESTree.TSType } | null {
	if (variable.defs.length !== 1) return null;
	const definition = variable.defs[0];
	if (definition === undefined) return null;
	const name: ESTree.Node = definition.name;

	if (definition.type === "Parameter") {
		const type = annotationType(name) ?? destructuredPropertyType(name, typeDeclarations);
		return type === null ? null : { name, type };
	}
	if (definition.type !== "Variable" || definition.node.type !== "VariableDeclarator") return null;

	const declarator = definition.node;
	if (declarator.id === name) {
		const type = annotationType(name);
		return type === null ? null : { name, type };
	}

	const state = declarator.init;
	if (
		declarator.id.type === "ArrayPattern" &&
		declarator.id.elements[0] === name &&
		state?.type === "CallExpression" &&
		isUseStateCallee(state.callee)
	) {
		const type = state.typeArguments?.params[0] ?? null;
		return type === null ? null : { name, type };
	}

	const type = destructuredPropertyType(name, typeDeclarations);
	return type === null ? null : { name, type };
}

/**
 * Add the names `declaredType` can find a string type for: bindings annotated `string`,
 * `string | null`, or `string | undefined`, and direct properties of an annotated `{ ... }: T`.
 */
function addTypedNames(pattern: ESTree.Node, names: Set<string>): void {
	if (pattern.type === "TSParameterProperty") pattern = pattern.parameter;
	if (pattern.type === "AssignmentPattern") pattern = pattern.left;
	if (pattern.type === "Identifier") {
		const type = annotationType(pattern);
		if (type !== null && nullableStringExtras(type) !== null) names.add(pattern.name);
		return;
	}
	if (pattern.type !== "ObjectPattern" || annotationType(pattern) === null) return;
	for (const property of pattern.properties) {
		if (property.type !== "Property") continue;
		const value = property.value.type === "AssignmentPattern" ? property.value.left : property.value;
		if (value.type === "Identifier") names.add(value.name);
	}
}

function formatLiterals(literals: readonly string[]): string {
	const quoted = literals.map((literal) => JSON.stringify(literal));
	if (quoted.length === 2) return `${quoted[0]} and ${quoted[1]}`;
	return `${quoted.slice(0, -1).join(", ")}, and ${quoted.at(-1)}`;
}

/** Prefer a literal union over `string` when a variable is only compared to a fixed set of string literals. */
export const preferLiteralUnionRule = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Prefer a literal union over `string` when a variable is compared to fixed string literals" },
		messages: {
			preferLiteralUnion:
				"`{{name}}` is typed `{{type}}` but is only compared to {{literals}}. Type it as a literal union, such as `{{union}}`, or a named union type. Before you create a new type or inline one, search the codebase for an existing type for these values.",
		},
		schema: [],
	},
	createOnce(context) {
		// Local type names in visit order, read only for reported candidates.
		const typeDeclarations: TypeDeclarations = { names: [], nodes: [] };
		// Comparisons in source order. Resolution waits for exit, and only runs for names compared
		// to at least two distinct literals; any variable with fewer cannot be reported.
		const subjects: Array<ESTree.IdentifierReference> = [];
		const literalsOf: Array<string> = [];
		// Names with a string type written in this file; no other variable can be reported.
		const typedNames = new Set<string>();

		function addParameterNames(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
			for (const parameter of node.params) addTypedNames(parameter, typedNames);
		}

		function addTypeDeclaration(name: string, declaration: TypeDeclaration) {
			typeDeclarations.names.push(name);
			typeDeclarations.nodes.push(declaration);
		}

		function addComparison(subject: ESTree.BinaryExpression["left"], literal: string | null) {
			if (literal === null || subject.type !== "Identifier") return;
			subjects.push(subject);
			literalsOf.push(literal);
		}

		function resolveComparisons(): Comparisons {
			const firstLiteral = new Map<string, string | null>();
			for (let i = 0; i < subjects.length; i++) {
				const name = subjects[i].name;
				if (!typedNames.has(name)) continue;
				const first = firstLiteral.get(name);
				// `null` marks a name with two or more distinct literals.
				if (first === undefined) firstLiteral.set(name, literalsOf[i]);
				else if (first !== null && first !== literalsOf[i]) firstLiteral.set(name, null);
			}
			const comparisons: Comparisons = new Map();
			for (let i = 0; i < subjects.length; i++) {
				if (firstLiteral.get(subjects[i].name) !== null) continue;
				const variable = resolveVariable(context.sourceCode, subjects[i]);
				if (variable === null) continue;
				const literals = comparisons.get(variable);
				if (literals === undefined) comparisons.set(variable, new Set([literalsOf[i]]));
				else literals.add(literalsOf[i]);
			}
			return comparisons;
		}

		function addLocalName(node: ESTree.ImportSpecifier | ESTree.ImportDefaultSpecifier | ESTree.ImportNamespaceSpecifier) {
			addTypeDeclaration(node.local.name, null);
		}

		return {
			before() {
				// A report needs an explicit string type and either an equality or a switch.
				const text = context.sourceCode.text;
				if (!text.includes("\\u") &&
					(!text.includes("string") || (!text.includes("==") && !text.includes("!=") && !text.includes("switch")))) {
					return false;
				}
				subjects.length = 0;
				literalsOf.length = 0;
				typedNames.clear();
				typeDeclarations.names.length = 0;
				typeDeclarations.nodes.length = 0;
			},
			FunctionDeclaration: addParameterNames,
			FunctionExpression: addParameterNames,
			ArrowFunctionExpression: addParameterNames,
			VariableDeclarator(node) {
				const pattern = node.id;
				addTypedNames(pattern, typedNames);
				if (pattern.type !== "ArrayPattern") return;
				const first = pattern.elements[0];
				if (first?.type !== "Identifier") return;
				const state = node.init;
				const type = state?.type === "CallExpression" && isUseStateCallee(state.callee) ? state.typeArguments?.params[0] : undefined;
				if (type !== undefined && nullableStringExtras(type) !== null) typedNames.add(first.name);
			},
			BinaryExpression(node) {
				if (!EQUALITY_OPERATORS.has(node.operator)) return;
				const rightLiteral = stringLiteralValue(node.right);
				if (rightLiteral !== null) addComparison(node.left, rightLiteral);
				else addComparison(node.right, stringLiteralValue(node.left));
			},
			SwitchStatement(node) {
				if (node.discriminant.type !== "Identifier") return;
				for (const switchCase of node.cases) addComparison(node.discriminant, stringLiteralValue(switchCase.test));
			},
			TSTypeAliasDeclaration(node) {
				addTypeDeclaration(node.id.name, node);
			},
			TSInterfaceDeclaration(node) {
				addTypeDeclaration(node.id.name, node);
			},
			TSEnumDeclaration(node) {
				addTypeDeclaration(node.id.name, null);
			},
			ClassDeclaration(node) {
				if (node.id !== null) addTypeDeclaration(node.id.name, null);
			},
			ImportSpecifier: addLocalName,
			ImportDefaultSpecifier: addLocalName,
			ImportNamespaceSpecifier: addLocalName,
			"Program:exit"() {
				if (subjects.length < 2 || typedNames.size === 0) return;
				for (const [variable, literalSet] of resolveComparisons()) {
					if (literalSet.size < 2) continue;
					const declaration = declaredType(variable, typeDeclarations);
					if (declaration === null) continue;
					const extras = nullableStringExtras(declaration.type);
					if (extras === null) continue;
					const literals = [...literalSet];
					context.report({
						node: declaration.name,
						messageId: "preferLiteralUnion",
						data: {
							name: variable.name,
							type: context.sourceCode.getText(declaration.type),
							literals: formatLiterals(literals),
							union: [...literals.map((literal) => JSON.stringify(literal)), ...extras].join(" | "),
						},
					});
				}
			},
		};
	},
});
