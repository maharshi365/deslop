# Tailwind Canonical Class Names

`deslop/canonical-class-names` rewrites non-canonical Tailwind CSS v4 class spellings, such as `mt-[16px]` to `mt-4`. It is opt-in because it requires a Tailwind CSS entry file.

Install Tailwind CSS v4 alongside this plugin:

```bash
npm install --save-dev tailwindcss
```

## Full Config

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

The standalone `.oxlintrc.json` configuration for this rule is:

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
| `attributes` | `class`, `className` | JSX attributes that contain class lists. |
| `calleeFunctions` | `cn`, `clsx`, `cva`, `twMerge`, `tw`, `classNames`, `cx` | Call expressions whose string arguments contain class lists. |

The rule fixes individual class spellings only. It does not reorder or deduplicate classes. Strings with template interpolations are skipped.
