import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

interface Options {
	maxConditions?: number;
	message?: string;
}

function countRawTerms(node: ESTree.Expression): number {
	const pending = [node];
	let count = 0;
	while (pending.length > 0) {
		const term = pending.pop()!;
		if (term.type === "LogicalExpression" && term.operator !== "??") {
			pending.push(term.left, term.right);
		} else {
			count++;
		}
	}
	return count;
}

/** Limit top-level Boolean terms in control-flow conditions. */
export const maxBooleanConditionsRule = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Limit top-level Boolean terms in control-flow conditions" },
		messages: {
			tooManyConditions: "This condition has {{count}} top-level terms (maximum {{max}}). Prefer a named variable that describes what these conditions mean.",
		},
		schema: [{
			type: "object",
			properties: {
				maxConditions: { type: "integer", minimum: 1 },
				message: { type: "string" },
			},
			additionalProperties: false,
		}],
	},
	createOnce(context) {
		let options: Options;

		function checkCondition(node: ESTree.IfStatement | ESTree.WhileStatement | ESTree.DoWhileStatement | ESTree.ForStatement) {
			if (node.test === null) return;

			// Grouping can only merge terms, so skip token reads when the ungrouped count fits.
			const max = options.maxConditions ?? 3;
			if (countRawTerms(node.test) <= max) return;

			const pending = [node.test];
			let count = 0;
			while (pending.length > 0) {
				const term = pending.pop()!;
				const isGrouped = term !== node.test
					&& context.sourceCode.getTokenBefore(term)?.value === "("
					&& context.sourceCode.getTokenAfter(term)?.value === ")";
				if (term.type === "LogicalExpression" && term.operator !== "??" && !isGrouped) {
					pending.push(term.left, term.right);
				} else {
					count++;
				}
			}

			if (count <= max) return;
			if (options.message !== undefined) {
				context.report({ node: node.test, message: options.message });
			} else {
				context.report({ node: node.test, messageId: "tooManyConditions", data: { count, max } });
			}
		}

		return {
			before() {
				options = (context.options[0] as Options | undefined) ?? {};
			},
			IfStatement: checkCondition,
			WhileStatement: checkCondition,
			DoWhileStatement: checkCondition,
			ForStatement: checkCondition,
		};
	},
});
