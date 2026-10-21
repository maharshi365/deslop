# no-pass-through-schema

Reports `const` aliases that only rename a known schema. This rule is opt-in and has no autofix. Replacing a name can affect exports and consumers.

```ts
import { z } from "zod";

const Person = z.object({ name: z.string() });
const User = Person; // Report: use Person directly.

const Admin = Person.extend({ role: z.literal("admin") }); // Allowed.
const OptionalPerson = Person.optional(); // Allowed.
type PersonData = z.infer<typeof Person>; // Allowed.
```

This is not a ban on Zod's `.passthrough()` unknown-key policy.

## Configuration

```json
{
  "deslop/no-pass-through-schema": ["error", {
    "libraries": ["zod", "arktype"],
    "allowExportedAliases": false,
    "schemaImports": [
      { "from": "@app/contracts", "names": ["UserSchema", "AccountSchema"] }
    ]
  }]
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `libraries` | `["zod", "arktype"]` | Enable built-in library recognition. Use `[]` for configured imports only. |
| `allowExportedAliases` | `false` | Allow aliases exported as values, including separate named exports and default exports. Type-only exports do not count. |
| `schemaImports` | `[]` | Identify schema values imported from exact module paths. `names` uses the original export names, not local aliases. Use `"default"` for a default import. These entries supplement built-in recognition. |

## Recognition and limits

- Resolves lexical bindings, including renamed imports and local alias chains. A shadowed name does not inherit schema status.
- Recognizes Zod constructors from `zod`, `zod/v3`, `zod/v4`, `zod/v4/classic`, `zod/v4/mini`, and `zod/mini`. Supports named, namespace, and default imports.
- Recognizes ArkType's `type(...)` through named and namespace imports.
- Tracks known schema-returning method chains, such as Zod `.optional()` and ArkType `.array()`. Calls that change a schema are not themselves reported; direct aliases of their results are.
- Does not treat parsing results, validation results, or unknown calls as schemas.
- Does not infer schemas from names, execute code, inspect other files, or follow mutable bindings and destructuring.
- Does not report import renames, re-exports, or property aliases. Other rules cover import and export policy.

Standard Schema defines a common validation interface, not a source-code constructor API. This rule uses conservative syntax recognition, not type-aware structural checks. For Valibot or another library, configure imports of existing schema values with `schemaImports`. Constructors from those libraries are not yet recognized.

Unknown expressions stay unreported. Extend the built-in recognition sets when more schema-producing APIs are needed, rather than assuming every library call returns a schema.
