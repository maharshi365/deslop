import type { ESTree } from "@oxlint/plugins";
import { factoryCall, memberCall, propertyKey, schemaLiteral } from "./shared.ts";

const ignoredZodMethods = new Set(["min", "max", "length", "nonempty", "email", "url", "uuid", "guid", "cuid", "cuid2", "ulid", "xid", "ksuid", "nanoid", "regex", "includes", "startsWith", "endsWith", "datetime", "date", "time", "duration", "ip", "cidr", "emoji", "base64", "base64url", "jwt", "int", "safe", "finite", "multipleOf", "step", "positive", "negative", "nonpositive", "nonnegative", "gt", "gte", "lt", "lte", "describe", "brand", "readonly", "default"]);
type CanonicalObject = { fingerprint: string; properties: number };
const keywordTypes: Record<string, string> = { string: "TSStringKeyword", number: "TSNumberKeyword", boolean: "TSBooleanKeyword", bigint: "TSBigIntKeyword", unknown: "TSUnknownKeyword", any: "TSAnyKeyword", never: "TSNeverKeyword", null: "TSNullKeyword", undefined: "TSUndefinedKeyword", void: "TSVoidKeyword" };
const union = (types: string[]) => `union(${[...new Set(types)].sort().join(",")})`;

function objectFingerprint(node: ESTree.Expression, canonicalProperty: (value: ESTree.Expression) => { type: string; optional: boolean } | null): CanonicalObject | null {
	if (node.type !== "ObjectExpression") return null;
	const members: string[] = [];
	for (const property of node.properties) {
		if (property.type !== "Property" || property.computed || property.kind !== "init") return null;
		const key = propertyKey(property.key), value = canonicalProperty(property.value);
		if (key === null || value === null) return null;
		members.push(`prop(${key},${value.optional ? "?" : "!"},rw,${value.type})`);
	}
	members.sort();
	return { fingerprint: `{${members.join(",")}}`, properties: members.length };
}

function canonicalZodProperty(node: ESTree.Expression, namespaces: Set<string>): { type: string; optional: boolean } | null {
	let current = node, optional = false, nullable = false;
	while (true) {
		const call = memberCall(current);
		if (call === null || !((["optional", "nullish"].includes(call.name) && call.arguments_.length === 0) || ignoredZodMethods.has(call.name))) break;
		if (call.name === "optional") optional = true;
		if (call.name === "nullish") { optional = true; nullable = true; }
		current = call.object;
	}
	const type = canonicalZod(current, namespaces);
	return type === null ? null : { type: nullable ? union(["TSNullKeyword", type]) : type, optional };
}

export function canonicalZodObject(node: ESTree.Expression, namespaces: Set<string>): CanonicalObject | null {
	return objectFingerprint(node, (value) => canonicalZodProperty(value, namespaces));
}

function canonicalZod(node: ESTree.Expression, namespaces: Set<string>): string | null {
	const call = memberCall(node);
	if (call === null) return null;
	if (call.object.type === "Identifier" && namespaces.has(call.object.name)) {
		if (call.name in keywordTypes) return call.arguments_.length === 0 ? keywordTypes[call.name] : null;
		if (call.name === "literal") { const value = call.arguments_.length === 1 ? schemaLiteral(call.arguments_[0]) : null; return value === null ? null : `literal(${value})`; }
		if (call.name === "enum" || call.name === "union") {
			if (call.arguments_.length !== 1 || call.arguments_[0].type !== "ArrayExpression") return null;
			const types = call.arguments_[0].elements.map((element) => element === null || element.type === "SpreadElement" ? null : call.name === "enum" ? schemaLiteral(element) : canonicalZod(element, namespaces));
			return types.some((type) => type === null) ? null : union(types as string[]);
		}
		if (call.name === "object") return call.arguments_.length === 1 ? canonicalZodObject(call.arguments_[0], namespaces)?.fingerprint ?? null : null;
		if (call.name === "array") { const element = call.arguments_.length === 1 ? canonicalZod(call.arguments_[0], namespaces) : null; return element === null ? null : `array(${element})`; }
		return null;
	}
	const inner = canonicalZod(call.object, namespaces);
	if (inner === null) return null;
	if (call.name === "optional") return union(["TSUndefinedKeyword", inner]);
	if (call.name === "nullable") return union(["TSNullKeyword", inner]);
	if (call.name === "nullish") return union(["TSNullKeyword", "TSUndefinedKeyword", inner]);
	if (call.name === "array") return call.arguments_.length === 0 ? `array(${inner})` : null;
	return ignoredZodMethods.has(call.name) ? inner : null;
}

