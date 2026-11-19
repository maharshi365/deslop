import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import {
	createTypeAliasEnvironment,
	resetTypeAliasEnvironment,
	resolvedTypeMatches,
	typeBindingVisitors,
	type TypeAliasEnvironment,
} from "../shared/type-alias-resolution.ts";

/** Ban named aliases that merely conceal TypeScript's unknown top type. */
export const noUnknownTypeAliasesRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow type aliases whose resolved type is unknown; unknown must remain visible at an allowed boundary.",
		},
		messages: {
			unknownAlias:
				"Type alias `{{alias}}` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.",
		},
	},
	createOnce(context) {
		const environment: TypeAliasEnvironment = createTypeAliasEnvironment();
		const bindings = typeBindingVisitors(environment);
		// Aliases may refer to later declarations, so they are checked at exit, in visit order.
		const aliases: Array<ESTree.TSTypeAliasDeclaration> = [];

		const resolvesToUnknown = (type: ESTree.TSType): boolean =>
			resolvedTypeMatches(type, environment, (resolved, matches) => {
				if (resolved.type === "TSUnknownKeyword") return true;
				if (resolved.type === "TSParenthesizedType") {
					return matches(resolved.typeAnnotation);
				}
				return resolved.type === "TSUnionType" && resolved.types.some(matches);
			});

		return {
			...bindings,
			before() {
				resetTypeAliasEnvironment(environment, context.sourceCode.visitorKeys);
				aliases.length = 0;
			},
			TSTypeAliasDeclaration(node) {
				bindings.TSTypeAliasDeclaration(node);
				aliases.push(node);
			},
			"Program:exit"() {
				for (const node of aliases) {
					if (!resolvesToUnknown(node.typeAnnotation)) continue;
					context.report({
						node: node.id,
						messageId: "unknownAlias",
						data: { alias: node.id.name },
					});
				}
			},
		};
	},
});
