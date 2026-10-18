import path from "node:path";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";

import plugin, { recommendedRules } from "../src/index.ts";
import { noReexportsOutsideEntrypointsRule } from "../src/rules/no-reexports-outside-entrypoints.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
	cwd: process.cwd(),
	languageOptions: { parserOptions: { lang: "tsx" } },
});
const filename = path.resolve("src/feature.ts");
const errors = [{ messageId: "reexport" }];

ruleTester.run("no-reexports-outside-entrypoints", noReexportsOutsideEntrypointsRule, {
	valid: [
		{ filename: path.resolve("index.ts"), code: "export * from './foo';" },
		{ filename: path.resolve("src/nested/index.ts"), code: "import type { Foo } from './foo'; export type { Foo };" },
		{ filename: path.resolve("src/client.ts"), options: [{ entrypoints: ["src/client.ts"] }], code: "export { Foo } from './foo';" },
		{ filename: path.resolve("packages/ui/src/server.ts"), options: [{ entrypoints: ["packages/*/src/{client,server}.ts"] }], code: "export * from './foo';" },
		{ filename: path.resolve("src/feature.tsx"), code: "export function run() {} export class Foo {} export interface Options {} export type Name = string; export const Button = () => <div />;" },
		{ filename, code: "function run() {} type Options = {}; export { run }; export type { Options };" },
		{ filename, code: "export default function run() {}" },
		{ filename, code: "const Foo = {}; export default Foo;" },
		{ filename, code: "import { Foo } from './foo'; export function run() { return Foo; }" },
		{ filename, code: "import './task.sh'; export {};" },
	],
	invalid: [
		...[
			"export { Foo } from './foo';",
			"export { Foo as Bar } from './foo';",
			"export type { Foo } from './foo';",
			"export * from './foo';",
			"export type * from './foo';",
			"export * as tools from './foo';",
			"export { default } from './foo';",
			"export { default as script } from './task.sh';",
			"import { Foo } from './foo'; export { Foo };",
			"import { Foo as Bar } from './foo'; export { Bar as Baz };",
			"import type { Foo } from './foo'; export type { Foo };",
			"import { type Foo as Bar } from './foo'; export type { Bar as Baz };",
			"import Foo from './foo'; export default Foo;",
			"import * as tools from './foo'; export { tools };",
			"import script from './task.sh'; export default script;",
			"export { Foo }; import { Foo } from './foo';",
			"import { Foo } from './foo'; function run() {} export { run, Foo };",
		].map((code) => ({ filename, code, errors })),
		{
			name: "custom entrypoints replace the default",
			filename: path.resolve("src/index.ts"),
			options: [{ entrypoints: ["src/client.ts"] }],
			code: "export * from './foo';",
			errors,
		},
		{
			name: "an empty list forbids re-exports everywhere",
			filename: path.resolve("index.ts"),
			options: [{ entrypoints: [] }],
			code: "export * from './foo';",
			errors,
		},
		{ filename: path.resolve("src/index.tsx"), code: "export * from './foo';", errors },
	],
});

it("registers the rule without enabling it by default", () => {
	expect(plugin.rules["no-reexports-outside-entrypoints"]).toBeDefined();
	expect(recommendedRules).not.toHaveProperty("deslop/no-reexports-outside-entrypoints");
});
