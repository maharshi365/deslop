import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type TypeDeclaration = ESTree.TSTypeAliasDeclaration | ESTree.TSInterfaceDeclaration;
type ReportNode = TypeDeclaration | ESTree.VariableDeclarator;
type DuplicateKind = "type" | "schema" | "drizzle-select" | "drizzle-insert";

interface RuleOptions {
	message?: string;
	minProperties?: number;
	schemas?: {
		libraries?: string[];
		matchTypes?: boolean;
	};
	drizzle?: {
		models?: ("select" | "insert")[];
		matchTypes?: boolean;
	};
}

interface SeenType {
	node: ReportNode;
	name: string;
	filename: string;
}

interface DrizzleBuilder {
	name: string;
	type: string;
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

function memberCall(node: ESTree.Expression): { name: string; object: ESTree.Expression; arguments_: ESTree.Expression[]; typeArguments: ESTree.TSTypeParameterInstantiation | null } | null {
	if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.computed || node.callee.property.type !== "Identifier") return null;
	if (node.arguments.some((argument) => argument.type === "SpreadElement")) return null;
	return { name: node.callee.property.name, object: node.callee.object, arguments_: node.arguments as ESTree.Expression[], typeArguments: node.typeArguments ?? null };
}

function factoryCall(node: ESTree.Expression, namespaces: Set<string>, functions: Map<string, string>): { name: string; arguments_: ESTree.Expression[] } | null {
	if (node.type !== "CallExpression" || node.arguments.some((argument) => argument.type === "SpreadElement")) return null;
	if (node.callee.type === "Identifier") {
		const name = functions.get(node.callee.name);
		return name === undefined ? null : { name, arguments_: node.arguments as ESTree.Expression[] };
	}
	if (node.callee.type !== "MemberExpression" || node.callee.computed || node.callee.object.type !== "Identifier" || node.callee.property.type !== "Identifier" || !namespaces.has(node.callee.object.name)) return null;
	return { name: node.callee.property.name, arguments_: node.arguments as ESTree.Expression[] };
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

function canonicalValibotProperty(node: ESTree.Expression, namespaces: Set<string>, functions: Map<string, string>): { type: string; optional: boolean } | null {
	const call = factoryCall(node, namespaces, functions);
	if (call !== null && ["optional", "nullable", "nullish"].includes(call.name)) {
		if (call.arguments_.length !== 1) return null;
		const inner = canonicalValibot(call.arguments_[0], namespaces, functions);
		if (inner === null) return null;
		const nullable = call.name === "nullable" || call.name === "nullish";
		return { type: nullable ? `union(${["TSNullKeyword", inner].sort().join(",")})` : inner, optional: call.name === "optional" || call.name === "nullish" };
	}
	const type = canonicalValibot(node, namespaces, functions);
	return type === null ? null : { type, optional: false };
}

function canonicalValibotObject(node: ESTree.Expression, namespaces: Set<string>, functions: Map<string, string>): { fingerprint: string; properties: number } | null {
	if (node.type !== "ObjectExpression") return null;
	const members: string[] = [];
	for (const property of node.properties) {
		if (property.type !== "Property" || property.computed || property.kind !== "init") return null;
		const key = propertyKey(property.key);
		if (key === null) return null;
		const value = canonicalValibotProperty(property.value, namespaces, functions);
		if (value === null) return null;
		members.push(`prop(${key},${value.optional ? "?" : "!"},rw,${value.type})`);
	}
	members.sort();
	return { fingerprint: `{${members.join(",")}}`, properties: members.length };
}

function canonicalValibot(node: ESTree.Expression, namespaces: Set<string>, functions: Map<string, string>): string | null {
	const call = factoryCall(node, namespaces, functions);
	if (call === null) return null;
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
		case "picklist": case "union": {
			if (call.arguments_.length !== 1 || call.arguments_[0].type !== "ArrayExpression") return null;
			const types = call.arguments_[0].elements.map((element) => element === null || element.type === "SpreadElement" ? null : call.name === "picklist" ? schemaLiteral(element) : canonicalValibot(element, namespaces, functions));
			if (types.some((type) => type === null)) return null;
			return `union(${[...new Set(types)].sort().join(",")})`;
		}
		case "array": {
			if (call.arguments_.length !== 1) return null;
			const element = canonicalValibot(call.arguments_[0], namespaces, functions);
			return element === null ? null : `array(${element})`;
		}
		case "object": {
			if (call.arguments_.length !== 1) return null;
			return canonicalValibotObject(call.arguments_[0], namespaces, functions)?.fingerprint ?? null;
		}
		default: return null;
	}
}

