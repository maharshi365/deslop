import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noRenamedImportsRule } from "../src/rules/no-renamed-imports.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
});

ruleTester.run("no-renamed-imports", noRenamedImportsRule, {
	valid: [
		"import { setTimeout } from 'node:timers/promises';",
		{
			name: "allows aliases when the imported name conflicts with a module binding",
			code: "import { Dialog as DialogPrimitive } from 'radix-ui'; export function Dialog() {}",
		},
		{
			name: "allows aliases for string-named exports, which cannot be local identifiers",
			code: "import { 'not-an-identifier' as identifier } from 'package';",
		},
	],
	invalid: [
		{
			name: "removes a type import alias and renames type references",
			code: "import type { SandboxConfiguration as SandboxConfig } from '@stitch/schemas/sandboxes';\nconst config: SandboxConfig = {};",
			output: "import type { SandboxConfiguration } from '@stitch/schemas/sandboxes';\nconst config: SandboxConfiguration = {};",
			errors: [{ messageId: "unnecessaryAlias" }],
		},
		{
			name: "removes a value import alias",
			code: "import { setTimeout as delay } from 'node:timers/promises';\nawait delay(1);",
			output: "import { setTimeout } from 'node:timers/promises';\nawait setTimeout(1);",
			errors: [{ messageId: "unnecessaryAlias" }],
		},
	],
});
