import { matchesGlob, relative } from "node:path";
import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";

interface Options {
	entrypoints?: string[];
}

/** Keep re-exports in explicitly allowed entrypoint files. */
export const noReexportsOutsideEntrypointsRule = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Disallow re-exports outside configured entrypoint files" },
		messages: {
			reexport: "Re-export this symbol from a package entrypoint instead of this file.",
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

		return {
			before() {
				const options = context.options[0] as Options | undefined;
				const filename = relative(context.cwd, context.filename).replaceAll("\\", "/");
				return !(options?.entrypoints ?? ["**/index.ts"]).some((pattern) => matchesGlob(filename, pattern));
			},
			ExportNamedDeclaration(node) {
				if (node.source !== null) {
					context.report({ node, messageId: "reexport" });
					return;
				}
				for (const specifier of node.specifiers) {
					if (specifier.local.type === "Identifier" && isImported(specifier.local)) {
						context.report({ node: specifier, messageId: "reexport" });
					}
				}
			},
			ExportAllDeclaration(node) {
				context.report({ node, messageId: "reexport" });
			},
			ExportDefaultDeclaration(node) {
				if (node.declaration.type === "Identifier" && isImported(node.declaration)) {
					context.report({ node, messageId: "reexport" });
				}
			},
		};
	},
});
