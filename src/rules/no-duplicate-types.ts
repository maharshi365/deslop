import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { canonicalDrizzleTable, type DrizzleBuilder } from "./no-duplicate-types/drizzle.ts";
import { canonicalArkObject, canonicalValibotObject, canonicalZodObject } from "./no-duplicate-types/schemas.ts";
import { canonicalDeclaration, canonicalTypeName, factoryCall, memberCall, type ReportNode, type TypeDeclaration } from "./no-duplicate-types/shared.ts";

type DuplicateKind = "type" | "schema" | "drizzle-select" | "drizzle-insert";
type DrizzleModel = "select" | "insert";
interface RuleOptions {
	message?: string;
	minProperties?: number;
	schemas?: { libraries?: string[]; matchTypes?: boolean };
	drizzle?: { models?: DrizzleModel[]; matchTypes?: boolean };
}
interface SeenType { node: ReportNode; name: string; filename: string; }

const drizzleColumnTypes: Record<string, string> = {
	text: "TSStringKeyword", varchar: "TSStringKeyword", uuid: "TSStringKeyword", char: "TSStringKeyword",
	integer: "TSNumberKeyword", int: "TSNumberKeyword", serial: "TSNumberKeyword", smallint: "TSNumberKeyword",
	real: "TSNumberKeyword", float: "TSNumberKeyword", doublePrecision: "TSNumberKeyword", boolean: "TSBooleanKeyword",
};

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
		const zodNamespaces = new Set<string>(), valibotNamespaces = new Set<string>(), arkTypeFunctions = new Set<string>();
		const valibotFunctions = new Map<string, string>(), drizzleTables = new Set<string>(), drizzleSchemaFactories = new Set<string>(), drizzleSchemaObjects = new Set<string>();
		const drizzleBuilders = new Map<string, DrizzleBuilder>(), drizzleModels = new Map<string, Map<DrizzleModel, string>>();
		const drizzleAliases: ESTree.TSTypeAliasDeclaration[] = [];
		let hasArkTypeImport = false;
		let options: RuleOptions = {};
		const minProperties = () => options.minProperties ?? 2;
		const enabled = (library: string) => options.schemas?.libraries?.includes(library) === true;
		const report = (node: ReportNode, name: string, fingerprint: string, kind: DuplicateKind) => {
			const isolates = kind === "schema" ? options.schemas?.matchTypes === false : kind.startsWith("drizzle-") && options.drizzle?.matchTypes === false;
			const key = isolates ? `${kind}:${fingerprint}` : fingerprint, first = seen.get(key);
			if (first === undefined) { seen.set(key, { node, name, filename: context.filename }); return; }
			if (first.node !== node) context.report({ node, messageId: "duplicate", data: { message: options.message ?? "This type is structurally identical to an existing declaration.", firstName: first.name, firstFile: first.filename } });
		};
		const inspectType = (node: TypeDeclaration) => {
			const properties = node.type === "TSTypeAliasDeclaration" ? node.typeAnnotation.type === "TSTypeLiteral" ? node.typeAnnotation.members.length : 0 : node.body.body.length;
			const fingerprint = canonicalDeclaration(node);
			if (fingerprint !== null && properties >= minProperties()) report(node, node.id.name, fingerprint, "type");
		};
		const inspectSchema = (node: ESTree.VariableDeclarator) => {
			if (node.id.type !== "Identifier" || node.init === null) return;
			const zod = memberCall(node.init);
			const valibot = factoryCall(node.init, valibotNamespaces, valibotFunctions);
			const arkCallee = node.init.type === "CallExpression" ? node.init.callee as { name?: unknown } : null;
			const schema = enabled("zod") && zod?.name === "object" && zod.arguments_.length === 1 && zod.object.type === "Identifier" && zodNamespaces.has(zod.object.name) ? canonicalZodObject(zod.arguments_[0], zodNamespaces)
				: enabled("valibot") && valibot?.name === "object" && valibot.arguments_.length === 1 ? canonicalValibotObject(valibot.arguments_[0], valibotNamespaces, valibotFunctions)
				: enabled("arktype") && node.init.type === "CallExpression" && typeof arkCallee?.name === "string" && (arkTypeFunctions.has(arkCallee.name) || hasArkTypeImport && arkCallee.name === "type") && node.init.arguments.length === 1 && node.init.arguments[0].type !== "SpreadElement" ? canonicalArkObject(node.init.arguments[0])
				: null;
			if (schema !== null && schema.properties >= minProperties()) report(node, node.id.name, schema.fingerprint, "schema");
		};
		const inspectDrizzle = (node: ESTree.VariableDeclarator) => {
			if (options.drizzle === undefined || node.id.type !== "Identifier" || node.init === null) return;
			const models = new Map<DrizzleModel, string>();
			for (const model of options.drizzle.models ?? ["select", "insert"]) {
				const table = canonicalDrizzleTable(node.init, drizzleTables, drizzleSchemaObjects, drizzleBuilders, model);
				if (table === null || table.properties < minProperties()) continue;
				models.set(model, table.fingerprint); report(node, node.id.name, table.fingerprint, `drizzle-${model}`);
			}
			if (models.size > 0) drizzleModels.set(node.id.name, models);
		};
		const trackImport = (node: ESTree.ImportDeclaration) => {
			if (node.source.value === "zod") for (const specifier of node.specifiers) if (specifier.type === "ImportNamespaceSpecifier" || specifier.type === "ImportDefaultSpecifier" || specifier.type === "ImportSpecifier" && specifier.imported.type === "Identifier" && specifier.imported.name === "z") zodNamespaces.add(specifier.local.name);
			if (node.source.value === "valibot") for (const specifier of node.specifiers) { if (specifier.type === "ImportNamespaceSpecifier") valibotNamespaces.add(specifier.local.name); if (specifier.type === "ImportSpecifier" && specifier.imported.type === "Identifier") valibotFunctions.set(specifier.local.name, specifier.imported.name); }
			if (node.source.value === "arktype") { hasArkTypeImport = true; for (const specifier of node.specifiers) { const imported = specifier.type === "ImportSpecifier" ? specifier.imported as { name?: unknown } : null; if (imported?.name === "type") arkTypeFunctions.add(specifier.local.name); } }
			const source = /^drizzle-orm\/(pg|mysql|sqlite)-core$/.exec(String(node.source.value));
			if (source === null) return;
			for (const specifier of node.specifiers) {
				if (specifier.type !== "ImportSpecifier" || specifier.imported.type !== "Identifier") continue;
				const name = specifier.imported.name;
				if (["pgTable", "mysqlTable", "sqliteTable"].includes(name)) drizzleTables.add(specifier.local.name);
				if (name === "pgSchema") drizzleSchemaFactories.add(specifier.local.name);
				const type = source[1] === "sqlite" && name === "blob" ? "ref(Uint8Array<>)" : drizzleColumnTypes[name];
				if (type !== undefined) drizzleBuilders.set(specifier.local.name, { name, type });
			}
		};
		return {
			Program() {
				// LSPs can re-lint a file in the same createOnce worker; discard its stale declarations first.
				for (const [key, type] of seen) if (type.filename === context.filename) seen.delete(key);
				options = (context.options[0] as RuleOptions | undefined) ?? {};
				zodNamespaces.clear(); valibotNamespaces.clear(); arkTypeFunctions.clear(); valibotFunctions.clear();
				drizzleTables.clear(); drizzleSchemaFactories.clear(); drizzleSchemaObjects.clear(); drizzleBuilders.clear(); drizzleModels.clear(); drizzleAliases.length = 0;
				hasArkTypeImport = false;
			},
			ImportDeclaration: trackImport,
			TSTypeAliasDeclaration(node) { inspectType(node); drizzleAliases.push(node); },
			TSInterfaceDeclaration: inspectType,
			VariableDeclarator(node) {
				inspectSchema(node);
				if (node.id.type === "Identifier" && node.init?.type === "CallExpression" && node.init.callee.type === "Identifier" && drizzleSchemaFactories.has(node.init.callee.name)) drizzleSchemaObjects.add(node.id.name);
				inspectDrizzle(node);
			},
			"Program:exit"() {
				for (const node of drizzleAliases) {
					if (options.drizzle === undefined || node.typeAnnotation.type !== "TSTypeQuery" || node.typeAnnotation.typeArguments !== null) continue;
					const name = canonicalTypeName(node.typeAnnotation.exprName as ESTree.TSTypeName), match = name === null ? null : /^(.*)\.\$infer(Select|Insert)$/.exec(name);
					if (match === null) continue;
					const model: DrizzleModel = match[2] === "Select" ? "select" : "insert", fingerprint = drizzleModels.get(match[1])?.get(model);
					if (fingerprint !== undefined) report(node, node.id.name, fingerprint, `drizzle-${model}`);
				}
			},
		};
	},
});