function canonicalArkString(value: string): string | null {
	let current = value.trim();
	while (current.startsWith("(") && current.endsWith(")")) current = current.slice(1, -1).trim();
	if (current.endsWith("[]")) {
		const element = canonicalArkString(current.slice(0, -2));
		return element === null ? null : `array(${element})`;
	}
	if (current.includes("|")) {
		const types = current.split("|").map((part) => canonicalArkString(part));
		if (types.some((type) => type === null)) return null;
		return `union(${[...new Set(types)].sort().join(",")})`;
	}
	if (/^'(?:[^'\\]|\\.)*'$/.test(current) || /^"(?:[^"\\]|\\.)*"$/.test(current)) return `literal(${JSON.stringify(current.slice(1, -1))})`;
	if (/^-?\d+(?:\.\d+)?$/.test(current) || current === "true" || current === "false") return `literal(${current})`;
	const keywords: Record<string, string> = { string: "TSStringKeyword", number: "TSNumberKeyword", boolean: "TSBooleanKeyword", bigint: "TSBigIntKeyword", unknown: "TSUnknownKeyword", any: "TSAnyKeyword", never: "TSNeverKeyword", null: "TSNullKeyword", undefined: "TSUndefinedKeyword", void: "TSVoidKeyword" };
	return keywords[current] ?? null;
}

function canonicalArkObject(node: ESTree.Expression): { fingerprint: string; properties: number } | null {
	if (node.type !== "ObjectExpression") return null;
	const members: string[] = [];
	for (const property of node.properties) {
		if (property.type !== "Property" || property.computed || property.kind !== "init") return null;
		const keyValue = property.key as { value?: unknown };
		const rawKey = typeof keyValue.value === "string" ? keyValue.value : propertyKey(property.key);
		if (rawKey === null) return null;
		const optional = rawKey.endsWith("?");
		const key = optional ? rawKey.slice(0, -1) : rawKey;
		const literal = property.value as { value?: unknown };
		const type = typeof literal.value === "string" ? canonicalArkString(literal.value) : canonicalArkObject(property.value)?.fingerprint;
		if (type === null || type === undefined) return null;
		members.push(`prop(${key},${optional ? "?" : "!"},rw,${type})`);
	}
	members.sort();
	return { fingerprint: `{${members.join(",")}}`, properties: members.length };
}

function canonicalDrizzleIntegerType(node: ESTree.CallExpression, builder: DrizzleBuilder): string | null {
	if (builder.name !== "integer" || node.arguments.length === 1) return builder.type;
	if (node.arguments.length !== 2 || node.arguments[1].type !== "ObjectExpression") return null;
	let mode: string | null = null;
	for (const property of node.arguments[1].properties) {
		if (property.type !== "Property" || property.computed || property.kind !== "init" || propertyKey(property.key) !== "mode" || property.value.type !== "Literal" || typeof property.value.value !== "string") return null;
		mode = property.value.value;
	}
	return mode === null ? builder.type : mode === "boolean" ? "TSBooleanKeyword" : null;
}

