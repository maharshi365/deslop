# ai-deslop

Opinionated Oxlint rules that reject low-evidence, low-signal, AI-slop code patterns.

Rules are vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) (generic rules) alongside additional deslop rules, all renamed under the `deslop/*` namespace. The vendored source is MIT licensed; see Credits below.

## Install

```bash
npm install --save-dev ai-deslop
# @oxlint/plugins comes along as a runtime dependency — keep it in sync with your oxlint version
```

Requires a runtime with native TypeScript plugin support: Bun, Deno, or Node.js >= 22.18 / 20.19.

## Usage

Register the plugin in `oxlint.config.ts` and enable every rule as an error via the exported `recommended` config:

```ts
import { defineConfig } from "oxlint";
import deslopPlugin, { configs as deslopConfigs } from "ai-deslop";

export default defineConfig({
  jsPlugins: [deslopPlugin],
  options: {
    ...deslopConfigs.recommended.options,
  },
  rules: {
    ...deslopConfigs.recommended.rules,
  },
});
```

The `recommended` config also enables standard type-aware rules (`typescript/no-deprecated`, `typescript/no-floating-promises`), so it sets `options.typeAware`. Type-aware linting requires the `oxlint-tsgolint` package to be installed.

Or with `.oxlintrc.json` (list the rules explicitly):

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
    "typescript/no-deprecated": "error",
    "typescript/no-floating-promises": "error"
  }
}
```

## Rules

### Generic (`deslop/*`)

| Rule | Description |
| --- | --- |
| `no-array-filter-map` | Rejects adjacent eager array filter/map passes; allows lazy iterator pipelines. |
| `no-reduce-accumulator-copy` | Rejects non-spread accumulator copies inside reducers. Enable native `oxc/no-accumulating-spread` alongside it. |
| `no-chained-type-assertions` | Rejects nested `as` / angle-bracket assertions that fabricate evidence (`as const` chains stay valid). |
| `no-conditional-empty-object-spread` | Reports object spreads using a conditional `{}` branch to omit fields. |
| `no-known-value-widening` | Rejects known expressions flowing into explicit `unknown` / `object` / open-dictionary targets. |
| `no-module-mocking` | Rejects Vitest and Jest `mock` / `doMock` / `unstable_mockModule` calls. |
| `no-object-parameters` | Rejects `object` (and aliases resolving to it) on function inputs. |
| `no-reflect-apply` | Rejects global `Reflect.apply` in favor of typed function calls. |
| `no-reflect-get` | Rejects global `Reflect.get` in favor of typed property access or boundary parsing. |
| `no-runtime-typeof` | Requires boundary parsing instead of ad hoc `typeof` narrowing (`typeof x === "undefined"` probes stay allowed). |
| `no-shape-in-symbol-names` | Rejects the case-insensitive substring `shape` in locally owned symbol names. |
| `no-unknown-parameters` | Rejects `unknown` on function inputs (except the `cause` convention and type-predicate subjects). |
| `no-unknown-returns` | Rejects function contracts resolving to `unknown` / `Promise<unknown>`. |
| `no-unknown-type-aliases` | Rejects aliases whose resolved type is `unknown`. |
| `no-unsafe-dictionary-type` | Rejects dictionary value contracts based on `unknown`, `any`, `object`, `{}`. |
| `no-widen-then-assert` | Rejects flows that widen known evidence then assert it back to a narrower type. |
| `require-safety-comment-for-type-assertion` | Requires a nearby invariant justification comment (default marker `SAFETY:`) for each non-const assertion. |
| `no-call-only-assertions` | Flags tests whose every assertion only checks a mock was called (`toHaveBeenCalledWith` stays allowed). |
| `no-pass-through-type-alias` | Disallows type aliases that only rename another type. |

The rules use Oxlint's ESTree and lexical-scope APIs rather than a TypeScript type checker. They resolve same-file aliases but do not infer imported type definitions or cross-file call signatures.

### Standard (`typescript/*`, in `recommended`)

| Rule | Description |
| --- | --- |
| `typescript/no-deprecated` | Disallows using code marked `@deprecated`. Requires type-aware linting. |
| `typescript/no-floating-promises` | Disallows floating Promises without handling. Requires type-aware linting. |

### Opt-in (`deslop/canonical-class-names`, default off)

Enforces canonical Tailwind CSS class spellings with `--fix` support (`mt-[16px]` → `mt-4`). Same source of truth as the Tailwind language server. Excluded from `recommended` because it requires a `cssPath` option — add it manually:

```ts
export default defineConfig({
  jsPlugins: [deslopPlugin],
  options: {
    ...deslopConfigs.recommended.options,
  },
  rules: {
    ...deslopConfigs.recommended.rules,
    "deslop/canonical-class-names": ["warn", { cssPath: "./src/styles.css" }],
  },
});
```

Requires Tailwind CSS v4 (`tailwindcss` is an optional peer). Options: `cssPath` (required, absolute or relative to cwd), `rootFontSize` (default `16`), `attributes` (default `["class", "className"]`), `calleeFunctions` (default `["cn", "clsx", "cva", "twMerge", "tw", "classNames", "cx"]`). Only rewrites individual spellings — ordering/dedup belongs to the formatter. Strings with `${}` interpolations are skipped.

## Credits

- Generic rules vendored verbatim from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) (MIT, © Dillon Mulroy), including `src/shared/*`.

## License

MIT
