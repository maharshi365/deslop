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
      minProperties: 2
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
      "minProperties": 2
    }]
  }
}
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `message` | `This type is structurally identical to an existing declaration.` | Text shown before the location of the first matching declaration. |
| `minProperties` | `2` | Ignore declarations with fewer members. Set this to `0` to include empty declarations. |

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

The rule supports property-only interfaces without `extends` and type aliases whose top-level type is an object literal. Unsupported members and type syntax are skipped instead of approximated. In particular, it does not compare top-level intersections, utility-type aliases, call signatures, runtime schemas such as Zod, or inferred types that do not have an explicit declaration.

The rule has no fixer and does not use fuzzy matching, embeddings, or an LLM.

## Worker Scope

Duplicates are detected among files processed by the same Oxlint JS-plugin worker. Oxlint's current JS plugin API does not provide deterministic global aggregation across parallel workers, so a duplicate processed by another worker may not be reported.
