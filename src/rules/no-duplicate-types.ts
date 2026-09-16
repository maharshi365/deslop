import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type TypeDeclaration = ESTree.TSTypeAliasDeclaration | ESTree.TSInterfaceDeclaration;

interface RuleOptions {
	message?: string;
	minProperties?: number;
}

interface SeenType {
	name: string;
	filename: string;
}

function propertyKey(node: unknown): string | null {
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

function canonicalTypeName(node: ESTree.TSTypeName): string | null {
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

function canonicalType(node: ESTree.TSType, parameters: Map<string, string>): string | null {
	switch (node.type) {
		case "TSAnyKeyword": case "TSBigIntKeyword": case "TSBooleanKeyword": case "TSNeverKeyword":
		case "TSNullKeyword": case "TSNumberKeyword": case "TSObjectKeyword": case "TSStringKeyword":
		case "TSSymbolKeyword": case "TSUndefinedKeyword": case "TSUnknownKeyword": case "TSVoidKeyword":
			return node.type;
		case "TSLiteralType": {
			const value = literalValue(node);
			return value === null ? null : `literal(${value})`;
		}
		case "TSArrayType": {
			const element = canonicalType(node.elementType, parameters);
			return element === null ? null : `array(${element})`;
		}
		case "TSParenthesizedType": return canonicalType(node.typeAnnotation, parameters);
		case "TSTypeOperator": {
			const type = canonicalType(node.typeAnnotation, parameters);
			return type === null ? null : `${node.operator}(${type})`;
		}
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

function canonicalDeclaration(node: TypeDeclaration): string | null {
	const parameters = new Map<string, string>();
	for (const [index, parameter] of (node.typeParameters?.params ?? []).entries()) {
		parameters.set(parameter.name.name, `$${index}`);
	}
	if (node.type === "TSTypeAliasDeclaration") {
		if (node.typeAnnotation.type !== "TSTypeLiteral") return null;
		return canonicalMembers(node.typeAnnotation.members, parameters);
	}
	if (node.extends.length > 0) return null;
	return canonicalMembers(node.body.body, parameters);
}

/** Report exact structural duplicates without TypeScript assignability or fuzzy matching. */
export const noDuplicateTypesRule = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Report structurally identical TypeScript declarations" },
		messages: { duplicate: "{{message}} First seen as {{firstName}} in {{firstFile}}." },
		schema: [{ type: "object", properties: { message: { type: "string" }, minProperties: { type: "integer", minimum: 0 } }, additionalProperties: false }],
	},
	createOnce(context) {
		const seen = new Map<string, SeenType>();
		let options: RuleOptions = {};
		const report = (node: TypeDeclaration, fingerprint: string) => {
			const first = seen.get(fingerprint);
			if (first === undefined) {
				seen.set(fingerprint, { name: node.id.name, filename: context.filename });
				return;
			}
			context.report({ node, messageId: "duplicate", data: { message: options.message ?? "This type is structurally identical to an existing declaration.", firstName: first.name, firstFile: first.filename } });
		};
		const inspect = (node: TypeDeclaration) => {
			let properties: number;
			if (node.type === "TSTypeAliasDeclaration") {
				if (node.typeAnnotation.type !== "TSTypeLiteral") return;
				properties = node.typeAnnotation.members.length;
			} else {
				properties = node.body.body.length;
			}
			const fingerprint = canonicalDeclaration(node);
			if (fingerprint === null) return;
			if (properties < (options.minProperties ?? 2)) return;
			report(node, fingerprint);
		};
		return {
			Program() { options = (context.options[0] as RuleOptions | undefined) ?? {}; },
			TSTypeAliasDeclaration: inspect,
			TSInterfaceDeclaration: inspect,
		};
	},
});
