import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import {
	createTypeAliasEnvironment,
	resetTypeAliasEnvironment,
	typeBindingVisitors,
	type TypeAliasEnvironment,
} from "../../src/vendor/anti-slop/shared/type-alias-resolution.ts";

RuleTester.describe = describe;
RuleTester.it = it;

type VisitorKeys = Readonly<Record<string, readonly string[]>>;
type Binding = TypeAliasEnvironment["bindingsByName"] extends ReadonlyMap<string, readonly (infer T)[]>
	? T
	: never;
type OldBinding = Binding & { readonly name: string };

// Copy of the original full-AST walk. The bindings rule visitors record must be identical.
function oldIsNode(value: unknown): value is ESTree.Node {
	return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

function oldEnclosingTypeScope(node: ESTree.Node): ESTree.Node {
	let current: ESTree.Node | null = node.parent;
	while (current !== null) {
		if (
			current.type === "Program" ||
			current.type === "BlockStatement" ||
			current.type === "TSModuleBlock" ||
			current.type === "StaticBlock" ||
			current.type === "SwitchStatement"
		) {
			return current;
		}
		current = current.parent;
	}
	return node;
}

function oldDeclaredTypeBinding(
	node: ESTree.Node,
): { readonly alias: ESTree.TSTypeAliasDeclaration | null; readonly name: string } | null {
	if (node.type === "TSTypeAliasDeclaration") return { alias: node, name: node.id.name };
	if (
		node.type === "TSInterfaceDeclaration" ||
		node.type === "TSEnumDeclaration" ||
		node.type === "ClassDeclaration" ||
		node.type === "ClassExpression"
	) {
		return node.id === null ? null : { alias: null, name: node.id.name };
	}
	if (
		node.type === "ImportSpecifier" ||
		node.type === "ImportDefaultSpecifier" ||
		node.type === "ImportNamespaceSpecifier"
	) {
		return { alias: null, name: node.local.name };
	}
	return null;
}

function oldCollectTypeBindings(
	node: ESTree.Node,
	visitorKeys: VisitorKeys,
	bindingsByName: Map<string, OldBinding[]>,
): void {
	const declared = oldDeclaredTypeBinding(node);
	if (declared !== null) {
		const bindings = bindingsByName.get(declared.name) ?? [];
		bindings.push({ ...declared, scope: oldEnclosingTypeScope(node) });
		bindingsByName.set(declared.name, bindings);
	}
	const fields = node as unknown as Readonly<Record<string, unknown>>;
	for (const key of visitorKeys[node.type] ?? []) {
		const value = fields[key];
		if (oldIsNode(value)) {
			oldCollectTypeBindings(value, visitorKeys, bindingsByName);
			continue;
		}
		if (!Array.isArray(value)) continue;
		for (const child of value) {
			if (oldIsNode(child)) oldCollectTypeBindings(child, visitorKeys, bindingsByName);
		}
	}
}

function sameBindings(
	expected: ReadonlyMap<string, readonly OldBinding[]>,
	actual: ReadonlyMap<string, readonly Binding[]>,
): boolean {
	const expectedNames = [...expected.keys()];
	const actualNames = [...actual.keys()];
	if (expectedNames.join("\n") !== actualNames.join("\n")) return false;
	return expectedNames.every((name) => {
		const left = expected.get(name) ?? [];
		const right = actual.get(name) ?? [];
		return (
			left.length === right.length &&
			left.every(
				(binding, index) =>
					binding.alias === right[index]?.alias &&
					binding.scope === right[index]?.scope,
			)
		);
	});
}

/** Compare the bindings the visitors recorded with the old full walk. */
function compareCollections(program: ESTree.Program, visitorKeys: VisitorKeys, environment: TypeAliasEnvironment) {
	const expectedBindings = new Map<string, OldBinding[]>();
	oldCollectTypeBindings(program, visitorKeys, expectedBindings);
	const same = sameBindings(expectedBindings, environment.bindingsByName);
	const names = [...environment.bindingsByName]
		.flatMap(([name, bindings]) => bindings.map((binding) => `${name}${binding.alias === null ? "" : "="}@${binding.scope.type}`))
		.join(",");
	return { same, names };
}

/** Report the bindings the rule visitors recorded and whether they match the old full walk. */
const bindingsProbeRule = defineRule({
	meta: { messages: { bindings: "{{status}}: {{names}}" } },
	create(context) {
		const environment = createTypeAliasEnvironment();
		resetTypeAliasEnvironment(environment, context.sourceCode.visitorKeys);
		return {
			...typeBindingVisitors(environment),
			"Program:exit"(node) {
				const { same, names } = compareCollections(node, context.sourceCode.visitorKeys, environment);
				context.report({
					node,
					messageId: "bindings",
					data: { status: same ? "same" : "differs", names },
				});
			},
		};
	},
});

/** Report only when the recorded bindings differ from the old full walk. */
const bindingsMismatchRule = defineRule({
	meta: { messages: { differs: "Recorded type bindings differ from the full walk." } },
	create(context) {
		const environment = createTypeAliasEnvironment();
		resetTypeAliasEnvironment(environment, context.sourceCode.visitorKeys);
		return {
			...typeBindingVisitors(environment),
			"Program:exit"(node) {
				const { same } = compareCollections(node, context.sourceCode.visitorKeys, environment);
				if (!same) context.report({ node, messageId: "differs" });
			},
		};
	},
});

const ruleTester = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
});

