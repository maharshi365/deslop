import type { ESTree } from "@oxlint/plugins";

import { hasLexicalTypeParameter } from "./lexical-type-parameters.ts";

type VisitorKeys = Readonly<Record<string, readonly string[]>>;
type TypeScope = ESTree.Node;

type TypeBinding = {
	readonly alias: ESTree.TSTypeAliasDeclaration | null;
	readonly scope: TypeScope;
};

type Substitution = {
	readonly substitutions: Substitutions;
	readonly type: ESTree.TSType;
};

type Substitutions = ReadonlyMap<string, Substitution>;

/**
 * Every type binding in the file being linted, by name. A rule fills it from the visitors of
 * `typeBindingVisitors` and queries it at Program:exit, once the whole file has been visited.
 */
export type TypeAliasEnvironment = {
	readonly bindingsByName: Map<string, TypeBinding[]>;
	visitorKeys: VisitorKeys;
};

export type ResolvedTypeMatcher = (
	type: ESTree.TSType,
	matches: (child: ESTree.TSType) => boolean,
) => boolean;

const NO_SUBSTITUTIONS: Substitutions = new Map();
const NO_ALIASES: ReadonlySet<ESTree.TSTypeAliasDeclaration> = new Set();

function enclosingTypeScope(node: ESTree.Node): TypeScope {
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

export function createTypeAliasEnvironment(): TypeAliasEnvironment {
	return { bindingsByName: new Map(), visitorKeys: {} };
}

/** Start a new file. */
export function resetTypeAliasEnvironment(environment: TypeAliasEnvironment, visitorKeys: VisitorKeys): void {
	environment.bindingsByName.clear();
	environment.visitorKeys = visitorKeys;
}

function addBinding(environment: TypeAliasEnvironment, name: string, alias: ESTree.TSTypeAliasDeclaration | null, node: ESTree.Node): void {
	const binding = { alias, scope: enclosingTypeScope(node) };
	const bindings = environment.bindingsByName.get(name);
	if (bindings === undefined) environment.bindingsByName.set(name, [binding]);
	else bindings.push(binding);
}

/** Visitors that record each declaration of a type name: aliases, interfaces, enums, classes, and imports. */
export function typeBindingVisitors(environment: TypeAliasEnvironment) {
	const addNamed = (
		node: ESTree.TSInterfaceDeclaration | ESTree.TSEnumDeclaration | ESTree.Class,
	) => {
		if (node.id !== null) addBinding(environment, node.id.name, null, node);
	};
	const addImport = (
		node: ESTree.ImportSpecifier | ESTree.ImportDefaultSpecifier | ESTree.ImportNamespaceSpecifier,
	) => {
		addBinding(environment, node.local.name, null, node);
	};
	return {
		TSTypeAliasDeclaration(node: ESTree.TSTypeAliasDeclaration) {
			addBinding(environment, node.id.name, node, node);
		},
		TSInterfaceDeclaration: addNamed,
		TSEnumDeclaration: addNamed,
		ClassDeclaration: addNamed,
		ClassExpression: addNamed,
		ImportSpecifier: addImport,
		ImportDefaultSpecifier: addImport,
		ImportNamespaceSpecifier: addImport,
	};
}

function ancestorDistance(ancestor: ESTree.Node, node: ESTree.Node): number | null {
	let current: ESTree.Node | null = node;
	let distance = 0;
	while (current !== null) {
		if (current === ancestor) return distance;
		current = current.parent;
		distance += 1;
	}
	return null;
}

/** The candidates in the nearest enclosing scope that declares any of them. */
function nearestTypeBindings(
	candidates: readonly TypeBinding[],
	use: ESTree.Node,
): readonly TypeBinding[] {
	let nearestDistance = Number.POSITIVE_INFINITY;
	let nearest: TypeBinding[] = [];
	for (const candidate of candidates) {
		const distance = ancestorDistance(candidate.scope, use);
		if (distance === null || distance > nearestDistance) continue;
		if (distance === nearestDistance) {
			nearest.push(candidate);
			continue;
		}
		nearestDistance = distance;
		nearest = [candidate];
	}
	return nearest;
}

/** Resolve the nearest visible alias with this name, respecting lexical shadowing. */
export function visibleTypeAlias(
	name: string,
	use: ESTree.Node,
	environment: TypeAliasEnvironment,
): ESTree.TSTypeAliasDeclaration | null {
	// Most names have no local declaration; skip the ancestor walk for them.
	const candidates = environment.bindingsByName.get(name);
	if (candidates === undefined) return null;
	if (hasLexicalTypeParameter(use, name, environment.visitorKeys)) return null;
	const bindings = nearestTypeBindings(candidates, use);
	return bindings.length === 1 ? (bindings[0]?.alias ?? null) : null;
}

/** Return whether a local declaration shadows a built-in type at this use. */
export function hasVisibleTypeBinding(
	name: string,
	use: ESTree.Node,
	environment: TypeAliasEnvironment,
): boolean {
	const candidates = environment.bindingsByName.get(name);
	return (
		(candidates !== undefined && nearestTypeBindings(candidates, use).length > 0) ||
		hasLexicalTypeParameter(use, name, environment.visitorKeys)
	);
}

function typeReferenceName(type: ESTree.TSTypeReference): string | null {
	return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function aliasSubstitutions(
	alias: ESTree.TSTypeAliasDeclaration,
	reference: ESTree.TSTypeReference,
	base: Substitutions,
): Substitutions | null {
	const parameters = alias.typeParameters?.params ?? [];
	const arguments_ = reference.typeArguments?.params ?? [];
	const next = new Map(base);
	for (const [index, parameter] of parameters.entries()) {
		const explicitArgument = arguments_[index];
		const argument = explicitArgument ?? parameter.default;
		if (argument === null || argument === undefined) return null;
		const argumentSubstitutions = explicitArgument === undefined ? next : base;
		next.set(parameter.name.name, {
			type: argument,
			substitutions: new Map(argumentSubstitutions),
		});
	}
	return next;
}

/** Match a type after resolving visible aliases and substituting their type parameters. */
export function resolvedTypeMatches(
	type: ESTree.TSType,
	environment: TypeAliasEnvironment,
	matcher: ResolvedTypeMatcher,
): boolean {
	const evaluate = (
		current: ESTree.TSType,
		substitutions: Substitutions,
		resolvingAliases: ReadonlySet<ESTree.TSTypeAliasDeclaration>,
	): boolean => {
		if (current.type === "TSTypeReference") {
			const name = typeReferenceName(current);
			if (name !== null) {
				const substitution = substitutions.get(name);
				if (substitution !== undefined && !current.typeArguments?.params.length) {
					return evaluate(
						substitution.type,
						substitution.substitutions,
						resolvingAliases,
					);
				}
				const alias = visibleTypeAlias(name, current, environment);
				if (alias !== null && !resolvingAliases.has(alias)) {
					const nextSubstitutions = aliasSubstitutions(alias, current, substitutions);
					if (nextSubstitutions !== null) {
						const nextResolving = new Set(resolvingAliases);
						nextResolving.add(alias);
						return evaluate(alias.typeAnnotation, nextSubstitutions, nextResolving);
					}
				}
			}
		}
		return matcher(current, (child) =>
			evaluate(child, substitutions, resolvingAliases),
		);
	};

	return evaluate(type, NO_SUBSTITUTIONS, NO_ALIASES);
}
