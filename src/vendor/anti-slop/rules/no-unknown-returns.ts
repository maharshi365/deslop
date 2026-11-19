import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import {
  createTypeAliasEnvironment,
  resetTypeAliasEnvironment,
  resolvedTypeMatches,
  typeBindingVisitors,
  type TypeAliasEnvironment,
} from "../shared/type-alias-resolution.ts";

type FunctionWithReturnType =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

/** Ban function contracts that return unknown instead of a parsed domain type. */
export const noUnknownReturnsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow functions whose explicit return contract is unknown or Promise<unknown>.",
    },
    messages: {
      unknownReturn:
        "This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.",
    },
  },
  createOnce(context) {
    const environment: TypeAliasEnvironment = createTypeAliasEnvironment();
    // Aliases may be declared after their use, so return types are checked at exit, in visit order.
    const owners: Array<FunctionWithReturnType> = [];

    const resolvesToUnknown = (type: ESTree.TSType): boolean =>
      resolvedTypeMatches(type, environment, (resolved, matches) => {
        if (resolved.type === "TSUnknownKeyword") return true;
        if (resolved.type === "TSParenthesizedType") {
          return matches(resolved.typeAnnotation);
        }
        if (resolved.type === "TSUnionType") return resolved.types.some(matches);
        if (
          resolved.type !== "TSTypeReference" ||
          resolved.typeName.type !== "Identifier" ||
          (resolved.typeName.name !== "Promise" &&
            resolved.typeName.name !== "PromiseLike")
        ) {
          return false;
        }
        const value = resolved.typeArguments?.params[0];
        return value !== undefined && matches(value);
      });

    const checkReturnType = (node: FunctionWithReturnType) => {
      const annotation = node.returnType;
      if (annotation === null || annotation === undefined) return;
      if (!resolvesToUnknown(annotation.typeAnnotation)) return;
      context.report({ node: annotation.typeAnnotation, messageId: "unknownReturn" });
    };

    const addOwner = (node: FunctionWithReturnType) => {
      if (node.returnType !== null && node.returnType !== undefined) owners.push(node);
    };

    return {
      ...typeBindingVisitors(environment),
      before() {
        resetTypeAliasEnvironment(environment, context.sourceCode.visitorKeys);
        owners.length = 0;
      },
      ArrowFunctionExpression: addOwner,
      FunctionDeclaration: addOwner,
      FunctionExpression: addOwner,
      TSCallSignatureDeclaration: addOwner,
      TSConstructSignatureDeclaration: addOwner,
      TSConstructorType: addOwner,
      TSDeclareFunction: addOwner,
      TSEmptyBodyFunctionExpression: addOwner,
      TSFunctionType: addOwner,
      TSMethodSignature: addOwner,
      "Program:exit"() {
        for (const node of owners) checkReturnType(node);
      },
    };
  },
});
