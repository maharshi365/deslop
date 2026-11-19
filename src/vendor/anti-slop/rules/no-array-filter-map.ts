import { defineRule } from "@oxlint/plugins";

import { arrayMethodName, isKnownArrayExpression, unwrapArrayExpression } from "../shared/array-method.ts";

/** Reject eager array filter/map pipelines; lazy iterator helpers remain allowed. */
export const noArrayFilterMapRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow adjacent array filter/map passes in favor of lazy iterator helpers or a single transformation." },
    messages: {
      arrayFilterMap: "Avoid consecutive array `{{first}}` and `{{second}}` passes. Prefer `.values().{{first}}(...).{{second}}(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.",
    },
  },
  createOnce(context) {
    return {
      before() {
        const text = context.sourceCode.text;
        // Computed method strings and identifiers can both contain escapes.
        return (text.includes("map") && text.includes("filter")) || text.includes("\\");
      },
      CallExpression(node) {
        const outer = unwrapArrayExpression(node.callee);
        if (outer.type !== "MemberExpression") return;
        const second = arrayMethodName(outer);
        if (second !== "map" && second !== "filter") return;
        const innerCall = unwrapArrayExpression(outer.object);
        if (innerCall.type !== "CallExpression") return;
        const inner = unwrapArrayExpression(innerCall.callee);
        if (inner.type !== "MemberExpression") return;
        const first = second === "map" ? "filter" : "map";
        if (arrayMethodName(inner) !== first) return;
        if (!isKnownArrayExpression(context.sourceCode, inner.object)) return;
        context.report({ node, messageId: "arrayFilterMap", data: { first, second } });
      },
    };
  },
});
