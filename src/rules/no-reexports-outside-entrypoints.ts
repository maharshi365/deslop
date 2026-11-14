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
		function isImported(node: ESTree.IdentifierReference): boolean {
			return resolveVariable(context.sourceCode, node)?.defs.some((definition) => definition.type === "ImportBinding") ?? false;
		}

		// Most files have no re-exports, so match the entrypoint globs only on the first one.
		let entrypoint: boolean | undefined;
		function isEntrypoint(): boolean {
			if (entrypoint === undefined) {
				const options = context.options[0] as Options | undefined;
				const filename = relative(context.cwd, context.filename).replaceAll("\\", "/");
				entrypoint = (options?.entrypoints ?? defaultEntrypoints).some((pattern) => matchesGlob(filename, pattern));
			}
			return entrypoint;
		}

		return {
			before() {
				entrypoint = undefined;
			},
			ExportNamedDeclaration(node) {
				if (node.source !== null) {
					if (!isEntrypoint()) context.report({ node, messageId: "reexport" });
					return;
				}
				for (const specifier of node.specifiers) {
					if (specifier.local.type === "Identifier" && isImported(specifier.local) && !isEntrypoint()) {
						context.report({ node: specifier, messageId: "reexport" });
					}
				}
			},
			ExportAllDeclaration(node) {
				if (!isEntrypoint()) context.report({ node, messageId: "reexport" });
			},
			ExportDefaultDeclaration(node) {
				if (node.declaration.type === "Identifier" && isImported(node.declaration) && !isEntrypoint()) {
					context.report({ node, messageId: "reexport" });
				}
			},
		};
	},
});
