import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";

import plugin, { recommendedRules } from "../src/index.ts";
import { noPassThroughSchemaRule } from "../src/rules/no-pass-through-schema.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
});

ruleTester.run("no-pass-through-schema", noPassThroughSchemaRule, {
	valid: [
		"const PersonSchema = {}; const UserSchema = PersonSchema;",
		"import { z } from 'zod'; const User = z.object({ name: z.string() });",
		"import { z } from 'zod'; const User = z.object({}); const Admin = User.extend({}); const Optional = User.optional();",
		"import { z } from 'zod'; const User = z.string(); type Name = z.infer<typeof User>;",
		"import { z } from 'zod'; const Result = z.string().parse('hi'); const Alias = Result;",
		"import { z } from 'zod'; const Result = z.string().safeParse('hi'); const Alias = Result;",
		"import { z } from 'zod'; const Metadata = z.string().meta(); const Alias = Metadata;",
		"import type { z } from 'zod'; const User = z.string(); const Alias = User;",
		"import { type z } from 'zod'; const User = z.string(); const Alias = User;",
		"const A = B; const B = A;",
		"const A = B.optional(); const B = A;",
		"import { z } from 'zod'; function f(z) { const User = z.string(); const Alias = User; }",
		"import { z } from 'zod'; const User = z.string(); function f(User) { const Alias = User; }",
		"import { z } from 'unrelated'; const User = z.string(); const Alias = User;",
		"import { z } from 'zod'; const User = z.getErrorMap(); const Alias = User;",
		"import { type } from 'arktype'; const Result = type('string')('hi'); const Alias = Result;",
		"import { type } from 'arktype'; const Result = type('string').allows('hi'); const Alias = Result;",
		"import { z } from 'zod'; let User = z.string(); User = other; const Alias = User;",
		{
			code: "import { z } from 'zod'; const User = z.string(); const Alias = User;",
			options: [{ libraries: [] }],
		},
		{
			code: "import { z } from 'zod'; const User = z.string(); export const Alias = User;",
			options: [{ allowExportedAliases: true }],
		},
		{
			code: "import { z } from 'zod'; const User = z.string(); const Alias = User; export { Alias as Public };",
			options: [{ allowExportedAliases: true }],
		},
		{
			code: "import { z } from 'zod'; const User = z.string(); const Alias = User; export default Alias;",
			options: [{ allowExportedAliases: true }],
		},
		{
			code: "import { Other } from '@app/contracts'; const Alias = Other;",
			options: [{ schemaImports: [{ from: '@app/contracts', names: ['User'] }] }],
		},
		{
			code: "import type { User } from '@app/contracts'; const Alias = User;",
			options: [{ schemaImports: [{ from: '@app/contracts', names: ['User'] }] }],
		},
	],
	invalid: [
		{
			code: "import { z } from 'zod'; const Person = z.object({}); const User = Person;",
			errors: [{ messageId: "passThroughSchema", data: { schemaName: "Person" } }],
		},
		{
			code: "import { z as schema } from 'zod/v4'; const Person = schema.string(); const User = Person; const Name = User;",
			errors: [{ messageId: "passThroughSchema" }, { messageId: "passThroughSchema" }],
		},
		{
			code: "import * as schema from 'zod'; const Person = schema.z.string(); const User = Person;",
			errors: [{ messageId: "passThroughSchema" }],
		},
		{
			code: "import { object as makeObject } from 'zod'; const Person = makeObject({}); const User = Person;",
			errors: [{ messageId: "passThroughSchema" }],
		},
		{
			code: "import { type as schema } from 'arktype'; const Person = schema({ name: 'string' }); const User = Person;",
			errors: [{ messageId: "passThroughSchema" }],
		},
		{
			code: "import * as ark from 'arktype'; const Person = ark.type('string'); const User = Person;",
			errors: [{ messageId: "passThroughSchema" }],
		},
		{
			code: "import { z } from 'zod'; const Person = z.string().optional(); export const User = Person;",
			errors: [{ messageId: "passThroughSchema" }],
		},
		{
			code: "import z from 'zod'; const Person = z.string().meta({ title: 'Person' }); const User = Person;",
			errors: [{ messageId: "passThroughSchema" }],
		},
		{
			code: "import { z } from 'zod'; const Person = z.string().transform(x => x.length); const User = Person;",
			errors: [{ messageId: "passThroughSchema" }],
		},
		{
			code: "import { type } from 'arktype'; const Person = type('string').array(); const User = Person;",
			errors: [{ messageId: "passThroughSchema" }],
		},
		{
			code: "import { User as Person } from '@app/contracts'; const Alias = Person;",
			options: [{ libraries: [], schemaImports: [{ from: '@app/contracts', names: ['User'] }] }],
			errors: [{ messageId: "passThroughSchema", data: { schemaName: "Person" } }],
		},
		{
			code: "import Person from '@app/contracts'; const Alias = Person;",
			options: [{ schemaImports: [{ from: '@app/contracts', names: ['default'] }] }],
			errors: [{ messageId: "passThroughSchema" }],
		},
		{
			code: "import { z } from 'zod'; const Person = z.string(); function f() { const Alias = Person; }",
			errors: [{ messageId: "passThroughSchema" }],
		},
		{
			code: "import { z } from 'zod'; const Person = z.string(); const Alias = Person; export const Public = Alias;",
			options: [{ allowExportedAliases: true }],
			errors: [{ messageId: "passThroughSchema", data: { schemaName: "Person" } }],
		},
		{
			code: "import { z } from 'zod'; const User = z.string(); const Alias = User; export { Alias };",
			errors: [{ messageId: "passThroughSchema" }],
		},
		{
			code: "import { z } from 'zod'; const User = z.string(); const Alias = User; export type { Alias };",
			options: [{ allowExportedAliases: true }],
			errors: [{ messageId: "passThroughSchema" }],
		},
	],
});

it("registers the rule without enabling it by default", () => {
	expect(plugin.rules["no-pass-through-schema"]).toBeDefined();
	expect(recommendedRules).not.toHaveProperty("deslop/no-pass-through-schema");
});
