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
