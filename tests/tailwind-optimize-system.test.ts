import { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { describe, expect, it } from "vitest";
import { optimizeDesignSystem } from "../src/tailwind/optimize-system.ts";

const css = '@import "tailwindcss/theme.css"; @tailwind utilities;';

describe("partitioned Tailwind index", () => {
	it.each([
		css,
		'@import "tailwindcss/theme.css" prefix(tw); @tailwind utilities;',
		`${css} @theme { --spacing: 0.5rem; --color-alias: #fff; --text-tiny: 14px; --text-huge: 3rem; --leading-comfy: 2; }`,
		`${css} @utility custom { margin-top: 1rem; } @utility other { --tw-sort: margin-top; --tw-custom: 1; margin-top: 1rem; }`,
	])("keeps canonical output with theme and utility changes", async input => {
		const original = await __unstable__loadDesignSystem(input, { base: process.cwd() });
		const optimized = optimizeDesignSystem(await __unstable__loadDesignSystem(input, { base: process.cwd() }));
		const tokens = [
			"flex", "text-sm", "mt-[16px]", "px-[16px]", "text-[14px]", "bg-white", "hover:bg-gray-100", "unknown",
			"text-huge/comfy", "text-[48px]/[2]", "text-sm/6", "text-sm/[24px]", "bg-[#fff]/50", "bg-white/100", "bg-[red]/[0.5]",
			"grow-1", "shrink-1", "start-4", "order-none", "break-words", "-mt-[16px]", "mt-[16px]!", "sm:focus:mt-[16px]",
			"[margin-top:16px]", "[--custom:16px]", "[&:hover]:mt-[16px]", "aria-[hidden=true]:flex", "data-[active]:flex",
			"custom", "other", "mt-4", "w-[50%]", "w-1/2", "translate-x-[16px]", "shadow-[0_1px_2px_0_#0001]",
		];
		for (const rem of [16, 20]) {
			for (const value of tokens) {
				const token = original.theme.prefix ? `${original.theme.prefix}:${value}` : value;
				expect(optimized.canonicalizeCandidates([token], { rem }), `${token}, rem=${rem}`).toEqual(original.canonicalizeCandidates([token], { rem }));
			}
		}
	}, 30000);
});
