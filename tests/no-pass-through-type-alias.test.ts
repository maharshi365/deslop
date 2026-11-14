import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noPassThroughTypeAliasRule } from "../src/rules/no-pass-through-type-alias.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
});

const message = (typeName: string) => `Use ${typeName} directly instead of creating a pass-through type alias.`;

ruleTester.run("no-pass-through-type-alias", noPassThroughTypeAliasRule, {
	valid: [
		"type Name = string;",
		"type User = { id: string };",
		"type Names = User[];",
		"type Strings = Array<string>;",
		"type Box<T> = Wrapper;",
		"type Pair<A, B> = Tuple<B, A>;",
		"type Ids = NS.Id<string>;",
		"type Box<T> = NS.Wrapper;",
		"type Pair<A, B> = NS.Tuple<B, A>;",
		"type Nested<T> = NS.Wrapper<T[]>;",
		"type Imported = import('./user').User;",
		"type Query = typeof NS.value;",
	],
	invalid: [
		{ code: "type Account = User;", errors: [{ message: message("User") }] },
		{ code: "type Box<T> = Wrapper<T>;", errors: [{ message: message("Wrapper") }] },
		{ code: "type Account = NS.User;", errors: [{ message: message("NS.User") }] },
		{ code: "type Account = Deep.NS.User;", errors: [{ message: message("Deep.NS.User") }] },
		{ code: "type Box<T> = NS.Wrapper<T>;", errors: [{ message: message("NS.Wrapper") }] },
		{ code: "export type Pair<A, B> = NS.Tuple<A, B>;", errors: [{ message: message("NS.Tuple") }] },
	],
});
