# ai-deslop

Opinionated Oxlint rules that reject low-evidence, low-signal, AI-slop code patterns.

Rules are vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) (generic rules) alongside additional deslop rules, all renamed under the `deslop/*` namespace. The vendored source is MIT licensed; see Credits below.

## Install

```bash
npm install --save-dev ai-deslop
# @oxlint/plugins comes along as a runtime dependency — keep it in sync with your oxlint version
```

Ships compiled JavaScript — works with any oxlint JS-plugin runtime (Bun, Deno, or Node.js).

## Rules

| Rule | Status | Description |
| --- | --- | --- |
| [`no-array-filter-map`](docs/deslop.md) | Recommended | Rejects adjacent eager array filter/map passes; allows lazy iterator pipelines. |
| [`no-reduce-accumulator-copy`](docs/deslop.md) | Recommended | Rejects non-spread accumulator copies inside reducers. Enable native `oxc/no-accumulating-spread` alongside it. |
| [`no-chained-type-assertions`](docs/deslop.md) | Recommended | Rejects nested `as` / angle-bracket assertions that fabricate evidence. |
| [`no-conditional-empty-object-spread`](docs/deslop.md) | Recommended | Reports object spreads using a conditional `{}` branch to omit fields. |
| [`no-known-value-widening`](docs/deslop.md) | Recommended | Rejects known expressions flowing into explicit `unknown`, `object`, or open dictionaries. |
| [`no-module-mocking`](docs/deslop.md) | Recommended | Rejects Vitest and Jest module mocks. |
| [`no-object-parameters`](docs/deslop.md) | Recommended | Rejects `object` on function inputs. |
| [`no-reflect-apply`](docs/deslop.md) | Recommended | Rejects global `Reflect.apply`. |
| [`no-reflect-get`](docs/deslop.md) | Recommended | Rejects global `Reflect.get`. |
| [`no-runtime-typeof`](docs/deslop.md) | Recommended | Requires boundary parsing instead of ad hoc `typeof` narrowing. |
| [`no-shape-in-symbol-names`](docs/deslop.md) | Recommended | Rejects `shape` in locally owned symbol names. |
| [`no-unknown-parameters`](docs/deslop.md) | Recommended | Rejects `unknown` on function inputs. |
| [`no-unknown-returns`](docs/deslop.md) | Recommended | Rejects return contracts resolving to `unknown`. |
| [`no-unknown-type-aliases`](docs/deslop.md) | Recommended | Rejects aliases whose resolved type is `unknown`. |
| [`no-unsafe-dictionary-type`](docs/deslop.md) | Recommended | Rejects dictionary values based on unsafe escape hatches. |
| [`no-widen-then-assert`](docs/deslop.md) | Recommended | Rejects widening known evidence before narrowing assertions. |
| [`require-safety-comment-for-type-assertion`](docs/deslop.md) | Recommended | Requires an invariant justification for non-const assertions. |
| [`no-call-only-assertions`](docs/deslop.md) | Recommended | Flags tests whose assertions only check mock calls. |
| [`no-pass-through-type-alias`](docs/deslop.md) | Recommended | Disallows aliases that only rename another type. |
| [`no-duplicate-types`](docs/deslop.md#no-duplicate-types) | Opt-in | Reports exact duplicate object contracts. No fixer. |
| [`canonical-class-names`](docs/tailwind.md) | Opt-in | Fixes non-canonical Tailwind CSS v4 class spellings. |

| Standard rule | Status | Description |
| --- | --- | --- |
| `typescript/no-deprecated` | Recommended | Disallows using code marked `@deprecated`. Requires type-aware linting. |
| `typescript/no-floating-promises` | Recommended | Disallows floating promises. Requires type-aware linting. |

## Guides

| Guide | Contents |
| --- | --- |
| [Deslop rules](docs/deslop.md) | Recommended and opt-in deslop configuration, complete TypeScript/JSON examples, and `no-duplicate-types` options. |
| [Tailwind canonical class names](docs/tailwind.md) | Tailwind v4 setup, complete TypeScript/JSON examples, and every supported option. |

## Credits

- Generic rules vendored verbatim from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) (MIT, © Dillon Mulroy), including `src/shared/*`.

## License

MIT
