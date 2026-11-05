import { expect, it } from "vitest";

import plugin, { configs, recommendedRules } from "../src/index.ts";

it("rejects awaiting non-thenable values in the recommended config", () => {
	expect(configs.recommended.rules["typescript/await-thenable"]).toBe("error");
	expect(configs.recommended.options.typeAware).toBe(true);
});

it("enables accumulating spread checks in the recommended config", () => {
	expect(configs.recommended.rules["oxc/no-accumulating-spread"]).toBe("error");
});

it("rejects bare Map constructors in the recommended config", () => {
	expect(recommendedRules["deslop/no-restricted-syntax"]).toEqual([
		"error",
		{
			selector: "NewExpression[callee.name='Map'][arguments.length=0]:not([typeArguments])",
			message: "Bare new Map() infers Map<any, any>. Provide entries so types can be inferred.",
		},
	]);
	expect(configs.recommended.rules).toBe(recommendedRules);
	expect(recommendedRules).not.toHaveProperty("no-restricted-syntax");
	expect(plugin.rules).toHaveProperty("no-restricted-syntax");
});