function expectBindings(name: string, code: string, names: string) {
	return { name, code, errors: [{ message: `same: ${names}` }] };
}

ruleTester.run("type-alias-resolution bindings", bindingsProbeRule, {
	valid: [],
	invalid: [
		expectBindings("skips files without binding keywords", "const value = 1; f(value);", ""),
		expectBindings(
			"ignores keywords in strings, comments, and property names",
			"const text = 'type interface enum class import'; // type Alias = 1\nconst object = { class: 1, type: 2 }; object.type;",
			"",
		),
		expectBindings(
			"collects top-level declarations and imports",
			[
				"import Default, { Named as Local } from 'a';",
				"import * as Namespace from 'b';",
				"import type { OnlyType } from 'c';",
				"type Alias = string;",
				"interface Shape {}",
				"enum Kind { A }",
				"const enum ConstKind { B }",
				"declare enum AmbientKind { C }",
				"class Base {}",
				"export abstract class Abstract {}",
				"export type Exported = number;",
				"const Expression = class Named2 {};",
			].join("\n"),
			"Default@Program,Local@Program,Namespace@Program,OnlyType@Program,Alias=@Program,Shape@Program,Kind@Program,ConstKind@Program,AmbientKind@Program,Base@Program,Abstract@Program,Exported=@Program,Named2@Program",
		),
		expectBindings(
			"collects declarations nested in functions, blocks, and switch cases",
			[
				"function outer() {",
				"  type Inner = number;",
				"  { interface Block {} }",
				"  switch (value) { case 1: enum InCase { A } }",
				"  return () => { class Arrow {} };",
				"}",
			].join("\n"),
			"Inner=@BlockStatement,Block@BlockStatement,InCase@SwitchStatement,Arrow@BlockStatement",
		),
		expectBindings(
			"collects declarations in classes, static blocks, and class expressions",
			[
				"class Outer {",
				"  static { type Static = string; }",
				"  method() { class Method {} return class Returned {}; }",
				"  field = class Field {};",
				"}",
			].join("\n"),
			"Outer@Program,Static=@StaticBlock,Method@BlockStatement,Returned@BlockStatement,Field@Program",
		),
		expectBindings(
			"collects declarations in namespaces, ambient modules, and global augmentations",
			[
				"namespace Space { export type InSpace = 1; export namespace Deep { interface InDeep {} } }",
				"declare module 'mod' { import { Imported } from 'other'; export type InModule = Imported; }",
				"declare global { interface Window {} }",
			].join("\n"),
			"InSpace=@TSModuleBlock,InDeep@TSModuleBlock,Imported@TSModuleBlock,InModule=@TSModuleBlock,Window@TSModuleBlock",
		),
		expectBindings(
			"keeps every competing binding with the same name in order",
			"type Same = 1;\nfunction f() { type Same = 2; { class Same {} } }",
			"Same=@Program,Same=@BlockStatement,Same@BlockStatement",
		),
		expectBindings(
			"collects class expressions inside decorators",
			"@decorate(class InDecorator {}) class Decorated {}",
			"Decorated@Program,InDecorator@Program",
		),
		expectBindings(
			"ignores anonymous classes, type parameters, and import-equals declarations",
			"import Legacy = require('legacy');\nexport default class {}\nfunction generic<Parameter>() { return class {}; }",
			"",
		),
	],
});

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".ts"))
		.map((file) => join(directory, file));
}

ruleTester.run("type-alias-resolution bindings match the full walk on repository sources", bindingsMismatchRule, {
	valid: sourceFiles(join(import.meta.dirname, "../../src")).map((file) => ({
		name: file,
		code: readFileSync(file, "utf8"),
	})),
	invalid: [],
});
