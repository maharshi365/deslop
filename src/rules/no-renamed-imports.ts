import { defineRule } from "@oxlint/plugins";
import type { ESTree, Scope } from "@oxlint/plugins";

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
						return [
							fixer.replaceText(node, name),
							...variable.references
								.filter((reference) => reference.resolved === variable)
								.map((reference) => fixer.replaceText(reference.identifier, name)),
						];
					},
				});
			},
		};
	},
});