function canonicalDrizzleColumn(node: ESTree.Expression, builders: Map<string, DrizzleBuilder>): { type: string; notNull: boolean; hasDefault: boolean } | null {
	let current = node;
	let notNull = false;
	let hasDefault = false;
	let typeOverride: string | null = null;
	while (true) {
		const call = memberCall(current);
		if (call === null) break;
		if (call.name === "notNull" && call.arguments_.length === 0) notNull = true;
		else if (call.name === "primaryKey") notNull = true;
		else if (call.name === "$type" && call.arguments_.length === 0 && call.typeArguments !== null && call.typeArguments.params.length === 1 && typeOverride === null) {
			typeOverride = canonicalType(call.typeArguments.params[0], new Map());
			if (typeOverride === null) return null;
		}
		else if (["default", "defaultNow", "defaultRandom", "$default", "$defaultFn"].includes(call.name)) hasDefault = true;
		else if (!["primaryKey", "unique", "references", "onUpdate", "$onUpdate", "$onUpdateFn"].includes(call.name)) return null;
		current = call.object;
	}
	if (current.type !== "CallExpression" || current.callee.type !== "Identifier") return null;
	const builder = builders.get(current.callee.name);
	if (builder === undefined) return null;
	const type = typeOverride ?? canonicalDrizzleIntegerType(current, builder);
	if (type === null) return null;
	if (builder.name === "serial") hasDefault = true;
	return { type, notNull, hasDefault };
}

function canonicalDrizzleTable(node: ESTree.Expression, tableFactories: Set<string>, schemaObjects: Set<string>, builders: Map<string, DrizzleBuilder>, model: "select" | "insert"): { fingerprint: string; properties: number } | null {
	if (node.type !== "CallExpression" || node.arguments.length < 2 || node.arguments[1].type === "SpreadElement") return null;
	const directTable = node.callee.type === "Identifier" && tableFactories.has(node.callee.name);
	const schemaTable = node.callee.type === "MemberExpression" && !node.callee.computed && node.callee.object.type === "Identifier" && schemaObjects.has(node.callee.object.name) && node.callee.property.type === "Identifier" && node.callee.property.name === "table";
	if (!directTable && !schemaTable) return null;
	const columns = node.arguments[1];
	if (columns.type !== "ObjectExpression") return null;
	const members: string[] = [];
	for (const property of columns.properties) {
		if (property.type !== "Property" || property.computed || property.kind !== "init") return null;
		const key = propertyKey(property.key);
		if (key === null) return null;
		const column = canonicalDrizzleColumn(property.value, builders);
		if (column === null) return null;
		const optional = model === "insert" && (!column.notNull || column.hasDefault);
		const type = column.notNull ? column.type : `union(${["TSNullKeyword", column.type].sort().join(",")})`;
		members.push(`prop(${key},${optional ? "?" : "!"},rw,${type})`);
	}
	members.sort();
	return { fingerprint: `{${members.join(",")}}`, properties: members.length };
}

