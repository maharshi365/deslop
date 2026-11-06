# Max Boolean Conditions

`deslop/max-boolean-conditions` limits the number of top-level terms in control-flow conditions. It is opt-in and is not enabled by the recommended config.

It checks `if` (including `else if`), `while`, `do...while`, and the condition part of `for` loops. It does not check assignments, ternary conditions, loop initialization, or loop updates. There is no autofix: choosing a meaningful variable name requires context.

## Configuration

```ts
import { defineConfig } from "oxlint";
import { configs as deslopConfigs } from "ai-deslop";

export default defineConfig({
  jsPlugins: ["ai-deslop"],
  options: deslopConfigs.recommended.options,
  rules: {
    ...deslopConfigs.recommended.rules,
    "deslop/max-boolean-conditions": ["error", {
      maxConditions: 3,
      message: "Prefer a named variable that describes what these conditions mean."
    }]
  }
});
```

| Option | Default | Description |
| --- | --- | --- |
| `maxConditions` | `3` | Maximum top-level terms. Must be an integer of at least 1. |
| `message` | Built-in message | Custom error text, used as written. The built-in message includes the actual count and limit. |

Enabling the rule with `"error"` alone uses the defaults.

## Counting terms

Ungrouped `&&` and `||` chains are counted together, including mixed operators. A parenthesized group counts as one term; its contents are not checked separately. Parentheses around the entire condition do not change its count. Calls, comparisons, negations, and other expressions each count as one term. Nullish coalescing (`??`) is not expanded into Boolean terms.

With `maxConditions: 3`:

```ts
// Reported: four terms.
if (isActive && hasAccess && isVerified && !isBlocked) {}
while (isActive || hasAccess && isVerified || isAdmin) {}
for (let i = 0; i < limit && isActive && hasAccess && !isBlocked; i++) {}

// Allowed: three terms. The nested group counts as one.
if (isActive && hasAccess && (isVerified || isAdmin)) {}

// Allowed: two terms. The nested group is not checked separately.
if ((a && b && c && d) || isAdmin) {}
```

Move a long condition to a variable with a meaningful name:

```ts
const canAccessAccount =
  isActive && hasAccess && isVerified && !isBlocked;

if (canAccessAccount) {}
```
