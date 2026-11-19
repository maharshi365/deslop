import type { ESTree } from "@oxlint/plugins";

import { hasLexicalTypeParameter } from "./lexical-type-parameters.ts";

type VisitorKeys = Readonly<Record<string, readonly string[]>>;
type TypeScope = ESTree.Node;

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
	/** Each head packs the latest binding's index and a bit for whether any binding is an alias. */
	readonly headByName: Map<string, number>;
	readonly next: Array<number>;
	readonly declarations: Array<ESTree.Node>;
	visitorKeys: VisitorKeys;
};

export type ResolvedTypeMatcher = (
	type: ESTree.TSType,
	matches: (child: ESTree.TSType) => boolean,
) => boolean;

const NO_SUBSTITUTIONS: Substitutions = new Map();
const NO_ALIASES: ReadonlySet<ESTree.TSTypeAliasDeclaration> = new Set();

export function enclosingTypeScope(node: ESTree.Node): TypeScope {
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
	return { headByName: new Map(), next: [], declarations: [], visitorKeys: {} };
}

/** Start a new file. */
export function resetTypeAliasEnvironment(environment: TypeAliasEnvironment, visitorKeys: VisitorKeys): void {
	environment.headByName.clear();
	environment.next.length = 0;
	environment.declarations.length = 0;
	environment.visitorKeys = visitorKeys;
}

function addBinding(environment: TypeAliasEnvironment, name: string, node: ESTree.Node, isAlias = false): void {
	const index = environment.declarations.length;
	const head = environment.headByName.get(name);
	environment.next.push(head === undefined ? -1 : head >>> 1);
	environment.declarations.push(node);
	environment.headByName.set(name, (index << 1) | (isAlias ? 1 : (head ?? 0) & 1));
}

/** Visitors that record each declaration of a type name: aliases, interfaces, enums, classes, and imports. */
export function typeBindingVisitors(environment: TypeAliasEnvironment) {
	const addNamed = (
		node: ESTree.TSInterfaceDeclaration | ESTree.TSEnumDeclaration | ESTree.Class,
	) => {
		if (node.id !== null) addBinding(environment, node.id.name, node);
	};
	const addImport = (
		node: ESTree.ImportSpecifier | ESTree.ImportDefaultSpecifier | ESTree.ImportNamespaceSpecifier,
	) => {
		addBinding(environment, node.local.name, node);
	};
	return {
		TSTypeAliasDeclaration(node: ESTree.TSTypeAliasDeclaration) {
			addBinding(environment, node.id.name, node, true);
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

/** Resolve the nearest visible alias with this name, respecting lexical shadowing. */
export function visibleTypeAlias(
	name: string,
	use: ESTree.Node,
	environment: TypeAliasEnvironment,
): ESTree.TSTypeAliasDeclaration | null {
	// Imports and other non-alias declarations matter only if they shadow an alias.
	const head = environment.headByName.get(name);
	if (head === undefined || (head & 1) === 0) return null;
	let nearestDistance = Number.POSITIVE_INFINITY;
	let alias: ESTree.TSTypeAliasDeclaration | null = null;
	for (let index = head >>> 1; index !== -1; index = environment.next[index]) {
		const declaration = environment.declarations[index];
		const distance = ancestorDistance(enclosingTypeScope(declaration), use);
		if (distance === null || distance > nearestDistance) continue;
		alias = distance < nearestDistance && declaration.type === "TSTypeAliasDeclaration" ? declaration : null;
		nearestDistance = distance;
	}
	return alias !== null && !hasLexicalTypeParameter(use, name, environment.visitorKeys) ? alias : null;
}

/** Return whether a local declaration shadows a built-in type at this use. */
export function hasVisibleTypeBinding(
	name: string,
	use: ESTree.Node,
	environment: TypeAliasEnvironment,
): boolean {
	const head = environment.headByName.get(name);
	for (let index = head === undefined ? -1 : head >>> 1; index !== -1; index = environment.next[index]) {
		if (ancestorDistance(enclosingTypeScope(environment.declarations[index]), use) !== null) return true;
	}
	return hasLexicalTypeParameter(use, name, environment.visitorKeys);
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
