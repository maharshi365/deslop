# No Duplicate Consts

`deslop/no-duplicate-consts` reports all-caps snake-case `const` declarations with the same name and static value in different files. It is opt-in because independently declared constants can be intentional at package boundaries.

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
    "deslop/no-duplicate-consts": "warn",
  },
});
```

The equivalent standalone `.oxlintrc.json` configuration is:

```json
{
  "jsPlugins": ["ai-deslop"],
  "rules": {
    "deslop/no-duplicate-consts": "warn"
  }
}
```

## Behavior

The rule compares static values for constants whose names match `^[A-Z][A-Z0-9_]*$`. It reports the later declaration and identifies the file containing the first matching constant.

```ts
// config/defaults.ts
export const DEFAULT_PORT = 3000;

// server/defaults.ts
export const DEFAULT_PORT = 3000;
// Reported: DEFAULT_PORT duplicates the constant in config/defaults.ts.
```

Literal values, static template literals, arrays, and objects composed of supported static values are compared. The rule skips dynamic expressions, spreads, computed object keys, and non-`const` declarations. Constants with different names are not duplicates, even if their values match.

Duplicates are detected among files processed by the same Oxlint JS-plugin worker. Oxlint's current JS plugin API does not provide deterministic global aggregation across parallel workers, so a duplicate processed by another worker may not be reported.
