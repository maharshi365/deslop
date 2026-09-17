# No Duplicate Types

`deslop/no-duplicate-types` reports TypeScript interfaces and object type aliases with the same supported structure. It is opt-in because identical contracts can be intentional at package or external-API boundaries.

## Configuration

Add the rule alongside the recommended config:

```ts
import { defineConfig } from "oxlint";
import { configs as deslopConfigs } from "ai-deslop";

export default defineConfig({
  jsPlugins: ["ai-deslop"],
  options: {
    ...deslopConfigs.recommended.options,
  },
  rules: {
    ...deslopConfigs.recommended.rules,
    "deslop/no-duplicate-types": ["warn", {
      message: "Consolidate this duplicate domain contract.",
      minProperties: 2,
      schemas: {
        libraries: ["zod", "valibot", "arktype"],
        matchTypes: true
      },
      drizzle: {
        models: ["select", "insert"],
        matchTypes: true
      }
    }]
  }
});
```

The equivalent standalone `.oxlintrc.json` configuration is:

```json
{
  "jsPlugins": ["ai-deslop"],
  "rules": {
    "deslop/no-duplicate-types": ["warn", {
      "message": "Consolidate this duplicate domain contract.",
      "minProperties": 2,
      "schemas": {
        "libraries": ["zod", "valibot", "arktype"],
        "matchTypes": true
      },
      "drizzle": {
        "models": ["select", "insert"],
        "matchTypes": true
      }
    }]
  }
}
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `message` | `This type is structurally identical to an existing declaration.` | Text shown before the location of the first matching declaration. |
| `minProperties` | `2` | Ignore declarations with fewer members. Set this to `0` to include empty declarations. |
| `schemas` | unset | Enables inference from configured runtime schema libraries. |
| `schemas.libraries` | required | Schema-library adapters to use: `zod`, `valibot`, and `arktype`. |
| `schemas.matchTypes` | `true` | Compare inferred schemas with interfaces and object type aliases. Set to `false` to compare schemas only. |
| `drizzle` | unset | Enables inference from configured Drizzle table models. |
| `drizzle.models` | `select`, `insert` | Models to infer from each supported table. |
| `drizzle.matchTypes` | `true` | Compare inferred Drizzle models with schemas and TypeScript declarations. Set to `false` to compare each Drizzle model kind only. |

Both options are optional. To use only the defaults:

```json
{
  "deslop/no-duplicate-types": "warn"
}
```

## Comparison Behavior

The rule compares exact structural fingerprints rather than TypeScript assignability. It normalizes:

- Property order.
- `interface` declarations and object type aliases.
- Nested object types.
- Union and intersection member order.
- Declared generic parameter names.

Property names, optional and `readonly` modifiers, referenced type names, and supported literal values remain significant. A report points to the later declaration and identifies the first matching declaration and file.

The rule supports property-only interfaces without `extends` and type aliases whose top-level type is an object literal. Unsupported members and type syntax are skipped instead of approximated. In particular, it does not compare top-level intersections, utility-type aliases, or call signatures.

## Runtime Schemas

Schema inference is opt-in. It converts supported schema expressions into the same structural fingerprint used for TypeScript declarations, so an object schema can match an interface, object type alias, or another schema. For example, this configuration reports `Account` as a duplicate of `UserSchema`:

```ts
import { z } from "zod";

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().optional(),
});

interface Account {
  email?: string;
  id: string;
}
```

The Zod adapter recognizes named or namespace imports from `zod`, top-level `z.object(...)` schemas, nested objects, primitives, literals, string enums, arrays, unions, and `optional`, `nullable`, and `nullish`. It intentionally ignores validation-only modifiers such as `min`, `email`, `regex`, and `default`, because the rule compares inferred TypeScript shape rather than validator behavior.

The Valibot adapter recognizes named and namespace imports, static `object(...)` schemas, primitives, literals, `picklist`, arrays, unions, and `optional`, `nullable`, and `nullish`. It skips defaults, fallbacks, pipes, transforms, enum variables, object-rest schemas, and other APIs that can change output shape or need value resolution.

The ArkType adapter recognizes `type({ ... })` with static inline object definitions. It supports nested objects, primitive keywords, literals, unions, arrays, and keys suffixed with `?`. References, morphs, defaults, index signatures, undeclared-key behavior, fluent calls, and complex ArkType grammar are skipped.

## Drizzle Models

Drizzle tables are not Standard Schema validators, but their declarations infer TypeScript models that are useful to compare with runtime schemas and explicit contracts. Configure `drizzle` to infer `select`, `insert`, or both models from `pgTable`, `mysqlTable`, and `sqliteTable` declarations.

The initial adapter supports direct imported `text`, `varchar`, `uuid`, `char`, `integer`, `int`, `serial`, `smallint`, and `boolean` columns. It accounts for `notNull`, primary keys, and supported default methods when determining nullability and insert optionality. Custom types, generated or identity columns, `$type`, dialect-specific modes, and unsupported builder chains are skipped rather than guessed.

Dynamic schema construction, transforms, preprocessors, lazy schemas, referenced schema variables, records, tuples, intersections, discriminated unions, custom validators, and unrecognized library APIs are skipped. Standard Schema itself does not provide a portable structural schema AST, so additional Standard Schema-compatible validators require their own source adapter before they can be enabled in `schemas.libraries`.

The rule has no fixer and does not use fuzzy matching, embeddings, or an LLM.

## Worker Scope

Duplicates are detected among files processed by the same Oxlint JS-plugin worker. Oxlint's current JS plugin API does not provide deterministic global aggregation across parallel workers, so a duplicate processed by another worker may not be reported.
