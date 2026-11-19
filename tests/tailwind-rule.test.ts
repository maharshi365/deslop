import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";

import { mentionsName } from "../src/tailwind/candidates.ts";
import { canonicalClassNames } from "../src/tailwind/rule.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const theme = path.resolve("node_modules/tailwindcss/theme.css").replaceAll("\\", "/");
const cssPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "deslop-rule-")), "styles.css");
fs.writeFileSync(cssPath, `@import ${JSON.stringify(theme)};\n@tailwind utilities;\n`);
const options = [{ cssPath }];

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });

ruleTester.run("canonical-class-names", canonicalClassNames, {
	valid: [
		{ code: '<div className="flex gap-4 custom-component" />', options },
		{ name: "skips interpolated templates", code: "<div className={`mt-[16px] ${size}`} />", options },
		{ name: "skips unconfigured attributes", code: '<div data-class="mt-[16px]" />', options },
		{ name: "skips unconfigured helpers", code: 'merge("mt-[16px]");', options },
	],
	invalid: [
		{
			name: "reports and fixes every occurrence, including repeated strings",
			code: '<><div className="mt-[16px] flex" /><div className="mt-[16px] flex" /><div class=\'px-[16px] py-[16px]\' /></>',
			output: '<><div className="mt-4 flex" /><div className="mt-4 flex" /><div class=\'px-4 py-4\' /></>',
			options,
			errors: [
				{ messageId: "nonCanonical", data: { original: "mt-[16px]", canonical: "mt-4", suffix: "" } },
				{ messageId: "nonCanonical", data: { original: "mt-[16px]", canonical: "mt-4", suffix: "" } },
				{ messageId: "nonCanonical", data: { original: "px-[16px]", canonical: "px-4", suffix: " (+1 more in this string)" } },
			],
		},
		{
			name: "checks string arguments of helper calls, including member calls",
			code: 'cn("px-[16px]", active && "font-bold");\nstyles.cx(`w-[2px]`);',
			output: 'cn("px-4", active && "font-bold");\nstyles.cx(`w-0.5`);',
			options,
			errors: [{ messageId: "nonCanonical" }, { messageId: "nonCanonical" }],
		},
		{
			name: "maps each result to its string when a file has more strings than one worker chunk",
			code: ["cn('mt-[16px]')", ...Array.from({ length: 10 }, (_, i) => `cn('flex gap-${i}')`), "cn('px-[16px]')"].join(";\n"),
			output: ["cn('mt-4')", ...Array.from({ length: 10 }, (_, i) => `cn('flex gap-${i}')`), "cn('px-4')"].join(";\n"),
			options,
			errors: [
				{ messageId: "nonCanonical", line: 1, data: { original: "mt-[16px]", canonical: "mt-4", suffix: "" } },
				{ messageId: "nonCanonical", line: 12, data: { original: "px-[16px]", canonical: "px-4", suffix: "" } },
			],
		},
		{
			name: "uses the root font size",
			code: '<div className="mt-[20px]" />',
			output: '<div className="mt-4" />',
			options: [{ cssPath, rootFontSize: 20 }],
			errors: [{ messageId: "nonCanonical", data: { original: "mt-[20px]", canonical: "mt-4", suffix: "" } }],
		},
		{
			name: "replaces the default names with configured ones",
			code: '<div tw="mt-[16px]" className="mt-[16px]" />;\nvariants("mt-[16px]");',
			output: '<div tw="mt-4" className="mt-[16px]" />;\nvariants("mt-4");',
			options: [{ cssPath, attributes: ["tw"], calleeFunctions: ["variants"] }],
			errors: [{ messageId: "nonCanonical" }, { messageId: "nonCanonical" }],
		},
		{
			name: "reports each class string when the CSS entry cannot be loaded",
			code: '<div className="mt-[16px]" />;\ncn("flex");',
			options: [{ cssPath: path.join(path.dirname(cssPath), "missing.css") }],
			errors: [{ messageId: "cssNotFound" }, { messageId: "cssNotFound" }],
		},
	],
});

describe("mentionsName", () => {
	it("matches whole identifiers only", () => {
		expect(mentionsName("const between = 2;", "tw")).toBe(false);
		expect(mentionsName("const $cn = cn_;", "cn")).toBe(false);
		expect(mentionsName("x = tw(`p-4`)", "tw")).toBe(true);
		expect(mentionsName("styles.cx(a)", "cx")).toBe(true);
		expect(mentionsName("cn", "cn")).toBe(true);
	});

	it("treats non-ASCII characters as boundaries, so Unicode whitespace never hides a name", () => {
		expect(mentionsName("x = cn('p-4')", "cn")).toBe(true);
	});
});
