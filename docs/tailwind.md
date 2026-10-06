# Tailwind Canonical Class Names

`deslop/canonical-class-names` rewrites non-canonical Tailwind CSS v4 class spellings, such as `mt-[16px]` to `mt-4`. It is opt-in because it requires a Tailwind CSS entry file.

Install Tailwind CSS v4 alongside this plugin:

```bash
npm install --save-dev tailwindcss
```

## Configuration

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
    "deslop/canonical-class-names": ["warn", {
      cssPath: "./src/styles.css",
      rootFontSize: 16,
      attributes: ["class", "className"],
      calleeFunctions: ["cn", "clsx", "cva", "twMerge", "tw", "classNames", "cx"]
    }]
  }
});
```

The equivalent standalone `.oxlintrc.json` configuration is:

```json
{
  "jsPlugins": ["ai-deslop"],
  "rules": {
    "deslop/canonical-class-names": ["warn", {
      "cssPath": "./src/styles.css",
      "rootFontSize": 16,
      "attributes": ["class", "className"],
      "calleeFunctions": ["cn", "clsx", "cva", "twMerge", "tw", "classNames", "cx"]
    }]
  }
}
```

| Option | Default | Description |
| --- | --- | --- |
| `cssPath` | Required | Absolute path or path relative to the working directory for the Tailwind v4 CSS entry file. |
| `rootFontSize` | `16` | Root font size in pixels used to normalize `rem` values. |
| `attributes` | `["class", "className"]` | JSX attributes that contain class lists. This array replaces the defaults. |
| `calleeFunctions` | `["cn", "clsx", "cva", "twMerge", "tw", "classNames", "cx"]` | Call expressions whose string arguments contain class lists. This array replaces the defaults. |

Only `cssPath` is required. A relative path is resolved from the directory where Oxlint runs; an absolute path is used unchanged. The CSS file must be a Tailwind CSS v4 entry file and may include your theme and source configuration.

## Checked Values

The rule checks static string values in configured JSX attributes and static string arguments passed to configured helper functions. Member calls are matched by their property name, so `styles.cx("mt-[16px]")` is checked when `cx` is configured.

```tsx
<div className="mt-[16px] text-[14px]" />
cn("px-[16px]", active && "font-bold")
```

It fixes individual class spellings only. It does not reorder or deduplicate classes. Template literals with interpolations and non-string helper arguments are skipped.

## Performance Benchmark

Run the root benchmark with:

```bash
npm run bench
npm run bench -- --save baseline.json
npm run bench -- --compare baseline.json
npm run bench -- --varied --save varied-baseline.json
npm run bench -- --varied --compare varied-baseline.json
```

The benchmark runs the real rule callbacks and Tailwind worker against 100,000 class strings across 1,000 simulated files. It includes canonical strings, arbitrary values that need fixes, and custom classes. The default case repeats four strings. `--varied` cycles through 512 combinations, with no repeated strings within a file. It checks the diagnostic count and reports the median of three fresh Node processes. It does not measure Oxlint parsing or total CLI startup time. Compare results from the same scenario.

`coldMs` includes worker startup, CSS loading, and the first class check. `warmMs` measures the remaining workload. `totalMs` includes both. Results depend on the machine and the amount of class reuse.

Canonical results are cached by CSS entry and root font size. Reloading the entry CSS clears them. Repeated string rewrites are cached within each file, but each occurrence still gets its own diagnostic and fix. Tailwind's initial canonicalization index can still be expensive; these caches do not remove that cold-start cost.

Local measurements on Windows with Node 22.21.1 and Tailwind 4.3.3:

| Scenario / change | Cold | Warm | Total | Total speedup |
| --- | ---: | ---: | ---: | ---: |
| Repeated: original | 1,663 ms | 3,128 ms | 4,791 ms | — |
| Repeated: token cache | 1,543 ms | 156 ms | 1,699 ms | 2.82× |
| Repeated: token + string caches | 1,558 ms | 47 ms | 1,605 ms | 2.98× |
| Varied: original | 1,581 ms | 2,897 ms | 4,459 ms | — |
| Varied: token + string caches | 1,585 ms | 199 ms | 1,783 ms | 2.50× |

Each column is a separate median, so cold and warm values may not sum to the total. These are synthetic rule workloads, not a guarantee of total-project lint speed.

## Custom Names

Providing `attributes` or `calleeFunctions` replaces that option's defaults. Include the defaults explicitly if you want to add names without losing built-in coverage:

```json
{
  "deslop/canonical-class-names": ["warn", {
    "cssPath": "./src/styles.css",
    "attributes": ["class", "className", "tw"],
    "calleeFunctions": ["cn", "clsx", "cva", "twMerge", "tw", "classNames", "cx", "variants"]
  }]
}
```
