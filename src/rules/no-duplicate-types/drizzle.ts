import type { ESTree } from "@oxlint/plugins";
import { canonicalType, memberCall, propertyKey } from "./shared.ts";

export interface DrizzleBuilder { name: string; type: string; }

function canonicalIntegerType(node: ESTree.CallExpression, builder: DrizzleBuilder): string | null {
	if (builder.name !== "integer" || node.arguments.length === 1) return builder.type;
	if (node.arguments.length !== 2 || node.arguments[1].type !== "ObjectExpression") return null;
	let mode: string | null = null;
	for (const property of node.arguments[1].properties) {
		if (property.type !== "Property" || property.computed || property.kind !== "init" || propertyKey(property.key) !== "mode" || property.value.type !== "Literal" || typeof property.value.value !== "string") return null;
		mode = property.value.value;
	}
	if (mode === null || mode === "number") return builder.type;
	return mode === "boolean" ? "TSBooleanKeyword" : null;
}

function canonicalColumn(node: ESTree.Expression, builders: Map<string, DrizzleBuilder>): { type: string; notNull: boolean; hasDefault: boolean } | null {
	let current = node, notNull = false, hasDefault = false, typeOverride: string | null = null;
	while (true) {
		const call = memberCall(current);
		if (call === null) break;
		if (call.name === "notNull" && call.arguments_.length === 0) notNull = true;
		else if (call.name === "primaryKey") notNull = true;
		else if (call.name === "$type" && call.arguments_.length === 0 && call.typeArguments !== null && call.typeArguments.params.length === 1 && typeOverride === null) { typeOverride = canonicalType(call.typeArguments.params[0], new Map()); if (typeOverride === null) return null; }
		else if (["default", "defaultNow", "defaultRandom", "$default", "$defaultFn"].includes(call.name)) hasDefault = true;
		else if (!["primaryKey", "unique", "references", "onUpdate", "$onUpdate", "$onUpdateFn"].includes(call.name)) return null;
		current = call.object;
	}
	if (current.type !== "CallExpression" || current.callee.type !== "Identifier") return null;
	const builder = builders.get(current.callee.name);
	if (builder === undefined) return null;
	const type = typeOverride ?? canonicalIntegerType(current, builder);
	if (type === null) return null;
	return { type, notNull, hasDefault: hasDefault || builder.name === "serial" };
}

export function canonicalDrizzleTable(node: ESTree.Expression, tableFactories: Set<string>, schemaObjects: Set<string>, builders: Map<string, DrizzleBuilder>, model: "select" | "insert"): { fingerprint: string; properties: number } | null {
	if (node.type !== "CallExpression" || node.arguments.length < 2 || node.arguments[1].type === "SpreadElement") return null;
	const directTable = node.callee.type === "Identifier" && tableFactories.has(node.callee.name);
	const schemaTable = node.callee.type === "MemberExpression" && !node.callee.computed && node.callee.object.type === "Identifier" && schemaObjects.has(node.callee.object.name) && node.callee.property.type === "Identifier" && node.callee.property.name === "table";
	if (!directTable && !schemaTable || node.arguments[1].type !== "ObjectExpression") return null;
	const members: string[] = [];
	for (const property of node.arguments[1].properties) {
		if (property.type !== "Property" || property.computed || property.kind !== "init") return null;
		const key = propertyKey(property.key), column = canonicalColumn(property.value, builders);
		if (key === null || column === null) return null;
		const optional = model === "insert" && (!column.notNull || column.hasDefault);
		const type = column.notNull ? column.type : `union(${["TSNullKeyword", column.type].sort().join(",")})`;
		members.push(`prop(${key},${optional ? "?" : "!"},rw,${type})`);
	}
	members.sort();
	return { fingerprint: `{${members.join(",")}}`, properties: members.length };
}
