# Prefer Literal Union

`deslop/prefer-literal-union` reports a variable typed `string` when the code compares it to two or more distinct string literals. The recommended config enables it. It has no options and no autofix.

```ts
// Reported: the type says any string, but the code expects "edit" or "archive".
function title(dialog: string) {
  if (dialog === "edit") return "Edit";
  if (dialog === "archive") return "Archive";
  return "";
}

// Allowed.
type Dialog = "edit" | "archive";

function title(dialog: Dialog) { ... }
```

With a literal union, TypeScript catches typos and unreachable branches. The recommended config also enables `typescript/switch-exhaustiveness-check`, which then reports a `switch` that misses a case.

Before you create a new union or inline one, search the codebase for an existing type for the same values. The message says this too.

## Comparisons

The rule counts these comparisons for each variable:

- `===`, `!==`, `==`, and `!=`, with the literal on either side.
- `switch (x)` cases.
- String literals, and template literals without expressions.

All shapes count together: `if` chains, separate `if` statements, `&&` and `||`, ternaries, and `switch`. A repeated literal counts once. The message lists the literals in source order.

## Declarations

Oxlint JS plugins get no type information, so the rule reads only types written in the same file. It reports a variable only when its declared type is `string`, `string | null`, `string | undefined`, or `string | null | undefined`. It checks:

- Function parameters: `function f(x: string)`, `(x: string) => ...`.
- Destructured parameters and variables with an inline type, or a type alias or interface declared once in the same file: `({ x }: { x: string })`, `({ x }: Props)`.
- React state: `useState<string>()`, `React.useState<string | null>(null)`.
- Annotated variables: `let x: string`.

The rule does not report:

- Literal unions or other named types, such as `x: Mode`.
- Imported or inferred types.
- Variables compared to only one distinct literal.
- Member access, such as `props.dialog`.

## Free-input strings

Some values are real strings, such as parsed user text. Use a disable comment with a reason:

```ts
// oxlint-disable-next-line deslop/prefer-literal-union -- parsed user input
function parseDate(text: string) {
  if (text === "today") return today();
  if (text === "tomorrow") return tomorrow();
  return parseIso(text);
}
```