function canonicalValibotProperty(node: ESTree.Expression, namespaces: Set<string>, functions: Map<string, string>): { type: string; optional: boolean } | null {
	const call = factoryCall(node, namespaces, functions);
	if (call !== null && ["optional", "nullable", "nullish"].includes(call.name)) {
		if (call.arguments_.length !== 1) return null;
		const inner = canonicalValibot(call.arguments_[0], namespaces, functions);
		if (inner === null) return null;
		return { type: call.name === "nullable" || call.name === "nullish" ? union(["TSNullKeyword", inner]) : inner, optional: call.name === "optional" || call.name === "nullish" };
	}
	const type = canonicalValibot(node, namespaces, functions);
	return type === null ? null : { type, optional: false };
}

export function canonicalValibotObject(node: ESTree.Expression, namespaces: Set<string>, functions: Map<string, string>): CanonicalObject | null {
	return objectFingerprint(node, (value) => canonicalValibotProperty(value, namespaces, functions));
}

function canonicalValibot(node: ESTree.Expression, namespaces: Set<string>, functions: Map<string, string>): string | null {
	const call = factoryCall(node, namespaces, functions);
	if (call === null) return null;
	if (call.name in keywordTypes) return call.arguments_.length === 0 ? keywordTypes[call.name] : null;
	if (call.name === "literal") { const value = call.arguments_.length === 1 ? schemaLiteral(call.arguments_[0]) : null; return value === null ? null : `literal(${value})`; }
	if (call.name === "picklist" || call.name === "union") {
		if (call.arguments_.length !== 1 || call.arguments_[0].type !== "ArrayExpression") return null;
		const types = call.arguments_[0].elements.map((element) => element === null || element.type === "SpreadElement" ? null : call.name === "picklist" ? schemaLiteral(element) : canonicalValibot(element, namespaces, functions));
		return types.some((type) => type === null) ? null : union(types as string[]);
	}
	if (call.name === "array") { const element = call.arguments_.length === 1 ? canonicalValibot(call.arguments_[0], namespaces, functions) : null; return element === null ? null : `array(${element})`; }
	return call.name === "object" && call.arguments_.length === 1 ? canonicalValibotObject(call.arguments_[0], namespaces, functions)?.fingerprint ?? null : null;
}

function canonicalArkString(value: string): string | null {
	let current = value.trim();
	while (current.startsWith("(") && current.endsWith(")")) current = current.slice(1, -1).trim();
	if (current.endsWith("[]")) { const element = canonicalArkString(current.slice(0, -2)); return element === null ? null : `array(${element})`; }
	if (current.includes("|")) { const types = current.split("|").map(canonicalArkString); return types.some((type) => type === null) ? null : union(types as string[]); }
	if (/^'(?:[^'\\]|\\.)*'$/.test(current) || /^"(?:[^"\\]|\\.)*"$/.test(current)) return `literal(${JSON.stringify(current.slice(1, -1))})`;
	if (/^-?\d+(?:\.\d+)?$/.test(current) || current === "true" || current === "false") return `literal(${current})`;
	return keywordTypes[current] ?? null;
}

export function canonicalArkObject(node: ESTree.Expression): CanonicalObject | null {
	if (node.type !== "ObjectExpression") return null;
	const members: string[] = [];
	for (const property of node.properties) {
		if (property.type !== "Property" || property.computed || property.kind !== "init") return null;
		const keyValue = property.key as { value?: unknown }, rawKey = typeof keyValue.value === "string" ? keyValue.value : propertyKey(property.key);
		if (rawKey === null) return null;
		const optional = rawKey.endsWith("?"), key = optional ? rawKey.slice(0, -1) : rawKey, literal = property.value as { value?: unknown };
		const type = typeof literal.value === "string" ? canonicalArkString(literal.value) : canonicalArkObject(property.value)?.fingerprint;
		if (type === null || type === undefined) return null;
		members.push(`prop(${key},${optional ? "?" : "!"},rw,${type})`);
	}
	members.sort();
	return { fingerprint: `{${members.join(",")}}`, properties: members.length };
}
