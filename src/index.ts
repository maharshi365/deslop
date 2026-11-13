import { eslintCompatPlugin } from "@oxlint/plugins";

import { noArrayFilterMapRule } from "./vendor/anti-slop/rules/no-array-filter-map.ts";
import { noReduceAccumulatorCopyRule } from "./vendor/anti-slop/rules/no-reduce-accumulator-copy.ts";
import { noChainedTypeAssertionsRule } from "./vendor/anti-slop/rules/no-chained-type-assertions.ts";
import { noConditionalEmptyObjectSpreadRule } from "./vendor/anti-slop/rules/no-conditional-empty-object-spread.ts";
import { noKnownValueWideningRule } from "./vendor/anti-slop/rules/no-known-value-widening.ts";
import { noModuleMockingRule } from "./vendor/anti-slop/rules/no-module-mocking.ts";
import { noObjectParametersRule } from "./vendor/anti-slop/rules/no-object-parameters.ts";
import { noReflectApplyRule } from "./vendor/anti-slop/rules/no-reflect-apply.ts";
import { noReflectGetRule } from "./vendor/anti-slop/rules/no-reflect-get.ts";
import { noRestrictedSyntaxRule } from "./rules/no-restricted-syntax.ts";
import { noRuntimeTypeofRule } from "./vendor/anti-slop/rules/no-runtime-typeof.ts";
import { noForbiddenTermInSymbolNamesRule } from "./vendor/anti-slop/rules/no-shape-in-symbol-names.ts";
import { noUnknownParametersRule } from "./vendor/anti-slop/rules/no-unknown-parameters.ts";
import { noUnknownReturnsRule } from "./vendor/anti-slop/rules/no-unknown-returns.ts";
import { noUnknownTypeAliasesRule } from "./vendor/anti-slop/rules/no-unknown-type-aliases.ts";
import { noUnsafeDictionaryTypeRule } from "./vendor/anti-slop/rules/no-unsafe-dictionary-type.ts";
import { noWidenThenAssertRule } from "./vendor/anti-slop/rules/no-widen-then-assert.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./vendor/anti-slop/rules/require-safety-comment-for-type-assertion.ts";
import { noCallOnlyAssertionsRule } from "./rules/no-call-only-assertions.ts";
import { noPoorSubstringTestsRule } from "./rules/no-poor-substring-tests.ts";
import { noRepeatedExpectCallRule } from "./rules/no-repeated-expect-call.ts";
import { noPassThroughTypeAliasRule } from "./rules/no-pass-through-type-alias.ts";
import { noPassThroughSchemaRule } from "./rules/no-pass-through-schema.ts";
import { noDuplicateTypesRule } from "./rules/no-duplicate-types.ts";
import { noDuplicateConstsRule } from "./rules/no-duplicate-consts.ts";
import { noRenamedImportsRule } from "./rules/no-renamed-imports.ts";
import { noReexportsOutsideEntrypointsRule } from "./rules/no-reexports-outside-entrypoints.ts";
import { maxBooleanConditionsRule } from "./rules/max-boolean-conditions.ts";
import { canonicalClassNames } from "./tailwind/rule.ts";

