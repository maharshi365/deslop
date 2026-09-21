import { eslintCompatPlugin } from "@oxlint/plugins";

import { noArrayFilterMapRule } from "./rules/no-array-filter-map.ts";
import { noReduceAccumulatorCopyRule } from "./rules/no-reduce-accumulator-copy.ts";
import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread.ts";
import { noKnownValueWideningRule } from "./rules/no-known-value-widening.ts";
import { noModuleMockingRule } from "./rules/no-module-mocking.ts";
import { noObjectParametersRule } from "./rules/no-object-parameters.ts";
import { noReflectApplyRule } from "./rules/no-reflect-apply.ts";
import { noReflectGetRule } from "./rules/no-reflect-get.ts";
import { noRuntimeTypeofRule } from "./rules/no-runtime-typeof.ts";
import { noForbiddenTermInSymbolNamesRule } from "./rules/no-shape-in-symbol-names.ts";
import { noUnknownParametersRule } from "./rules/no-unknown-parameters.ts";
import { noUnknownReturnsRule } from "./rules/no-unknown-returns.ts";
import { noUnknownTypeAliasesRule } from "./rules/no-unknown-type-aliases.ts";
import { noUnsafeDictionaryTypeRule } from "./rules/no-unsafe-dictionary-type.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./rules/require-safety-comment-for-type-assertion.ts";
import { noCallOnlyAssertionsRule } from "./rules/no-call-only-assertions.ts";
import { noPoorSubstringTestsRule } from "./rules/no-poor-substring-tests.ts";
import { noPassThroughTypeAliasRule } from "./rules/no-pass-through-type-alias.ts";
import { noDuplicateTypesRule } from "./rules/no-duplicate-types.ts";
import { noDuplicateConstsRule } from "./rules/no-duplicate-consts.ts";
import { canonicalClassNames } from "./tailwind/rule.ts";

/** Every `deslop/*` rule, plus selected standard rules, each set to `"error"`. Spread into the `rules` field of an oxlint config. */
export const recommendedRules: Record<string, "error"> = {
	"deslop/no-array-filter-map": "error",
	"deslop/no-reduce-accumulator-copy": "error",
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
	"deslop/no-pass-through-type-alias": "error",
	"typescript/no-deprecated": "error",
	"typescript/no-require-imports": "error",
	"typescript/no-floating-promises": "error",
	"no-unreachable": "error",
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
		"no-constant-substring-tests": noPoorSubstringTestsRule,
		"no-pass-through-type-alias": noPassThroughTypeAliasRule,
		"no-duplicate-types": noDuplicateTypesRule,
		"no-duplicate-consts": noDuplicateConstsRule,
		// Opt-in: NOT in `recommendedRules`. Requires a `cssPath` option, so users add it manually.
		"canonical-class-names": canonicalClassNames,
	},
}) as ReturnType<typeof eslintCompatPlugin> & { configs: typeof configs };
deslopPlugin.configs = configs;

export default deslopPlugin;
