# oxlint-plugin-deslop

Opinionated Oxlint rules that reject low-evidence, low-signal, AI-slop code patterns.

Rules are vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) (generic rules) and [UseStitch/stitch](https://github.com/UseStitch/stitch) (`tools/oxlint-plugins`), all renamed under the `deslop/*` namespace. Both sources are MIT licensed; see Credits below.

## Install

```bash
npm install oxlint-plugin-deslop
# @oxlint/plugins comes along as a runtime dependency — keep it in sync with your oxlint version
```

Requires a runtime with native TypeScript plugin support: Bun, Deno, or Node.js >= 22.18 / 20.19.

## Usage

Register the plugin in `oxlint.config.ts` and enable every rule as an error via the exported `recommended` config:

```ts
import { defineConfig } from "oxlint";
import deslopPlugin, { configs as deslopConfigs } from "oxlint-plugin-deslop";

export default defineConfig({
  jsPlugins: [deslopPlugin],
  rules: {
    ...deslopConfigs.recommended.rules,
  },
});
```

Or with `.oxlintrc.json` (list the rules explicitly):

```json
{
  "jsPlugins": ["oxlint-plugin-deslop"],
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
    "deslop/require-readable-spacing": "error",
    "deslop/require-safety-comment-for-type-assertion": "error",
    "deslop/no-call-only-assertions": "error",
    "deslop/no-pass-through-type-alias": "error"
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
| `require-readable-spacing` | Autofixes missing blank lines between declarations and around control flow. Run `oxlint --fix`, then your formatter, then lint again. |
| `require-safety-comment-for-type-assertion` | Requires a nearby invariant justification comment (default marker `SAFETY:`) for each non-const assertion. |
| `no-call-only-assertions` | Flags tests whose every assertion only checks a mock was called (`toHaveBeenCalledWith` stays allowed). |
| `no-pass-through-type-alias` | Disallows type aliases that only rename another type. |

The rules use Oxlint's ESTree and lexical-scope APIs rather than a TypeScript type checker. They resolve same-file aliases but do not infer imported type definitions or cross-file call signatures.

## Credits

- Generic rules vendored verbatim from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) (MIT, © Dillon Mulroy), including `src/shared/*` and the `src/vendor/eslint-stylistic/*` padding-line engine (MIT, see `src/vendor/eslint-stylistic/LICENSE` and `UPSTREAM.md`).
- `no-call-only-assertions` and `no-pass-through-type-alias` adapted from [UseStitch/stitch](https://github.com/UseStitch/stitch) `tools/oxlint-plugins` (MIT, © Stitch) and converted to TypeScript.

## License

MIT
