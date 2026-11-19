import { defineRule } from "@oxlint/plugins";
import type { ESTree, Variable } from "@oxlint/plugins";

import { resolveVariable } from "../vendor/anti-slop/shared/scope.ts";

type TypeDeclaration = ESTree.TSTypeAliasDeclaration | ESTree.TSInterfaceDeclaration | null;

type Comparisons = Map<Variable, Set<string>>;

const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);

function stringLiteralValue(node: ESTree.Node | null): string | null {
	if (node === null) return null;
	if (node.type === "Literal") return typeof node.value === "string" ? node.value : null;
	if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
		return node.quasis[0]?.value.cooked ?? null;
	}
	return null;
}

/** Return the non-string members of a `string`, `string | null`, or `string | undefined` type, or null for any other type. */
function nullableStringExtras(type: ESTree.TSType): string[] | null {
	if (type.type === "TSStringKeyword") return [];
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
	typeDeclarations: ReadonlyMap<string, TypeDeclaration[]>,
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

	const declarations = typeDeclarations.get(container.typeName.name);
	if (declarations?.length !== 1) return null;
	const declaration = declarations[0];
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
	typeDeclarations: ReadonlyMap<string, TypeDeclaration[]>,
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
		let comparisons: Comparisons;
		let typeDeclarations: Map<string, TypeDeclaration[]>;

		function addTypeDeclaration(name: string, declaration: TypeDeclaration) {
			const declarations = typeDeclarations.get(name);
			if (declarations === undefined) typeDeclarations.set(name, [declaration]);
			else declarations.push(declaration);
		}

		function addComparison(subject: ESTree.BinaryExpression["left"], literal: string | null) {
			if (literal === null || subject.type !== "Identifier") return;
			const variable = resolveVariable(context.sourceCode, subject);
			if (variable === null) return;
			const literals = comparisons.get(variable);
			if (literals === undefined) comparisons.set(variable, new Set([literal]));
			else literals.add(literal);
		}

		function addLocalName(node: ESTree.ImportSpecifier | ESTree.ImportDefaultSpecifier | ESTree.ImportNamespaceSpecifier) {
			addTypeDeclaration(node.local.name, null);
		}

		return {
			before() {
				comparisons = new Map();
				typeDeclarations = new Map();
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
				for (const [variable, literalSet] of comparisons) {
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
