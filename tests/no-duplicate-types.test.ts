import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noDuplicateTypesRule } from "../src/rules/no-duplicate-types.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
});

ruleTester.run("no-duplicate-types", noDuplicateTypesRule, {
	valid: [
		"interface User { id: string; email: string }",
		"type User = { id: string; email: number }",
		"type First<T> = { value: T; tag: string }; type Second<U> = { value: U; tag: number };",
		"type Unsupported = { callback(): void }; type AlsoUnsupported = { callback(): void };",
		{
			name: "ignores top-level intersection aliases",
			code: `
				type TriggerDoc = GitHubTriggerDocFields & {
					schemaVersion: number;
					revision: number;
					orgId: ObjectId;
					factoryId: ObjectId;
					createdBy: ObjectId;
					createdAt: Date;
					updatedAt: Date;
					updatedBy: ObjectId;
					admissionVersion?: number;
				};
				type RenamedTriggerDoc = GitHubTriggerDocFields & {
					schemaVersion: number;
					revision: number;
					orgId: ObjectId;
					factoryId: ObjectId;
					createdBy: ObjectId;
					createdAt: Date;
					updatedAt: Date;
					updatedBy: ObjectId;
					admissionVersion?: number;
				};
			`,
		},
		{
			name: "ignores top-level utility type aliases",
			code: `
				export type GitHubTrigger = Extract<Trigger, { provider: 'github' }>;
				export type RenamedGitHubTrigger = Extract<Trigger, { provider: 'github' }>;
			`,
		},
		{
			name: "can limit comparison to schemas",
			code: `
				import { z } from "zod";
				interface User { id: string; email: string }
				const AccountSchema = z.object({ email: z.string(), id: z.string() });
			`,
			options: [{ schemas: { libraries: ["zod"], matchTypes: false } }],
		},
	],
	invalid: [
		{
			name: "normalizes declaration kind, name, and property order",
			code: "interface User { id: string; email: string } type Account = { email: string; id: string }",
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "normalizes nested properties and union member order",
			code: "type One = { state: 'open' | 'closed'; nested: { id: number; active?: boolean } }; type Two = { nested: { active?: boolean; id: number }; state: 'closed' | 'open' };",
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "normalizes declared generic parameter names",
			code: "type Box<T> = { value: T; values: T[] }; interface Container<U> { values: U[]; value: U }",
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "uses a custom message",
			filename: "/repo/test.ts",
			code: "type First = { id: string; email: string }; type Second = { email: string; id: string };",
			options: [{ message: "Use the shared domain contract." }],
			errors: [{ message: "Use the shared domain contract. First seen as First in /repo/test.ts." }],
		},
		{
			name: "compares inferred Zod object schemas with TypeScript declarations",
			code: `
				import { z } from "zod";
				const UserSchema = z.object({ id: z.string().uuid(), email: z.string().email().optional() });
				interface Account { email?: string; id: string }
			`,
			options: [{ schemas: { libraries: ["zod"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares Zod schemas with aliased namespace imports",
			code: `
				import * as schema from "zod";
				const UserSchema = schema.object({ id: schema.string(), tags: schema.array(schema.string()) });
				const AccountSchema = schema.object({ tags: schema.string().array(), id: schema.string() });
			`,
			options: [{ schemas: { libraries: ["zod"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares inferred Valibot object schemas with TypeScript declarations",
			code: `
				import { object, string, number, optional } from "valibot";
				const UserSchema = object({ id: string(), age: optional(number()) });
				interface Account { age?: number; id: string }
			`,
			options: [{ schemas: { libraries: ["valibot"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares inferred ArkType object schemas with TypeScript declarations",
			code: `
				import { type } from "arktype";
				const UserSchema = type({ id: "string", "age?": "number" });
				interface Account { age?: number; id: string }
			`,
			options: [{ schemas: { libraries: ["arktype"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares Drizzle select models with TypeScript declarations",
			code: `
				import { pgTable, text, integer } from "drizzle-orm/pg-core";
				const users = pgTable("users", { id: text("id").notNull(), age: integer("age") });
				interface User { age: number | null; id: string }
			`,
			options: [{ drizzle: { models: ["select"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "infers optional Drizzle insert columns",
			code: `
				import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";
				const users = pgTable("users", { id: serial("id").primaryKey(), name: text("name").notNull(), age: integer("age") });
				interface NewUser { age?: number | null; id?: number; name: string }
			`,
			options: [{ drizzle: { models: ["insert"] } }],
			errors: [{ messageId: "duplicate" }],
		},
	],
});