/** Recommended `deslop/*` rules, plus selected standard rules, each set to `"error"`. Spread into the `rules` field of an oxlint config. */
export const recommendedRules: Record<string, "error" | ["error", { selector: string; message: string }]> = {
	"deslop/no-array-filter-map": "error",
	"deslop/no-reduce-accumulator-copy": "error",
	"oxc/no-accumulating-spread": "error",
	"deslop/no-chained-type-assertions": "error",
	"deslop/no-conditional-empty-object-spread": "error",
	"deslop/no-known-value-widening": "error",
	"deslop/no-module-mocking": "error",
	"deslop/no-object-parameters": "error",
	"deslop/no-reflect-apply": "error",
	"deslop/no-reflect-get": "error",
	"deslop/no-runtime-typeof": "error",
	"deslop/no-shape-in-symbol-names": "error",
	"deslop/no-unknown-parameters": "error",
	"deslop/no-unknown-returns": "error",
	"deslop/no-unknown-type-aliases": "error",
	"deslop/no-unsafe-dictionary-type": "error",
	"deslop/no-widen-then-assert": "error",
	"deslop/require-safety-comment-for-type-assertion": "error",
	"deslop/no-call-only-assertions": "error",
	"deslop/no-poor-substring-tests": "error",
	"deslop/no-repeated-expect-call": "error",
	"deslop/no-pass-through-type-alias": "error",
	"typescript/no-deprecated": "error",
	"typescript/no-require-imports": "error",
	"typescript/no-floating-promises": "error",
	"typescript/await-thenable": "error",
	"typescript/no-unnecessary-condition": "error",
	"typescript/switch-exhaustiveness-check": "error",
	"typescript/no-inferrable-types": "error",
	"no-unreachable": "error",
	"deslop/no-restricted-syntax": [
		"error",
		{
			selector: "NewExpression[callee.name='Map'][arguments.length=0]:not([typeArguments])",
			message: "Bare new Map() infers Map<any, any>. Provide entries so types can be inferred.",
		},
	],
};

/** ESLint flat-config style configs. `recommended` enables every recommended `deslop/*` rule as `"error"` (excluding opt-in rules), plus standard `typescript/*` rules. The `typescript/*` rules require type-aware linting (`options.typeAware`), so `recommended` sets it. */
export const configs = {
	recommended: {
		name: "deslop/recommended",
		options: { typeAware: true },
		rules: recommendedRules,
	},
};

/** Generic Oxlint rules that reject low-evidence and low-signal implementation patterns. */
const deslopPlugin = eslintCompatPlugin({
	meta: { name: "deslop" },
	rules: {
		"no-array-filter-map": noArrayFilterMapRule,
		"no-reduce-accumulator-copy": noReduceAccumulatorCopyRule,
		"no-chained-type-assertions": noChainedTypeAssertionsRule,
		"no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
		"no-known-value-widening": noKnownValueWideningRule,
		"no-module-mocking": noModuleMockingRule,
		"no-object-parameters": noObjectParametersRule,
		"no-reflect-apply": noReflectApplyRule,
		"no-reflect-get": noReflectGetRule,
		"no-restricted-syntax": noRestrictedSyntaxRule,
		"no-runtime-typeof": noRuntimeTypeofRule,
		"no-shape-in-symbol-names": noForbiddenTermInSymbolNamesRule,
		"no-unknown-parameters": noUnknownParametersRule,
		"no-unknown-returns": noUnknownReturnsRule,
		"no-unknown-type-aliases": noUnknownTypeAliasesRule,
		"no-unsafe-dictionary-type": noUnsafeDictionaryTypeRule,
		"no-widen-then-assert": noWidenThenAssertRule,
		"require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertionRule,
		"no-call-only-assertions": noCallOnlyAssertionsRule,
		"no-poor-substring-tests": noPoorSubstringTestsRule,
		"no-repeated-expect-call": noRepeatedExpectCallRule,
		"no-constant-substring-tests": noPoorSubstringTestsRule,
		"no-pass-through-type-alias": noPassThroughTypeAliasRule,
		"no-pass-through-schema": noPassThroughSchemaRule,
		"no-duplicate-types": noDuplicateTypesRule,
		"no-duplicate-consts": noDuplicateConstsRule,
		"no-renamed-imports": noRenamedImportsRule,
		"no-reexports-outside-entrypoints": noReexportsOutsideEntrypointsRule,
		"max-boolean-conditions": maxBooleanConditionsRule,
		// Opt-in: NOT in `recommendedRules`. Requires a `cssPath` option, so users add it manually.
		"canonical-class-names": canonicalClassNames,
	},
}) as ReturnType<typeof eslintCompatPlugin> & { configs: typeof configs };
deslopPlugin.configs = configs;

export default deslopPlugin;
