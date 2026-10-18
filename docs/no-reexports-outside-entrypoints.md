# No Re-exports Outside Entrypoints

`deslop/no-reexports-outside-entrypoints` keeps re-exports in configured entrypoint files. It is opt-in and is not enabled by the recommended config.

Import symbols directly from their source for internal use. To expose a symbol to external consumers, re-export it from a package entrypoint.

## Configuration

```ts
import { defineConfig } from "oxlint";
import { configs as deslopConfigs } from "ai-deslop";

export default defineConfig({
  jsPlugins: ["ai-deslop"],
  options: deslopConfigs.recommended.options,
  rules: {
    ...deslopConfigs.recommended.rules,
    "deslop/no-reexports-outside-entrypoints": ["error", {
      entrypoints: ["**/index.ts"]
    }]
  }
});
```

Standalone `.oxlintrc.json`:

```json
{
  "jsPlugins": ["ai-deslop"],
  "rules": {
    "deslop/no-reexports-outside-entrypoints": "error"
  }
}
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `entrypoints` | `["**/index.ts"]` | File globs where re-exports are allowed, relative to the lint working directory (normally the project root). An explicit list replaces the default. An empty list forbids re-exports everywhere. |

Globs use Node's `path.matchesGlob` syntax. Use `/` as the path separator, including on Windows. There is no automatic package.json entrypoint discovery.

**The default allows every `index.ts`, including nested barrels.** To restrict re-exports to actual package entrypoints, list those paths explicitly:

```json
{
  "deslop/no-reexports-outside-entrypoints": ["error", {
    "entrypoints": [
      "packages/ui/src/index.ts",
      "packages/ui/src/client.ts",
      "packages/ui/src/server.ts"
    ]
  }]
}
```

Other filenames, such as `index.tsx`, `index.js`, and `index.mts`, are not allowed unless configured.

## Rejected outside entrypoints

Direct re-exports, including type exports, namespace exports, and default forwarding:

```ts
export { Foo } from "./foo";
export type { Options } from "./types";
export * from "./foo";
export type * from "./types";
export * as tools from "./tools";
export { default } from "./foo";
```

Imported bindings exported later, including types and import/export aliases:

```ts
import { Foo as InternalFoo } from "./foo";
export { InternalFoo as Foo };
export default InternalFoo;

import type { Options } from "./types";
export type { Options };
```

The source extension does not change the behavior. `.sh` forwarding is rejected like any other re-export:

```ts
export { default as script } from "./task.sh";

import script from "./task.sh";
export default script;
```

This rule checks JavaScript/TypeScript module syntax, not the contents of shell scripts.

## Allowed outside entrypoints

Locally defined functions, components, classes, and types can be exported directly or later:

```tsx
export function run() {}
export const Button = () => <button />;
export type Options = { verbose: boolean };

function stop() {}
export { stop };
export default stop;
```

Imports used by local implementations are allowed. The rule checks imported bindings, not value flow through local variable initializers, wrappers, or new type declarations.

## Autofix

No autofix. Removing or moving exports can break consumers.
