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
		{
			name: "allows aliases when a var hoisted out of a block declares the imported name",
			code: "import { a as b } from 'x';\nif (b) { for (;;) { var a = 1; } }",
		},
		{
			name: "allows aliases when a type declares the imported name",
			code: "import type { A as B } from 'x';\ntype A = B;",
		},
		{
			name: "allows aliases when a default-exported function declares the imported name",
			code: "import { a as b } from 'x';\nexport default function a() { return b; }",
		},
		{
			name: "allows aliases when a destructuring pattern declares the imported name",
			code: "import { a as b } from 'x';\nconst { c: [a = 1] } = b;",
		},
	],
	invalid: [
		{
			name: "reports when the imported name is declared only in a nested block",
			code: "import { a as b } from 'x';\nb();\n{ const a = 1; }",
			output: "import { a } from 'x';\na();\n{ const a = 1; }",
			errors: [{ messageId: "unnecessaryAlias" }],
		},
		{
			name: "reports when the imported name is declared only inside a namespace",
			code: "import { a as b } from 'x';\nnamespace N { export const a = 1; }\nb();",
			output: "import { a } from 'x';\nnamespace N { export const a = 1; }\na();",
			errors: [{ messageId: "unnecessaryAlias" }],
		},
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
		{
			name: "keeps an inline type modifier when removing the alias",
			code: "import { type Foo as Bar } from 'x';\nconst value: Bar = {};",
			output: "import { type Foo } from 'x';\nconst value: Foo = {};",
			errors: [{ messageId: "unnecessaryAlias" }],
		},
		{
			name: "keeps the property key of a shorthand object property",
			code: "import { foo as bar } from 'x';\nconst o = { bar };",
			output: "import { foo } from 'x';\nconst o = { bar: foo };",
			errors: [{ messageId: "unnecessaryAlias" }],
		},
		{
			name: "keeps the public name of a shorthand export",
			code: "import { foo as bar } from 'x';\nexport { bar };",
			output: "import { foo } from 'x';\nexport { foo as bar };",
			errors: [{ messageId: "unnecessaryAlias" }],
		},
		{
			name: "keeps the public name of a shorthand type export",
			code: "import type { Foo as Bar } from 'x';\nexport type { Bar };",
			output: "import type { Foo } from 'x';\nexport type { Foo as Bar };",
			errors: [{ messageId: "unnecessaryAlias" }],
		},
		{
			name: "renames only the local side of an aliased export",
			code: "import { foo as bar } from 'x';\nexport { bar as baz };",
			output: "import { foo } from 'x';\nexport { foo as baz };",
			errors: [{ messageId: "unnecessaryAlias" }],
		},
		{
			name: "renames references in typeof type queries",
			code: "import { foo as bar } from 'x';\ntype T = typeof bar;",
			output: "import { foo } from 'x';\ntype T = typeof foo;",
			errors: [{ messageId: "unnecessaryAlias" }],
		},
		{
			name: "renames JSX component references",
			code: "import { Foo as Bar } from 'x';\nconst element = <Bar></Bar>;",
			output: "import { Foo } from 'x';\nconst element = <Foo></Foo>;",
			errors: [{ messageId: "unnecessaryAlias" }],
			languageOptions: { parserOptions: { lang: "tsx" } },
		},
		{
			name: "renames JSX member expression objects to lowercase names",
			code: "import { foo as Bar } from 'x';\nconst element = <Bar.Item />;",
			output: "import { foo } from 'x';\nconst element = <foo.Item />;",
			errors: [{ messageId: "unnecessaryAlias" }],
			languageOptions: { parserOptions: { lang: "tsx" } },
		},
		{
			name: "does not fix when a lowercase name would turn a JSX component into an intrinsic element",
			code: "import { foo as Bar } from 'x';\nconst element = <Bar />;",
			output: null,
			errors: [{ messageId: "unnecessaryAlias" }],
			languageOptions: { parserOptions: { lang: "tsx" } },
		},
		{
			name: "does not fix when a local variable shadows the imported name at a reference",
			code: "import { foo as bar } from 'x';\nfunction f() { const foo = 1; return bar + foo; }",
			output: null,
			errors: [{ messageId: "unnecessaryAlias" }],
		},
		{
			name: "does not fix when a parameter shadows the imported name at a reference",
			code: "import { foo as bar } from 'x';\nfunction f(foo: number) { return bar(foo); }",
			output: null,
			errors: [{ messageId: "unnecessaryAlias" }],
		},
		{
			name: "does not fix when a local type shadows the imported name at a reference",
			code: "import type { Foo as Bar } from 'x';\nfunction f() { type Foo = string; const value: Bar = {}; return value; }",
			output: null,
			errors: [{ messageId: "unnecessaryAlias" }],
		},
		{
			name: "fixes when a same-named binding is in a scope without references",
			code: "import { foo as bar } from 'x';\nfunction f() { const foo = 1; return foo; }\nbar();",
			output: "import { foo } from 'x';\nfunction f() { const foo = 1; return foo; }\nfoo();",
			errors: [{ messageId: "unnecessaryAlias" }],
		},
		{
			name: "does not fix when the import would capture a global reference",
			code: "import { setTimeout as delay } from 'node:timers/promises';\nawait delay(1);\nsetTimeout(() => {}, 1);",
			output: null,
			errors: [{ messageId: "unnecessaryAlias" }],
		},
		{
			name: "does not fix when the imported name is a reserved word",
			code: "import { default as React } from 'react';\nReact.createElement('div');",
			output: null,
			errors: [{ messageId: "unnecessaryAlias" }],
		},
	],
});
