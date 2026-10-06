import type { Context, ESTree } from "@oxlint/plugins";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ canonicalize: vi.fn(), ensure: vi.fn() }));
vi.mock("../src/tailwind/design-system.ts", () => ({
	resolveCssPath: (value: string) => value,
	ensureDesignSystem: mocks.ensure,
	canonicalizeTokens: mocks.canonicalize,
}));
import { canonicalClassNames } from "../src/tailwind/rule.ts";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.ensure.mockReturnValue("/styles.css");
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

it("does not reuse string rewrites after a file boundary", () => {
	const report = vi.fn();
	const context = { options: [{ cssPath: "/styles.css" }], sourceCode: { text: "className" }, report };
	if (!("createOnce" in canonicalClassNames)) throw new Error("Expected a createOnce rule");
	const visitor = canonicalClassNames.createOnce(context as unknown as Context);
	const node = { type: "JSXAttribute", name: { type: "JSXIdentifier", name: "className" }, value: { type: "Literal", value: "mt-[16px] flex" } } as ESTree.JSXAttribute;
	visitor.before?.();
	visitor.JSXAttribute?.(node);
	mocks.canonicalize.mockReturnValue(new Map([["mt-[16px]", "mt-custom"], ["flex", "flex"]]));
	visitor.before?.();
	visitor.JSXAttribute?.(node);
	expect(report.mock.calls.map(([data]) => data.data.canonical)).toEqual(["mt-4", "mt-custom"]);
});
