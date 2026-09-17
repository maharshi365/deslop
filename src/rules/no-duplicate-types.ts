import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type TypeDeclaration = ESTree.TSTypeAliasDeclaration | ESTree.TSInterfaceDeclaration;
type ReportNode = TypeDeclaration | ESTree.VariableDeclarator;

interface RuleOptions {
	message?: string;
	minProperties?: number;
	schemas?: {
		libraries?: string[];
		matchTypes?: boolean;
	};
}

interface SeenType {
	name: string;
	filename: string;
}

const ignoredZodMethods = new Set([
	"min", "max", "length", "nonempty", "email", "url", "uuid", "guid", "cuid", "cuid2", "ulid", "xid", "ksuid",
	"nanoid", "regex", "includes", "startsWith", "endsWith", "datetime", "date", "time", "duration", "ip", "cidr",
	"emoji", "base64", "base64url", "jwt", "int", "safe", "finite", "multipleOf", "step", "positive", "negative",
	"nonpositive", "nonnegative", "gt", "gte", "lt", "lte", "describe", "brand", "readonly", "default",
]);

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

function memberCall(node: ESTree.Expression): { name: string; object: ESTree.Expression; arguments_: ESTree.Expression[] } | null {
	if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.computed || node.callee.property.type !== "Identifier") return null;
	if (node.arguments.some((argument) => argument.type === "SpreadElement")) return null;
	return { name: node.callee.property.name, object: node.callee.object, arguments_: node.arguments as ESTree.Expression[] };
}

function schemaLiteral(node: ESTree.Expression): string | null {
	if (node.type !== "Literal") return null;
	if (typeof node.value === "string") return JSON.stringify(node.value);
	if (typeof node.value === "number" || typeof node.value === "boolean") return String(node.value);
	if (typeof node.value === "bigint") return `${node.value}n`;
	return null;
}

function canonicalSchemaProperty(node: ESTree.Expression, zodNamespaces: Set<string>): { type: string; optional: boolean } | null {
	let current = node;
	let optional = false;
	let nullable = false;
	while (true) {
		const call = memberCall(current);
		if (call === null || !(["optional", "nullish"].includes(call.name) && call.arguments_.length === 0 || ignoredZodMethods.has(call.name))) break;
		if (call.name === "optional") optional = true;
		if (call.name === "nullish") {
			optional = true;
			nullable = true;
		}
		current = call.object;
	}
	const type = canonicalSchema(current, zodNamespaces);
	return type === null ? null : { type: nullable ? `union(${["TSNullKeyword", type].sort().join(",")})` : type, optional };
}

function canonicalSchemaObject(node: ESTree.Expression, zodNamespaces: Set<string>): { fingerprint: string; properties: number } | null {
	if (node.type !== "ObjectExpression") return null;
	const members: string[] = [];
	for (const property of node.properties) {
		if (property.type !== "Property" || property.computed || property.kind !== "init") return null;
		const key = propertyKey(property.key);
		if (key === null) return null;
		const value = canonicalSchemaProperty(property.value, zodNamespaces);
		if (value === null) return null;
		members.push(`prop(${key},${value.optional ? "?" : "!"},rw,${value.type})`);
	}
	members.sort();
	return { fingerprint: `{${members.join(",")}}`, properties: members.length };
}

