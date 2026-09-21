# ai-deslop

Opinionated Oxlint rules that reject low-evidence, low-signal, AI-slop code patterns.

Rules are vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) (generic rules) alongside additional deslop rules, all renamed under the `deslop/*` namespace. The vendored source is MIT licensed; see Credits below.

## Install

```bash
npm install --save-dev ai-deslop
# @oxlint/plugins comes along as a runtime dependency — keep it in sync with your oxlint version
```

Ships compiled JavaScript — works with any oxlint JS-plugin runtime (Bun, Deno, or Node.js).

## Usage

```ts
import { defineConfig } from "oxlint";
import { configs as deslopConfigs } from "ai-deslop";

export default defineConfig({
  jsPlugins: ["ai-deslop"],
  options: deslopConfigs.recommended.options,
  rules: deslopConfigs.recommended.rules
});
```

The recommended config enables type-aware linting for `typescript/no-deprecated` and `typescript/no-floating-promises`. Install `oxlint-tsgolint` when using it.

## Rules

| Rule | Status | Description |
| --- | --- | --- |
| `no-array-filter-map` | Recommended | Rejects adjacent eager array filter/map passes; allows lazy iterator pipelines. |
| `no-reduce-accumulator-copy` | Recommended | Rejects non-spread accumulator copies inside reducers. Enable native `oxc/no-accumulating-spread` alongside it. |
| `no-chained-type-assertions` | Recommended | Rejects nested `as` / angle-bracket assertions that fabricate evidence. |
| `no-conditional-empty-object-spread` | Recommended | Reports object spreads using a conditional `{}` branch to omit fields. |
| `no-known-value-widening` | Recommended | Rejects known expressions flowing into explicit `unknown`, `object`, or open dictionaries. |
| `no-module-mocking` | Recommended | Rejects Vitest and Jest module mocks. |
| `no-object-parameters` | Recommended | Rejects `object` on function inputs. |
| `no-reflect-apply` | Recommended | Rejects global `Reflect.apply`. |
| `no-reflect-get` | Recommended | Rejects global `Reflect.get`. |
| `no-runtime-typeof` | Recommended | Requires boundary parsing instead of ad hoc `typeof` narrowing. |
| `no-shape-in-symbol-names` | Recommended | Rejects `shape` in locally owned symbol names. |
| `no-unknown-parameters` | Recommended | Rejects `unknown` on function inputs. |
| `no-unknown-returns` | Recommended | Rejects return contracts resolving to `unknown`. |
| `no-unknown-type-aliases` | Recommended | Rejects aliases whose resolved type is `unknown`. |
| `no-unsafe-dictionary-type` | Recommended | Rejects dictionary values based on unsafe escape hatches. |
| `no-widen-then-assert` | Recommended | Rejects widening known evidence before narrowing assertions. |
| `require-safety-comment-for-type-assertion` | Recommended | Requires an invariant justification for non-const assertions. |
| `no-call-only-assertions` | Recommended | Flags tests whose assertions only check mock calls. |
| `no-poor-substring-tests` | Recommended | Rejects testing that a constant string contains substrings. |
| `no-pass-through-type-alias` | Recommended | Disallows aliases that only rename another type. |
| [`no-duplicate-consts`](docs/no-duplicate-consts.md) | Opt-in | Reports all-caps constants with the same static value in different files. |
| [`no-duplicate-types`](docs/no-duplicate-types.md) | Opt-in | Reports exact duplicate object contracts. No fixer. |
| [`canonical-class-names`](docs/tailwind.md) | Opt-in | Fixes non-canonical Tailwind CSS v4 class spellings. |

| Standard rule | Status | Description |
| --- | --- | --- |
| `typescript/no-deprecated` | Recommended | Disallows using code marked `@deprecated`. Requires type-aware linting. |
| `typescript/no-floating-promises` | Recommended | Disallows floating promises. Requires type-aware linting. |

## Guides

| Guide | Contents |
| --- | --- |
| [No duplicate consts](docs/no-duplicate-consts.md) | Configuration and exact static-value comparison behavior. |
| [No duplicate types](docs/no-duplicate-types.md) | Exact comparison behavior, worker scope, complete TypeScript/JSON examples, and every supported option. |
| [Tailwind canonical class names](docs/tailwind.md) | Tailwind v4 setup, complete TypeScript/JSON examples, and every supported option. |

## Credits

- Generic rules vendored verbatim from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) (MIT, © Dillon Mulroy), including `src/shared/*`.

## License

MIT
