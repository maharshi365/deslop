import type { Context, ESTree } from "@oxlint/plugins";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ canonicalize: vi.fn(), ensure: vi.fn(), version: vi.fn() }));
vi.mock("../src/tailwind/design-system.ts", () => ({
	resolveCssPath: (value: string) => value,
	ensureDesignSystem: mocks.ensure,
	canonicalizeTokens: mocks.canonicalize,
	getDesignSystemVersion: mocks.version,
}));
import { canonicalClassNames } from "../src/tailwind/rule.ts";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.ensure.mockReturnValue("/styles.css");
	mocks.version.mockReturnValue(1);
	mocks.canonicalize.mockReturnValue(new Map([["mt-[16px]", "mt-4"], ["flex", "flex"]]));
});

it("reuses repeated strings but reports and fixes each occurrence", () => {
	const report = vi.fn();
	const context = { options: [{ cssPath: "/styles.css" }], sourceCode: { text: "className", getText: () => '"mt-[16px] flex"' }, report };
	if (!("createOnce" in canonicalClassNames)) throw new Error("Expected a createOnce rule");
	const visitor = canonicalClassNames.createOnce(context as unknown as Context);
	const node = () => ({ type: "JSXAttribute", name: { type: "JSXIdentifier", name: "className" }, value: { type: "Literal", value: "mt-[16px] flex" } }) as ESTree.JSXAttribute;
	const first = node();
	const second = node();
	visitor.before?.();
	visitor.JSXAttribute?.(first);
	visitor.JSXAttribute?.(second);
	expect(mocks.canonicalize).toHaveBeenCalledTimes(1);
	expect(report.mock.calls.map(([data]) => data.node)).toEqual([first.value, second.value]);
	for (const [data] of report.mock.calls) {
		expect(data.messageId).toBe("nonCanonical");
		expect(data.fix({ replaceText: (node: unknown, text: string) => text })).toBe('"mt-4 flex"');
	}
});

it("does not reuse string rewrites after CSS changes between files", () => {
	const report = vi.fn();
	const context = { options: [{ cssPath: "/styles.css" }], sourceCode: { text: "className" }, report };
	if (!("createOnce" in canonicalClassNames)) throw new Error("Expected a createOnce rule");
	const visitor = canonicalClassNames.createOnce(context as unknown as Context);
	const node = { type: "JSXAttribute", name: { type: "JSXIdentifier", name: "className" }, value: { type: "Literal", value: "mt-[16px] flex" } } as ESTree.JSXAttribute;
	visitor.before?.();
	visitor.JSXAttribute?.(node);
	mocks.canonicalize.mockReturnValue(new Map([["mt-[16px]", "mt-custom"], ["flex", "flex"]]));
	mocks.version.mockReturnValue(2);
	visitor.before?.();
	visitor.JSXAttribute?.(node);
	expect(report.mock.calls.map(([data]) => data.data.canonical)).toEqual(["mt-4", "mt-custom"]);
});

it("reuses string rewrites across files with the same CSS and font size", () => {
	const report = vi.fn();
	const context = { options: [{ cssPath: "/styles.css" }], sourceCode: { text: "className" }, report };
	if (!("createOnce" in canonicalClassNames)) throw new Error("Expected a createOnce rule");
	const visitor = canonicalClassNames.createOnce(context as unknown as Context);
	const node = { type: "JSXAttribute", name: { type: "JSXIdentifier", name: "className" }, value: { type: "Literal", value: "mt-[16px] flex" } } as ESTree.JSXAttribute;
	visitor.before?.();
	visitor.JSXAttribute?.(node);
	visitor.before?.();
	visitor.JSXAttribute?.(node);
	expect(mocks.canonicalize).toHaveBeenCalledTimes(1);
	expect(mocks.ensure).toHaveBeenCalledTimes(2);
	expect(report).toHaveBeenCalledTimes(2);
});

it.each([
	{ cssPath: "/other.css", rootFontSize: 16 },
	{ cssPath: "/styles.css", rootFontSize: 20 },
])("does not share rewrites when options change to %o", options => {
	const report = vi.fn();
	const context = { options: [{ cssPath: "/styles.css", rootFontSize: 16 }], sourceCode: { text: "className" }, report };
	if (!("createOnce" in canonicalClassNames)) throw new Error("Expected a createOnce rule");
	const visitor = canonicalClassNames.createOnce(context as unknown as Context);
	const node = { type: "JSXAttribute", name: { type: "JSXIdentifier", name: "className" }, value: { type: "Literal", value: "mt-[16px] flex" } } as ESTree.JSXAttribute;
	visitor.before?.();
	visitor.JSXAttribute?.(node);
	context.options[0] = options;
	mocks.canonicalize.mockReturnValue(new Map([["mt-[16px]", "mt-custom"], ["flex", "flex"]]));
	visitor.before?.();
	visitor.JSXAttribute?.(node);
	expect(report.mock.calls.map(([data]) => data.data.canonical)).toEqual(["mt-4", "mt-custom"]);
});

it("bounds retained string rewrites in long-running sessions", () => {
	const context = { options: [{ cssPath: "/styles.css" }], sourceCode: { text: "className" }, report: vi.fn() };
	if (!("createOnce" in canonicalClassNames)) throw new Error("Expected a createOnce rule");
	const visitor = canonicalClassNames.createOnce(context as unknown as Context);
	visitor.before?.();
	const first = { type: "JSXAttribute", name: { type: "JSXIdentifier", name: "className" }, value: { type: "Literal", value: "flex first" } } as ESTree.JSXAttribute;
	visitor.JSXAttribute?.(first);
	for (let i = 0; i < 10_000; i++) {
		visitor.JSXAttribute?.({ ...first, value: { type: "Literal", value: `flex custom-${i}` } } as ESTree.JSXAttribute);
	}
	mocks.canonicalize.mockClear();
	visitor.JSXAttribute?.(first);
	expect(mocks.canonicalize).toHaveBeenCalledTimes(1);
	visitor.JSXAttribute?.(first);
	expect(mocks.canonicalize).toHaveBeenCalledTimes(1);
});
