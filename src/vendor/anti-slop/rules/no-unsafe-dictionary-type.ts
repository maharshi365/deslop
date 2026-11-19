import { defineRule } from "@oxlint/plugins";

import {
	classifyUnsafeDictionary,
	classifyUnsafeDictionaryValue,
	createTypeEnvironment,
	resetTypeEnvironment,
	type TypeEnvironment,
	type UnsafeDictionary,
} from "../shared/dictionary-types.ts";
import { typeBindingVisitors, visibleTypeAlias } from "../shared/type-alias-resolution.ts";

import type { ESTree } from "@oxlint/plugins";

const typeNodeKinds: ReadonlySet<string> = new Set([
	"JSDocNonNullableType",
	"JSDocNullableType",
	"JSDocUnknownType",
	"TSAnyKeyword",
	"TSArrayType",
	"TSBigIntKeyword",
	"TSBooleanKeyword",
	"TSConditionalType",
	"TSConstructorType",
	"TSFunctionType",
	"TSImportType",
	"TSIndexedAccessType",
	"TSInferType",
	"TSIntersectionType",
	"TSIntrinsicKeyword",
	"TSLiteralType",
	"TSMappedType",
	"TSNamedTupleMember",
	"TSNeverKeyword",
	"TSNullKeyword",
	"TSNumberKeyword",
	"TSObjectKeyword",
	"TSParenthesizedType",
	"TSStringKeyword",
	"TSSymbolKeyword",
	"TSTemplateLiteralType",
	"TSThisType",
	"TSTupleType",
	"TSTypeLiteral",
	"TSTypeOperator",
	"TSTypePredicate",
	"TSTypeQuery",
	"TSTypeReference",
	"TSUndefinedKeyword",
	"TSUnionType",
	"TSUnknownKeyword",
	"TSVoidKeyword",
]);

// An empty type literal or interface can also start with a comment after its opening brace.
const EMPTY_OBJECT_START = /\{\s*(?:\}|\/)/;

function isTypeNode(node: ESTree.Node): node is ESTree.TSType {
	return typeNodeKinds.has(node.type);
}

function typeReferenceName(type: ESTree.TSTypeReference): string | null {
	return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function isInsideTypeAliasDeclaration(node: ESTree.Node): boolean {
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (current.type === "TSTypeAliasDeclaration") return true;
		current = current.parent;
	}
	return false;
}

function isPlainAliasConsumerUse(node: ESTree.TSType, environment: TypeEnvironment): boolean {
	if (node.type !== "TSTypeReference" || node.typeArguments?.params.length) return false;
	const name = typeReferenceName(node);
	return (
		name !== null &&
		visibleTypeAlias(name, node, environment.typeAliases) !== null &&
		!isInsideTypeAliasDeclaration(node)
	);
}

function isInsideTypeParameterConstraint(node: ESTree.TSType): boolean {
	let child: ESTree.Node = node;
	let parent: ESTree.Node | null = child.parent;
	while (parent !== null && parent.type !== "Program") {
		if (parent.type === "TSTypeParameter" && parent.constraint === child) return true;
		child = parent;
		parent = child.parent;
	}
	return false;
}

/** The unsafe dictionary to report at this type, or null. The cheap, usually decisive test runs first. */
function reportableDictionary(node: ESTree.TSType, environment: TypeEnvironment): UnsafeDictionary | null {
	const unsafe = classifyUnsafeDictionary(node, environment);
	if (unsafe === null) return null;
	if (isInsideTypeParameterConstraint(node)) return null;
	if (isPlainAliasConsumerUse(node, environment)) return null;
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (isTypeNode(current) && classifyUnsafeDictionary(current, environment) !== null)
			return null;
		current = current.parent;
	}
	return unsafe;
}

/** Disallow object-dictionary contracts whose direct value type is an unsafe escape hatch. */
export const noUnsafeDictionaryTypeRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow object-dictionary contracts whose direct value type is unknown, any, object, {}, or a union/alias containing one of those escape hatches.",
		},
		messages: {
			unsafeDictionary:
				"This dictionary's {{value}} value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.",
		},
	},
	createOnce(context) {
		const environment = createTypeEnvironment();
		// Aliases may be declared after their use, so types are checked at exit, in visit order.
		const types: Array<ESTree.TSType | ESTree.TSIndexSignature> = [];
		const report = (node: ESTree.Node, value: string) => {
			context.report({ node, messageId: "unsafeDictionary", data: { value } });
		};
		const addType = (node: ESTree.TSType) => {
			types.push(node);
		};

		return {
			before() {
				const text = context.sourceCode.text;
				if (text.includes("\\u")) return true;
				if (!text.includes("Record") && !text.includes("[")) return false;
				// Even through an alias, a report needs an unsafe keyword or an effectively empty object.
				return text.includes("unknown") || text.includes("any") || text.includes("object") ||
					text.includes("never") || EMPTY_OBJECT_START.test(text);
			},
			...typeBindingVisitors(environment.typeAliases),
			Program(node) {
				resetTypeEnvironment(environment, node, context.sourceCode.visitorKeys);
				types.length = 0;
			},
			TSTypeReference: addType,
			TSTypeLiteral: addType,
			TSMappedType: addType,
			TSIndexSignature(node) {
				if (node.typeAnnotation !== null && node.parent.type !== "TSTypeLiteral") types.push(node);
			},
			"Program:exit"() {
				for (const node of types) {
					const unsafe = node.type === "TSIndexSignature"
						? classifyUnsafeDictionaryValue(node.typeAnnotation!.typeAnnotation, environment)
						: reportableDictionary(node, environment);
					if (unsafe !== null) report(node, unsafe.unsafeValue);
				}
			},
		};
	},
});
