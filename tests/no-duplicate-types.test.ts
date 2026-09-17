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
		{
			name: "allows intentional Drizzle table projections",
			code: `
				import { sqliteTable, text } from "drizzle-orm/sqlite-core";
				const users = sqliteTable("users", {
					id: text("id").primaryKey(),
					name: text("name").notNull(),
					accessToken: text("access_token"),
				});
				type PublicUser = { id: string; name: string };
			`,
			options: [{ drizzle: { models: ["select", "insert"] } }],
		},
		{
			name: "allows narrowed Drizzle DTOs with $type, blob, and real columns",
			code: `
				import { blob, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
				const files = sqliteTable("files", {
					id: text("id").primaryKey(),
					payload: blob("payload").$type<Uint8Array>().notNull(),
					score: real("score"),
				});
				type PublicFile = { id: string; score: number | null };
			`,
			options: [{ drizzle: { models: ["select", "insert"] } }],
		},
		{
			name: "allows public DTOs that omit persisted secret fields",
			code: `
				import { sqliteTable, text } from "drizzle-orm/sqlite-core";
				const users = sqliteTable("users", {
					id: text("id").primaryKey({ autoIncrement: true }),
					name: text("name").notNull(),
					secret: text("secret").notNull(),
				});
				type PublicUser = { id: string; name: string };
			`,
			options: [{ drizzle: { models: ["select"] } }],
		},
		{
			name: "skips tables with unsupported column chains",
			code: `
				import { sqliteTable, text } from "drizzle-orm/sqlite-core";
				const users = sqliteTable("users", {
					id: text("id").primaryKey(),
					tags: text("tags").array(),
				});
				type User = { id: string; tags: string[] | null };
			`,
			options: [{ drizzle: { models: ["select"] } }],
		},
		{
			name: "allows compile-time Drizzle contract checks",
			code: `
				import type { LocalModel } from "@stitch/shared/models/types";
				import type { localModels } from "@/db/schema/providers.js";
				type DbLocalModel = typeof localModels.$inferSelect;
				const contractCheck: LocalModel = {} as DbLocalModel;
			`,
			options: [{ drizzle: { models: ["select", "insert"] } }],
		},
		{
			name: "allows nullable shared contracts",
			code: `
				type Message = { usage: Usage | null };
				const message: Message = { usage: null };
			`,
			options: [{ drizzle: { models: ["select", "insert"] } }],
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
			name: "compares exact Zod schemas with TypeScript declarations",
			code: `
				import { z } from "zod";
				const userSchema = z.object({ id: z.string(), name: z.string() });
				type User = { id: string; name: string };
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
		{
			name: "compares exact SQLite Drizzle select models with TypeScript declarations",
			code: `
				import { sqliteTable, text } from "drizzle-orm/sqlite-core";
				const users = sqliteTable("users", {
					id: text("id").primaryKey(),
					name: text("name").notNull(),
				});
				type User = { id: string; name: string };
			`,
			options: [{ drizzle: { models: ["select"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares exact SQLite Drizzle insert models with TypeScript declarations",
			code: `
				import { sqliteTable, text } from "drizzle-orm/sqlite-core";
				const users = sqliteTable("users", {
					id: text("id").primaryKey(),
					name: text("name").notNull(),
				});
				type NewUser = { id: string; name: string };
			`,
			options: [{ drizzle: { models: ["insert"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares manual Drizzle row mirrors with $type, blob, and real columns",
			code: `
				import { blob, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
				const files = sqliteTable("files", {
					id: text("id").primaryKey(),
					payload: blob("payload").$type<Uint8Array>().notNull(),
					score: real("score"),
				});
				type FileRow = { id: string; payload: Uint8Array; score: number | null };
			`,
			options: [{ drizzle: { models: ["select"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares Drizzle select aliases with table models",
			code: `
				import { blob, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
				const files = sqliteTable("files", {
					id: text("id").primaryKey(),
					payload: blob("payload").$type<Uint8Array>().notNull(),
					score: real("score"),
				});
				type FileRow = typeof files.$inferSelect;
			`,
			options: [{ drizzle: { models: ["select"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares Drizzle insert aliases with table models",
			code: `
				import { blob, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
				const files = sqliteTable("files", {
					id: text("id").primaryKey(),
					payload: blob("payload").$type<Uint8Array>().notNull(),
					score: real("score"),
				});
				type NewFile = typeof files.$inferInsert;
			`,
			options: [{ drizzle: { models: ["insert"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares $type generic overrides with manual row mirrors",
			code: `
				import { sqliteTable, text } from "drizzle-orm/sqlite-core";
				type PrefixedString<T> = string & { prefix: T };
				const users = sqliteTable("users", {
					id: text("id").$type<PrefixedString<"id">>().primaryKey({ autoIncrement: true }),
					name: text("name").notNull(),
				});
				type UserRow = { id: PrefixedString<"id">; name: string };
			`,
			options: [{ drizzle: { models: ["select"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares blob $type array overrides with manual row mirrors",
			code: `
				import { blob, sqliteTable, text } from "drizzle-orm/sqlite-core";
				const files = sqliteTable("files", {
					id: text("id").primaryKey(),
					attachments: blob("attachments").$type<Foo[]>().notNull(),
				});
				type FileRow = { attachments: Foo[]; id: string };
			`,
			options: [{ drizzle: { models: ["select"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares real columns with number row fields",
			code: `
				import { real, sqliteTable, text } from "drizzle-orm/sqlite-core";
				const readings = sqliteTable("readings", {
					id: text("id").primaryKey(),
					value: real("value").notNull(),
				});
				type Reading = { id: string; value: number };
			`,
			options: [{ drizzle: { models: ["select"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares SQLite boolean-mode integer columns with boolean row fields",
			code: `
				import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
				const settings = sqliteTable("settings", {
					id: text("id").primaryKey(),
					enabled: integer("enabled", { mode: "boolean" }).notNull(),
				});
				type Setting = { enabled: boolean; id: string };
			`,
			options: [{ drizzle: { models: ["select"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares SQLite number-mode integer columns with shared row fields",
			code: `
				import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
				const todos = sqliteTable("todos", {
					id: text("id").primaryKey(),
					position: integer("position", { mode: "number" }).notNull(),
					updatedAt: integer("updated_at", { mode: "number" }),
				});
				type SessionTodo = { id: string; position: number; updatedAt: number | null };
			`,
			options: [{ drizzle: { models: ["select"] } }],
			errors: [{ messageId: "duplicate" }],
		},
		{
			name: "compares schema-qualified Postgres table models with manual row mirrors",
			code: `
				import { pgSchema, text } from "drizzle-orm/pg-core";
				const auth = pgSchema("auth");
				const users = auth.table("users", {
					id: text("id").primaryKey(),
					name: text("name").notNull(),
				});
				type User = { id: string; name: string };
			`,
			options: [{ drizzle: { models: ["select"] } }],
			errors: [{ messageId: "duplicate" }],
		},
	],
});
