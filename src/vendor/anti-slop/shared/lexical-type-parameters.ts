import type { ESTree } from "@oxlint/plugins";

type VisitorKeys = Readonly<Record<string, readonly string[]>>;

function isNode(value: unknown): value is ESTree.Node {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof value.type === "string"
	);
}

function collectInferTypeParameterNames(
	node: ESTree.Node,
	visitorKeys: VisitorKeys,
	names: Set<string>,
): void {
	if (node.type === "TSInferType") names.add(node.typeParameter.name.name);
	const record = node as unknown as Readonly<Record<string, unknown>>;
	for (const key of visitorKeys[node.type] ?? []) {
		const value = record[key];
		if (isNode(value)) {
			collectInferTypeParameterNames(value, visitorKeys, names);
			continue;
		}
		if (!Array.isArray(value)) continue;
		for (const child of value) {
			if (isNode(child)) collectInferTypeParameterNames(child, visitorKeys, names);
		}
	}
}

/** Return whether a type binder named `name` is in scope at a node and can shadow module aliases. */
export function hasLexicalTypeParameter(
	node: ESTree.Node,
	name: string,
	visitorKeys: VisitorKeys,
): boolean {
	let descendant: ESTree.Node = node;
	let current: ESTree.Node | null = node;
	while (current !== null && current.type !== "Program") {
		if ("typeParameters" in current) {
			for (const parameter of current.typeParameters?.params ?? []) {
				if (parameter.name.name === name) return true;
			}
		}
		if (
			current.type === "TSMappedType" &&
			(descendant === current.nameType || descendant === current.typeAnnotation) &&
			current.key.name === name
		) {
			return true;
		}
		if (current.type === "TSConditionalType" && descendant === current.trueType) {
			const names = new Set<string>();
			collectInferTypeParameterNames(current.extendsType, visitorKeys, names);
			if (names.has(name)) return true;
		}
		descendant = current;
		current = current.parent;
	}
	return false;
}
