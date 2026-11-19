import { matchesGlob, relative } from "node:path";
import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { resolveVariable } from "../vendor/anti-slop/shared/scope.ts";

interface Options {
	entrypoints?: string[];
}

const defaultEntrypoints = ["**/index.ts", "**/index.tsx", "**/index.mts", "**/index.cts", "**/index.js", "**/index.jsx", "**/index.mjs"];

/** Keep re-exports in explicitly allowed entrypoint files. */
export const noReexportsOutsideEntrypointsRule = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Disallow re-exports outside configured entrypoint files" },
		messages: {
			reexport: "Import this symbol directly from its source, or re-export it from a package entrypoint for external consumers.",
		},
		schema: [{
			type: "object",
			properties: {
				entrypoints: { type: "array", items: { type: "string" } },
			},
			additionalProperties: false,
		}],
	},
	createOnce(context) {
		// Re-export candidates in visit order: a module re-export, or an exported local identifier
		// paired with the node to report. Locals are checked at exit, once every import is known.
		const candidates: Array<ESTree.Node> = [];
		const locals: Array<ESTree.IdentifierReference | null> = [];
		const importedNames = new Set<string>();

		function isImported(node: ESTree.IdentifierReference): boolean {
			// An import binding always has an import specifier with its name; skip scope analysis otherwise.
			if (!importedNames.has(node.name)) return false;
			return resolveVariable(context.sourceCode, node)?.defs.some((definition) => definition.type === "ImportBinding") ?? false;
		}

		function isEntrypoint(): boolean {
			const options = context.options[0] as Options | undefined;
			const filename = relative(context.cwd, context.filename).replaceAll("\\", "/");
			return (options?.entrypoints ?? defaultEntrypoints).some((pattern) => matchesGlob(filename, pattern));
		}

		function addImportedName(node: ESTree.ImportSpecifier | ESTree.ImportDefaultSpecifier | ESTree.ImportNamespaceSpecifier) {
			importedNames.add(node.local.name);
		}

		return {
			before() {
				candidates.length = 0;
				locals.length = 0;
				importedNames.clear();
			},
			ImportSpecifier: addImportedName,
			ImportDefaultSpecifier: addImportedName,
			ImportNamespaceSpecifier: addImportedName,
			ExportNamedDeclaration(node) {
				if (node.source !== null) {
					candidates.push(node);
					locals.push(null);
					return;
				}
				for (const specifier of node.specifiers) {
					if (specifier.local.type !== "Identifier") continue;
					candidates.push(specifier);
					locals.push(specifier.local);
				}
			},
			ExportAllDeclaration(node) {
				candidates.push(node);
				locals.push(null);
			},
			ExportDefaultDeclaration(node) {
				if (node.declaration.type !== "Identifier") return;
				candidates.push(node);
				locals.push(node.declaration);
			},
			"Program:exit"() {
				// Most files have no re-exports, so match the entrypoint globs only for a confirmed one.
				let entrypoint: boolean | undefined;
				for (let i = 0; i < candidates.length; i++) {
					const local = locals[i];
					if (local !== null && !isImported(local)) continue;
					entrypoint ??= isEntrypoint();
					if (entrypoint) return;
					context.report({ node: candidates[i], messageId: "reexport" });
				}
			},
		};
	},
});
