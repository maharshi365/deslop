# Deslop Rules

`ai-deslop` registers the `deslop/*` Oxlint plugin. The exported `recommended` config enables the standard deslop rules and Oxlint's selected type-aware rules. `no-duplicate-types` is intentionally opt-in.

## Full Config

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

The recommended config enables `options.typeAware` for `typescript/no-deprecated` and `typescript/no-floating-promises`. Install `oxlint-tsgolint` when using it.

The equivalent `.oxlintrc.json` lists each enabled rule explicitly:

```json
{
  "jsPlugins": ["ai-deslop"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "deslop/no-array-filter-map": "error",
    "deslop/no-reduce-accumulator-copy": "error",
    "deslop/no-chained-type-assertions": "error",
    "deslop/no-conditional-empty-object-spread": "error",
    "deslop/no-known-value-widening": "error",
    "deslop/no-module-mocking": "error",
    "deslop/no-object-parameters": "error",
    "deslop/no-reflect-apply": "error",
    "deslop/no-reflect-get": "error",
    "deslop/no-runtime-typeof": "error",
    "deslop/no-shape-in-symbol-names": "error",
    "deslop/no-unknown-parameters": "error",
    "deslop/no-unknown-returns": "error",
    "deslop/no-unknown-type-aliases": "error",
    "deslop/no-unsafe-dictionary-type": "error",
    "deslop/no-widen-then-assert": "error",
    "deslop/require-safety-comment-for-type-assertion": "error",
    "deslop/no-call-only-assertions": "error",
    "deslop/no-pass-through-type-alias": "error",
    "deslop/no-duplicate-types": ["warn", {
      "message": "Consolidate this duplicate domain contract.",
      "minProperties": 2
    }],
    "typescript/no-deprecated": "error",
    "typescript/no-floating-promises": "error"
  }
}
```

## No Duplicate Types

`deslop/no-duplicate-types` reports exact duplicate object contracts. It is opt-in because duplicate contracts can be intentional at package or external-API boundaries.

```ts
"deslop/no-duplicate-types": ["warn", {
  message: "Consolidate this duplicate domain contract.",
  minProperties: 2
}]
```

| Option | Default | Description |
| --- | --- | --- |
| `message` | Built-in diagnostic text | Optional text prepended to every report. |
| `minProperties` | `2` | Ignore object contracts with fewer properties. |

The rule canonicalizes property order, `interface` versus object aliases, nested object types, union order, and declared generic parameter names. It has no fixer and never uses assignability, fuzzy matching, embeddings, or an LLM. Unsupported syntax is skipped instead of approximated. It does not traverse runtime schemas such as Zod; compare explicit inferred TypeScript declarations instead.

Duplicates are detected among files processed by the same Oxlint JS-plugin worker. Oxlint's current JS plugin API does not offer deterministic global aggregation across parallel workers.
