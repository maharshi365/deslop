import { defineRule } from "@oxlint/plugins";
import type { ESTree, Variable } from "@oxlint/plugins";

interface Options {
	libraries?: Array<"zod" | "arktype">;
	allowExportedAliases?: boolean;
	schemaImports?: Array<{ from: string; names: string[] }>;
}

type SchemaKind = "schema" | "zod-schema" | "ark-schema" | "zod-module" | "zod-namespace" | "zod-factory" | "ark-module" | "ark-factory";

// Only known schema-producing APIs belong here. Parsing and inspection APIs do not.
const zodFactories = new Set([
	"string", "number", "bigint", "boolean", "date", "symbol", "undefined", "null", "void",
	"any", "unknown", "never", "literal", "enum", "nativeEnum", "object", "strictObject",
	"looseObject", "array", "tuple", "record", "map", "set", "union", "discriminatedUnion",
	"intersection", "optional", "nullable", "nullish", "lazy", "promise", "custom",
	"preprocess", "instanceof", "templateLiteral", "file", "json",
]);
const zodMethods = new Set([
	"optional", "nullable", "nullish", "array", "or", "and", "refine", "superRefine", "check",
	"transform", "pipe", "default", "prefault", "catch", "brand", "readonly", "describe", "meta",
	"extend", "safeExtend", "merge", "pick", "omit", "partial", "required", "keyof",
	"strict", "strip", "passthrough", "catchall", "nonoptional", "unwrap",
	"min", "max", "length", "nonempty", "email", "url", "uuid", "regex", "includes",
	"startsWith", "endsWith", "trim", "toLowerCase", "toUpperCase", "int", "positive",
	"negative", "nonnegative", "nonpositive", "finite", "multipleOf", "safe", "gt", "gte", "lt", "lte",
]);
const arkMethods = new Set([
	"array", "or", "and", "pipe", "narrow", "brand", "describe", "configure", "optional",
	"default", "pick", "omit", "partial", "required", "merge", "keyof", "extract", "exclude",
	"atLeast", "atMost", "moreThan", "lessThan", "atLeastLength", "atMostLength", "exactlyLength",
	"matching", "divisibleBy", "onUndeclaredKey", "onDeepUndeclaredKey",
]);

function memberName(node: ESTree.MemberExpression): string | null {
	if (!node.computed && node.property.type === "Identifier") return node.property.name;
	if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") return node.property.value;
	return null;
}

function memberKind(owner: SchemaKind | null, name: string | null): SchemaKind | null {
	if (name === null) return null;
	if ((owner === "zod-module" || owner === "zod-namespace") && name === "z") return "zod-namespace";
	if ((owner === "zod-module" || owner === "zod-namespace") && zodFactories.has(name)) return "zod-factory";
	if (owner === "ark-module" && name === "type") return "ark-factory";
	return null;
}

