# No Renamed Imports

`deslop/no-renamed-imports` reports named import aliases when the imported name is not otherwise bound in the module. It is opt-in because aliases can be useful when matching a local naming convention.

The rule autofixes the import and every reference to its local binding.

```ts
// Before
import type { SandboxConfiguration as SandboxConfig } from "@stitch/schemas/sandboxes";
const config: SandboxConfig = {};

// After
import type { SandboxConfiguration } from "@stitch/schemas/sandboxes";
const config: SandboxConfiguration = {};
```

Aliases are preserved where using the imported name would conflict with an existing module binding:

```ts
import { Dialog as DialogPrimitive } from "radix-ui";
export function Dialog() {}
```

## Configuration

```ts
import { defineConfig } from "oxlint";
import { configs as deslopConfigs } from "ai-deslop";

export default defineConfig({
  jsPlugins: ["ai-deslop"],
  options: deslopConfigs.recommended.options,
  rules: {
    ...deslopConfigs.recommended.rules,
    "deslop/no-renamed-imports": "warn"
  }
});
```