function canonicalSchema(node: ESTree.Expression, zodNamespaces: Set<string>): string | null {
	const call = memberCall(node);
	if (call === null) return null;
	if (call.object.type === "Identifier" && zodNamespaces.has(call.object.name)) {
		switch (call.name) {
			case "string": return call.arguments_.length === 0 ? "TSStringKeyword" : null;
			case "number": return call.arguments_.length === 0 ? "TSNumberKeyword" : null;
			case "boolean": return call.arguments_.length === 0 ? "TSBooleanKeyword" : null;
			case "bigint": return call.arguments_.length === 0 ? "TSBigIntKeyword" : null;
			case "unknown": return call.arguments_.length === 0 ? "TSUnknownKeyword" : null;
			case "any": return call.arguments_.length === 0 ? "TSAnyKeyword" : null;
			case "never": return call.arguments_.length === 0 ? "TSNeverKeyword" : null;
			case "null": return call.arguments_.length === 0 ? "TSNullKeyword" : null;
			case "undefined": return call.arguments_.length === 0 ? "TSUndefinedKeyword" : null;
			case "void": return call.arguments_.length === 0 ? "TSVoidKeyword" : null;
			case "literal": {
				if (call.arguments_.length !== 1) return null;
				const value = schemaLiteral(call.arguments_[0]);
				return value === null ? null : `literal(${value})`;
			}
			case "enum": {
				if (call.arguments_.length !== 1 || call.arguments_[0].type !== "ArrayExpression") return null;
				const values = call.arguments_[0].elements.map((element) => element === null || element.type === "SpreadElement" ? null : schemaLiteral(element));
				if (values.some((value) => value === null)) return null;
				return `union(${[...new Set(values)].sort().join(",")})`;
			}
			case "object": {
				if (call.arguments_.length !== 1) return null;
				return canonicalSchemaObject(call.arguments_[0], zodNamespaces)?.fingerprint ?? null;
			}
			case "array": {
				if (call.arguments_.length !== 1) return null;
				const element = canonicalSchema(call.arguments_[0], zodNamespaces);
				return element === null ? null : `array(${element})`;
			}
			case "union": {
				if (call.arguments_.length !== 1 || call.arguments_[0].type !== "ArrayExpression") return null;
				const types = call.arguments_[0].elements.map((element) => element === null || element.type === "SpreadElement" ? null : canonicalSchema(element, zodNamespaces));
				if (types.some((type) => type === null)) return null;
				return `union(${[...new Set(types)].sort().join(",")})`;
			}
			default: return null;
		}
	}
	const inner = canonicalSchema(call.object, zodNamespaces);
	if (inner === null) return null;
	switch (call.name) {
		case "optional": return `union(${["TSUndefinedKeyword", inner].sort().join(",")})`;
		case "nullable": return `union(${["TSNullKeyword", inner].sort().join(",")})`;
		case "nullish": return `union(${["TSNullKeyword", "TSUndefinedKeyword", inner].sort().join(",")})`;
		case "array": return call.arguments_.length === 0 ? `array(${inner})` : null;
		default: return ignoredZodMethods.has(call.name) ? inner : null;
	}
}

/** Report exact structural duplicates without TypeScript assignability or fuzzy matching. */
export const noDuplicateTypesRule = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Report structurally identical TypeScript declarations" },
		messages: { duplicate: "{{message}} First seen as {{firstName}} in {{firstFile}}." },
		schema: [{ type: "object", properties: { message: { type: "string" }, minProperties: { type: "integer", minimum: 0 }, schemas: { type: "object", properties: { libraries: { type: "array", items: { enum: ["zod"] } }, matchTypes: { type: "boolean" } }, additionalProperties: false } }, additionalProperties: false }],
	},
	createOnce(context) {
		const seen = new Map<string, SeenType>();
		let options: RuleOptions = {};
		const report = (node: ReportNode, name: string, fingerprint: string, kind: "type" | "schema") => {
			const key = options.schemas?.matchTypes === false ? `${kind}:${fingerprint}` : fingerprint;
			const first = seen.get(key);
			if (first === undefined) {
				seen.set(key, { name, filename: context.filename });
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
			report(node, node.id.name, fingerprint, "type");
		};
		const zodNamespaces = new Set<string>();
		const inspectSchema = (node: ESTree.VariableDeclarator) => {
			if (options.schemas?.libraries?.includes("zod") !== true || node.id.type !== "Identifier" || node.init === null) return;
			const call = memberCall(node.init);
			if (call === null || call.name !== "object" || call.arguments_.length !== 1 || call.object.type !== "Identifier" || !zodNamespaces.has(call.object.name)) return;
			const schema = canonicalSchemaObject(call.arguments_[0], zodNamespaces);
			if (schema === null || schema.properties < (options.minProperties ?? 2)) return;
			report(node, node.id.name, schema.fingerprint, "schema");
		};
		return {
			Program() { options = (context.options[0] as RuleOptions | undefined) ?? {}; },
			ImportDeclaration(node) {
				if (node.source.value !== "zod") return;
				for (const specifier of node.specifiers) {
					if (specifier.type === "ImportNamespaceSpecifier" || specifier.type === "ImportDefaultSpecifier") zodNamespaces.add(specifier.local.name);
					if (specifier.type === "ImportSpecifier" && specifier.imported.type === "Identifier" && specifier.imported.name === "z") zodNamespaces.add(specifier.local.name);
				}
			},
			TSTypeAliasDeclaration: inspect,
			TSInterfaceDeclaration: inspect,
			VariableDeclarator: inspectSchema,
		};
	},
});