/** Disallow const aliases that only rename a known schema. */
export const noPassThroughSchemaRule = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Disallow pass-through aliases of known schemas" },
		messages: { passThroughSchema: "Use {{schemaName}} directly instead of creating a pass-through schema alias." },
		schema: [{
			type: "object",
			properties: {
				libraries: { type: "array", items: { enum: ["zod", "arktype"] }, uniqueItems: true },
				allowExportedAliases: { type: "boolean" },
				schemaImports: {
					type: "array",
					items: {
						type: "object",
						properties: { from: { type: "string" }, names: { type: "array", items: { type: "string" } } },
						required: ["from", "names"],
						additionalProperties: false,
					},
				},
			},
			additionalProperties: false,
		}],
	},
	createOnce(context) {
		let options: Options;
		const candidates: ESTree.VariableDeclarator[] = [];
		const exported = new Set<Variable>();

		function variableFor(node: ESTree.Node & { name: string }): Variable | null {
			let scope = context.sourceCode.getScope(node);
			while (true) {
				const variable = scope.set.get(node.name);
				if (variable !== undefined) return variable;
				if (scope.upper === null) return null;
				scope = scope.upper;
			}
		}

		function kind(node: ESTree.Node, seen = new Set<Variable>()): SchemaKind | null {
			if (node.type === "Identifier") {
				const variable = variableFor(node);
				if (variable === null || seen.has(variable) || variable.defs.length !== 1) return null;
				seen.add(variable);
				const definition = variable.defs[0];
				if (definition.type === "ImportBinding") {
					const specifier = definition.node;
					const declaration = specifier.parent;
					if (declaration?.type !== "ImportDeclaration" || declaration.importKind === "type") return null;
					if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") return null;
					const source = declaration.source.value;
					const name = specifier.type === "ImportSpecifier"
						? specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value
						: specifier.type === "ImportDefaultSpecifier" ? "default" : null;
					if (name !== null && options.schemaImports?.some((entry) => entry.from === source && entry.names.includes(name))) return "schema";
					const libraries = options.libraries ?? ["zod", "arktype"];
					if (libraries.includes("zod") && ["zod", "zod/v3", "zod/v4", "zod/v4/classic", "zod/v4/mini", "zod/mini"].includes(source)) {
						if (name === null) return "zod-module";
						if (name === "z" || name === "default") return "zod-namespace";
						if (zodFactories.has(name)) return "zod-factory";
					}
					if (libraries.includes("arktype") && source === "arktype") {
						if (name === null) return "ark-module";
						if (name === "type") return "ark-factory";
					}
					return null;
				}
				if (definition.type !== "Variable" || definition.node.type !== "VariableDeclarator") return null;
				const declaration = definition.node;
				if (declaration.parent.type !== "VariableDeclaration" || declaration.parent.kind !== "const" || declaration.id.type !== "Identifier" || declaration.init === null) return null;
				return kind(declaration.init, seen);
			}
			if (node.type === "MemberExpression") {
				return memberKind(kind(node.object, seen), memberName(node));
			}
			if (node.type !== "CallExpression") return null;
			let factory: SchemaKind | null;
			if (node.callee.type === "MemberExpression") {
				const owner = kind(node.callee.object, seen);
				const name = memberName(node.callee);
				if (owner === "zod-schema" && name === "meta" && node.arguments.length === 0) return null;
				if (name !== null && owner === "zod-schema" && zodMethods.has(name)) return owner;
				if (name !== null && owner === "ark-schema" && arkMethods.has(name)) return owner;
				factory = memberKind(owner, name);
			} else {
				factory = kind(node.callee, seen);
			}
			if (factory === "zod-factory") return "zod-schema";
			if (factory === "ark-factory") return "ark-schema";
			return null;
		}

		function markExport(node: ESTree.Node & { name: string }) {
			const variable = variableFor(node);
			if (variable !== null) exported.add(variable);
		}

		return {
			before() {
				options = (context.options[0] as Options | undefined) ?? {};
				candidates.length = 0;
				exported.clear();
			},
			VariableDeclarator(node) {
				if (node.parent.type === "VariableDeclaration" && node.parent.kind === "const" && node.id.type === "Identifier" && node.init?.type === "Identifier") candidates.push(node);
			},
			ExportNamedDeclaration(node) {
				if (node.exportKind === "type") return;
				if (node.declaration?.type === "VariableDeclaration") {
					for (const declaration of node.declaration.declarations) if (declaration.id.type === "Identifier") markExport(declaration.id);
				}
				if (node.source !== null) return;
				for (const specifier of node.specifiers) if (specifier.exportKind !== "type" && specifier.local.type === "Identifier") markExport(specifier.local);
			},
			ExportDefaultDeclaration(node) {
				if (node.declaration.type === "Identifier") markExport(node.declaration);
			},
			"Program:exit"() {
				for (const node of candidates) {
					if (node.id.type !== "Identifier" || node.init?.type !== "Identifier") continue;
					const target = kind(node.init);
					if (target !== "schema" && target !== "zod-schema" && target !== "ark-schema") continue;
					const variable = variableFor(node.id);
					if (options.allowExportedAliases && variable !== null && exported.has(variable)) continue;
					context.report({ node, messageId: "passThroughSchema", data: { schemaName: node.init.name } });
				}
			},
		};
	},
});
