import type { ESTree } from "@oxlint/plugins";

export type TypeDeclaration = ESTree.TSTypeAliasDeclaration | ESTree.TSInterfaceDeclaration;
export type ReportNode = TypeDeclaration | ESTree.VariableDeclarator;

export function propertyKey(node: unknown): string | null {
	const value = node as { type?: unknown; name?: unknown; value?: unknown };
	if (value.type === "Identifier" && typeof value.name === "string") return value.name;
	if (typeof value.value === "string") return JSON.stringify(value.value);
	if (typeof value.value === "number") return String(value.value);
	return null;
}

function literalValue(node: ESTree.TSLiteralType): string | null {
	const literal = node.literal as { type: string; operator?: string; value?: unknown; argument?: { value?: unknown } };
	if (typeof literal.value === "string") return JSON.stringify(literal.value);
	if (typeof literal.value === "number" || typeof literal.value === "boolean") return String(literal.value);
	if (typeof literal.value === "bigint") return `${literal.value}n`;
	if (literal.type === "UnaryExpression" && literal.operator === "-") {
		if (typeof literal.argument?.value === "number") return `-${literal.argument.value}`;
		if (typeof literal.argument?.value === "bigint") return `-${literal.argument.value}n`;
	}
	return null;
}

export function canonicalTypeName(node: ESTree.TSTypeName): string | null {
	if (node.type === "Identifier") return node.name;
	if (node.type !== "TSQualifiedName") return null;
	const left = canonicalTypeName(node.left);
	return left === null ? null : `${left}.${node.right.name}`;
}

function canonicalMembers(members: ESTree.TSSignature[], parameters: Map<string, string>): string | null {
	const result: string[] = [];
	for (const member of members) {
		if (member.type !== "TSPropertySignature" || member.computed || member.typeAnnotation === null) return null;
		const key = propertyKey(member.key);
		const type = canonicalType(member.typeAnnotation.typeAnnotation, parameters);
		if (key === null || type === null) return null;
		result.push(`prop(${key},${member.optional ? "?" : "!"},${member.readonly ? "ro" : "rw"},${type})`);
	}
	result.sort();
	return `{${result.join(",")}}`;
}

export function canonicalType(node: ESTree.TSType, parameters: Map<string, string>): string | null {
	switch (node.type) {
		case "TSAnyKeyword": case "TSBigIntKeyword": case "TSBooleanKeyword": case "TSNeverKeyword":
		case "TSNullKeyword": case "TSNumberKeyword": case "TSObjectKeyword": case "TSStringKeyword":
		case "TSSymbolKeyword": case "TSUndefinedKeyword": case "TSUnknownKeyword": case "TSVoidKeyword": return node.type;
		case "TSLiteralType": { const value = literalValue(node); return value === null ? null : `literal(${value})`; }
		case "TSArrayType": { const element = canonicalType(node.elementType, parameters); return element === null ? null : `array(${element})`; }
		case "TSParenthesizedType": return canonicalType(node.typeAnnotation, parameters);
		case "TSTypeOperator": { const type = canonicalType(node.typeAnnotation, parameters); return type === null ? null : `${node.operator}(${type})`; }
		case "TSUnionType": case "TSIntersectionType": {
			const types = node.types.map((type) => canonicalType(type, parameters));
			if (types.some((type) => type === null)) return null;
			return `${node.type === "TSUnionType" ? "union" : "intersection"}(${[...new Set(types)].sort().join(",")})`;
		}
		case "TSTypeLiteral": return canonicalMembers(node.members, parameters);
		case "TSTypeReference": {
			const name = canonicalTypeName(node.typeName);
			if (name === null) return null;
			const arguments_ = node.typeArguments?.params.map((type) => canonicalType(type, parameters)) ?? [];
			if (arguments_.some((type) => type === null)) return null;
			return `ref(${parameters.get(name) ?? name}<${arguments_.join(",")}>)`;
		}
		default: return null;
	}
}

export function canonicalDeclaration(node: TypeDeclaration): string | null {
	const parameters = new Map<string, string>();
	for (const [index, parameter] of (node.typeParameters?.params ?? []).entries()) parameters.set(parameter.name.name, `$${index}`);
	if (node.type === "TSTypeAliasDeclaration") return node.typeAnnotation.type === "TSTypeLiteral" ? canonicalMembers(node.typeAnnotation.members, parameters) : null;
	return node.extends.length === 0 ? canonicalMembers(node.body.body, parameters) : null;
}

export function memberCall(node: ESTree.Expression): { name: string; object: ESTree.Expression; arguments_: ESTree.Expression[]; typeArguments: ESTree.TSTypeParameterInstantiation | null } | null {
	if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.computed || node.callee.property.type !== "Identifier" || node.arguments.some((argument) => argument.type === "SpreadElement")) return null;
	return { name: node.callee.property.name, object: node.callee.object, arguments_: node.arguments as ESTree.Expression[], typeArguments: node.typeArguments ?? null };
}

export function factoryCall(node: ESTree.Expression, namespaces: Set<string>, functions: Map<string, string>): { name: string; arguments_: ESTree.Expression[] } | null {
	if (node.type !== "CallExpression" || node.arguments.some((argument) => argument.type === "SpreadElement")) return null;
	if (node.callee.type === "Identifier") { const name = functions.get(node.callee.name); return name === undefined ? null : { name, arguments_: node.arguments as ESTree.Expression[] }; }
	if (node.callee.type !== "MemberExpression" || node.callee.computed || node.callee.object.type !== "Identifier" || node.callee.property.type !== "Identifier" || !namespaces.has(node.callee.object.name)) return null;
	return { name: node.callee.property.name, arguments_: node.arguments as ESTree.Expression[] };
}

export function schemaLiteral(node: ESTree.Expression): string | null {
	if (node.type !== "Literal") return null;
	if (typeof node.value === "string") return JSON.stringify(node.value);
	if (typeof node.value === "number" || typeof node.value === "boolean") return String(node.value);
	if (typeof node.value === "bigint") return `${node.value}n`;
	return null;
}