/** Report exact structural duplicates without TypeScript assignability or fuzzy matching. */
export const noDuplicateTypesRule = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Report structurally identical TypeScript declarations" },
		messages: { duplicate: "{{message}} First seen as {{firstName}} in {{firstFile}}." },
		schema: [{ type: "object", properties: { message: { type: "string" }, minProperties: { type: "integer", minimum: 0 }, schemas: { type: "object", properties: { libraries: { type: "array", items: { enum: ["zod", "valibot", "arktype"] } }, matchTypes: { type: "boolean" } }, additionalProperties: false }, drizzle: { type: "object", properties: { models: { type: "array", items: { enum: ["select", "insert"] } }, matchTypes: { type: "boolean" } }, additionalProperties: false } }, additionalProperties: false }],
	},
	createOnce(context) {
		const seen = new Map<string, SeenType>();
		let options: RuleOptions = {};
		const report = (node: ReportNode, name: string, fingerprint: string, kind: DuplicateKind) => {
			const isolates = kind === "schema" ? options.schemas?.matchTypes === false : kind.startsWith("drizzle-") && options.drizzle?.matchTypes === false;
			const key = isolates ? `${kind}:${fingerprint}` : fingerprint;
			const first = seen.get(key);
			if (first === undefined) {
				seen.set(key, { node, name, filename: context.filename });
				return;
			}
			if (first.node === node) return;
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
		const valibotNamespaces = new Set<string>();
		const valibotFunctions = new Map<string, string>();
		const arkTypeFunctions = new Set<string>();
		let hasArkTypeImport = false;
		const drizzleTables = new Set<string>();
		const drizzleSchemaFactories = new Set<string>();
		const drizzleSchemaObjects = new Set<string>();
		const drizzleBuilders = new Map<string, DrizzleBuilder>();
		const drizzleModels = new Map<string, Map<"select" | "insert", string>>();
		const drizzleAliases: ESTree.TSTypeAliasDeclaration[] = [];
		const inspectSchema = (node: ESTree.VariableDeclarator) => {
			if (options.schemas?.libraries?.includes("zod") !== true || node.id.type !== "Identifier" || node.init === null) return;
			const call = memberCall(node.init);
			if (call === null || call.name !== "object" || call.arguments_.length !== 1 || call.object.type !== "Identifier" || !zodNamespaces.has(call.object.name)) return;
			const schema = canonicalSchemaObject(call.arguments_[0], zodNamespaces);
			if (schema === null || schema.properties < (options.minProperties ?? 2)) return;
			report(node, node.id.name, schema.fingerprint, "schema");
		};
		const inspectValibot = (node: ESTree.VariableDeclarator) => {
			if (options.schemas?.libraries?.includes("valibot") !== true || node.id.type !== "Identifier" || node.init === null) return;
			const call = factoryCall(node.init, valibotNamespaces, valibotFunctions);
			if (call === null || call.name !== "object" || call.arguments_.length !== 1) return;
			const schema = canonicalValibotObject(call.arguments_[0], valibotNamespaces, valibotFunctions);
			if (schema === null || schema.properties < (options.minProperties ?? 2)) return;
			report(node, node.id.name, schema.fingerprint, "schema");
		};
		const inspectArkType = (node: ESTree.VariableDeclarator) => {
			const callee = node.init?.type === "CallExpression" ? node.init.callee as { name?: unknown } : null;
			if (options.schemas?.libraries?.includes("arktype") !== true || node.id.type !== "Identifier" || node.init === null || node.init.type !== "CallExpression" || typeof callee?.name !== "string" || !(arkTypeFunctions.has(callee.name) || hasArkTypeImport && callee.name === "type") || node.init.arguments.length !== 1 || node.init.arguments[0].type === "SpreadElement") return;
			const schema = canonicalArkObject(node.init.arguments[0]);
			if (schema === null || schema.properties < (options.minProperties ?? 2)) return;
			report(node, node.id.name, schema.fingerprint, "schema");
		};
		const inspectDrizzle = (node: ESTree.VariableDeclarator) => {
			if (options.drizzle === undefined || node.id.type !== "Identifier" || node.init === null) return;
			const models = new Map<"select" | "insert", string>();
			for (const model of options.drizzle.models ?? ["select", "insert"]) {
				const table = canonicalDrizzleTable(node.init, drizzleTables, drizzleSchemaObjects, drizzleBuilders, model);
				if (table === null || table.properties < (options.minProperties ?? 2)) continue;
				models.set(model, table.fingerprint);
				report(node, node.id.name, table.fingerprint, `drizzle-${model}`);
			}
			if (models.size > 0) drizzleModels.set(node.id.name, models);
		};
		const inspectDrizzleSchema = (node: ESTree.VariableDeclarator) => {
			if (node.id.type !== "Identifier" || node.init === null || node.init.type !== "CallExpression" || node.init.callee.type !== "Identifier" || !drizzleSchemaFactories.has(node.init.callee.name)) return;
			drizzleSchemaObjects.add(node.id.name);
		};
		const inspectDrizzleAlias = (node: ESTree.TSTypeAliasDeclaration) => {
			if (options.drizzle === undefined || node.typeAnnotation.type !== "TSTypeQuery" || node.typeAnnotation.typeArguments !== null) return;
			const name = canonicalTypeName(node.typeAnnotation.exprName as ESTree.TSTypeName);
			if (name === null) return;
			const match = /^(.*)\.\$infer(Select|Insert)$/.exec(name);
			if (match === null) return;
			const model = match[2] === "Select" ? "select" : "insert";
			const fingerprint = drizzleModels.get(match[1])?.get(model);
			if (fingerprint !== undefined) report(node, node.id.name, fingerprint, `drizzle-${model}`);
		};
		return {
			Program() { options = (context.options[0] as RuleOptions | undefined) ?? {}; },
			ImportDeclaration(node) {
				if (node.source.value === "zod") {
				for (const specifier of node.specifiers) {
					if (specifier.type === "ImportNamespaceSpecifier" || specifier.type === "ImportDefaultSpecifier") zodNamespaces.add(specifier.local.name);
					if (specifier.type === "ImportSpecifier" && specifier.imported.type === "Identifier" && specifier.imported.name === "z") zodNamespaces.add(specifier.local.name);
				}
				}
				if (node.source.value === "valibot") {
					for (const specifier of node.specifiers) {
						if (specifier.type === "ImportNamespaceSpecifier") valibotNamespaces.add(specifier.local.name);
						if (specifier.type === "ImportSpecifier" && specifier.imported.type === "Identifier") valibotFunctions.set(specifier.local.name, specifier.imported.name);
					}
				}
				if (node.source.value === "arktype") {
					hasArkTypeImport = true;
					for (const specifier of node.specifiers) {
					const imported = specifier.type === "ImportSpecifier" ? specifier.imported as { name?: unknown } : null;
					if (typeof imported?.name === "string" && imported.name === "type") arkTypeFunctions.add(specifier.local.name);
				}
				}
				const drizzleSource = /^drizzle-orm\/(pg|mysql|sqlite)-core$/.exec(String(node.source.value));
				if (drizzleSource !== null) {
					const dialect = drizzleSource[1];
					for (const specifier of node.specifiers) {
						if (specifier.type !== "ImportSpecifier" || specifier.imported.type !== "Identifier") continue;
						if (["pgTable", "mysqlTable", "sqliteTable"].includes(specifier.imported.name)) drizzleTables.add(specifier.local.name);
						if (specifier.imported.name === "pgSchema") drizzleSchemaFactories.add(specifier.local.name);
						const types: Record<string, string> = { text: "TSStringKeyword", varchar: "TSStringKeyword", uuid: "TSStringKeyword", char: "TSStringKeyword", integer: "TSNumberKeyword", int: "TSNumberKeyword", serial: "TSNumberKeyword", smallint: "TSNumberKeyword", real: "TSNumberKeyword", float: "TSNumberKeyword", doublePrecision: "TSNumberKeyword", boolean: "TSBooleanKeyword" };
						if (dialect === "sqlite") types.blob = "ref(Uint8Array<>)";
						const type = types[specifier.imported.name];
						if (type !== undefined) drizzleBuilders.set(specifier.local.name, { name: specifier.imported.name, type });
					}
				}
			},
			TSTypeAliasDeclaration(node) {
				inspect(node);
				drizzleAliases.push(node);
			},
			TSInterfaceDeclaration: inspect,
			VariableDeclarator(node) {
				inspectSchema(node);
				inspectValibot(node);
				inspectArkType(node);
				inspectDrizzleSchema(node);
				inspectDrizzle(node);
			},
			"Program:exit"() {
				for (const node of drizzleAliases) inspectDrizzleAlias(node);
			},
		};
	},
});
