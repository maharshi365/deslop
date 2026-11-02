import { defineRule } from "@oxlint/plugins";
import type { Visitor } from "@oxlint/plugins";

type Restriction = string | { selector: string; message?: string };

export const noRestrictedSyntaxRule = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Disallow syntax matched by configured AST selectors." },
		messages: { restrictedSyntax: "{{message}}" },
		schema: {
			type: "array",
			items: {
				anyOf: [
					{ type: "string" },
					{
						type: "object",
						properties: {
							selector: { type: "string" },
							message: { type: "string" },
						},
						required: ["selector"],
						additionalProperties: false,
					},
				],
			},
		},
	},
	create(context) {
		const visitors: Visitor = Object.create(null);
		for (const restriction of context.options as Restriction[]) {
			const selector = typeof restriction === "string" ? restriction : restriction.selector;
			const message = (typeof restriction === "string" ? undefined : restriction.message)
				?? `Using '${selector}' is not allowed.`;
			const previous = visitors[selector];
			visitors[selector] = (node) => {
				previous?.(node);
				context.report({ node, messageId: "restrictedSyntax", data: { message } });
			};
		}
		return visitors;
	},
});
