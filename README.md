# ai-deslop

Opinionated Oxlint rules that reject low-evidence, low-signal, AI-slop code patterns.

Combines vendored anti-slop rules with additional rules under the `deslop/*` namespace. See Credits for attribution.

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

## Rules

All rules below are enabled by the recommended config unless listed as opt-in.

### Type safety and evidence

| Rule | Description |
| --- | --- |
| `no-chained-type-assertions` | Rejects nested `as` / angle-bracket assertions that fabricate evidence. |
| `no-conditional-empty-object-spread` | Reports object spreads using a conditional `{}` branch to omit fields. |
| `no-known-value-widening` | Rejects known expressions flowing into explicit `unknown`, `object`, or open dictionaries. |
| `no-object-parameters` | Rejects `object` on function inputs. |
| `no-runtime-typeof` | Requires boundary parsing instead of ad hoc `typeof` narrowing. |
| `no-unknown-parameters` | Rejects `unknown` on function inputs. |
| `no-unknown-returns` | Rejects return contracts resolving to `unknown`. |
| `no-unknown-type-aliases` | Rejects aliases whose resolved type is `unknown`. |
| `no-unsafe-dictionary-type` | Rejects dictionary values based on unsafe escape hatches. |
| `no-widen-then-assert` | Rejects widening known evidence before narrowing assertions. |
| `require-safety-comment-for-type-assertion` | Requires an invariant justification for non-const assertions. |
| `no-pass-through-type-alias` | Disallows aliases that only rename another type. |

### Code quality and APIs

| Rule | Description |
| --- | --- |
| `no-array-filter-map` | Rejects adjacent eager array filter/map passes; allows lazy iterator pipelines. |
| `no-reduce-accumulator-copy` | Rejects non-spread accumulator copies inside reducers. Enable native `oxc/no-accumulating-spread` alongside it. |
| `no-reflect-apply` | Rejects global `Reflect.apply`. |
| `no-reflect-get` | Rejects global `Reflect.get`. |
| `no-shape-in-symbol-names` | Rejects `shape` in locally owned symbol names. |

### Tests

| Rule | Description |
| --- | --- |
| `no-call-only-assertions` | Flags tests whose assertions only check mock calls. |
| `no-module-mocking` | Rejects Vitest and Jest module mocks. |
| `no-poor-substring-tests` | Rejects testing that a constant string contains substrings. |
| `no-repeated-expect-call` | Flags adjacent assertions that repeat the same call in test files. Reuse the result instead. No fixer. |

### Opt-in rules

| Rule | Description |
| --- | --- |
| [`no-duplicate-consts`](docs/no-duplicate-consts.md) | Reports all-caps constants with the same static value in different files. |
| [`no-duplicate-types`](docs/no-duplicate-types.md) | Reports exact duplicate object contracts. No fixer. |
| [`no-renamed-imports`](docs/no-renamed-imports.md) | Fixes unnecessary named-import aliases when the original name has no module-level conflict. |
| [`no-reexports-outside-entrypoints`](docs/no-reexports-outside-entrypoints.md) | Keeps re-exports in configured entrypoint files. No fixer. |
| [`canonical-class-names`](docs/tailwind.md) | Fixes non-canonical Tailwind CSS v4 class spellings. |

### Standard rules enabled by the recommended config

| Standard rule | Description |
| --- | --- |
| `typescript/no-deprecated` | Disallows using code marked `@deprecated`. Requires type-aware linting. |
| `typescript/no-require-imports` | Disallows CommonJS `require()` imports. |
| `typescript/no-floating-promises` | Disallows floating promises. Requires type-aware linting. |
| `typescript/no-unnecessary-condition` | Disallows always truthy/falsy/nullish conditions. Requires type-aware linting. |
| `no-unreachable` | Disallows unreachable code. |

## Credits

- Generic rules vendored verbatim from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) (MIT, © Dillon Mulroy), including `src/shared/*`.

## License

MIT
