import { defineRule } from "@oxlint/plugins";
import type { ESTree, Reference, Scope } from "@oxlint/plugins";

function moduleScopeFor(scope: Scope): Scope | null {
	let current: Scope | null = scope;
	while (current !== null) {
		if (current.type === "module") return current;
		current = current.upper;
	}
	return null;
}

function importedName(node: ESTree.ImportSpecifier): string | null {
	return node.imported.type === "Identifier" ? node.imported.name : null;
}

const reservedBindingNames = new Set([
	"arguments",
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"eval",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"implements",
	"import",
	"in",
	"instanceof",
	"interface",
	"let",
	"new",
	"null",
	"package",
	"private",
	"protected",
	"public",
	"return",
	"static",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield",
]);

function isShadowedAt(reference: Reference, name: string, moduleScope: Scope): boolean {
	let current: Scope | null = reference.from;
	while (current !== null && current !== moduleScope) {
		if (current.set.has(name)) return true;
		current = current.upper;
	}
	return false;
}

function isIntrinsicJsxTag(identifier: Reference["identifier"], name: string): boolean {
	const parent = identifier.parent;
	return (parent.type === "JSXOpeningElement" || parent.type === "JSXClosingElement") && /^[a-z]/.test(name);
}

function referenceReplacement(identifier: Reference["identifier"], localName: string, name: string): string {
	const parent = identifier.parent;
	if (parent.type === "Property" && parent.shorthand && parent.value === identifier) return `${localName}: ${name}`;
	if (parent.type === "ExportSpecifier" && parent.local === identifier && parent.exported.range[0] === identifier.range[0]) {
		return `${name} as ${localName}`;
	}
	return name;
}

/** Disallow named import aliases when the imported name is available in module scope. */
export const noRenamedImportsRule = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Disallow unnecessary aliases for named imports" },
		fixable: "code",
		messages: {
			unnecessaryAlias: "Use {{importedName}} directly instead of renaming this import to {{localName}}.",
		},
		schema: [],
	},
	createOnce(context) {
		return {
			ImportSpecifier(node) {
				const name = importedName(node);
				if (name === null || name === node.local.name) return;

				const moduleScope = moduleScopeFor(context.sourceCode.getScope(node));
				if (moduleScope === null || moduleScope.set.has(name)) return;

				const variable = moduleScope.set.get(node.local.name);
				if (variable === undefined) return;

				context.report({
					node,
					messageId: "unnecessaryAlias",
					data: { importedName: name, localName: node.local.name },
					fix(fixer) {
						const localName = node.local.name;
						const references = variable.references.filter((reference) => reference.resolved === variable);
						if (
							reservedBindingNames.has(name) ||
							moduleScope.through.some((reference) => reference.identifier.name === name) ||
							references.some(
								(reference) =>
									isShadowedAt(reference, name, moduleScope) || isIntrinsicJsxTag(reference.identifier, name),
							)
						) {
							return null;
						}
						return [
							fixer.replaceTextRange([node.imported.range[0], node.range[1]], name),
							...references.map((reference) =>
								fixer.replaceText(reference.identifier, referenceReplacement(reference.identifier, localName, name)),
							),
						];
					},
				});
			},
		};
	},
});
