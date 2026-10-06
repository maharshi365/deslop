import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	stat: vi.fn(),
	read: vi.fn(),
	worker: vi.fn(),
}));

vi.mock("node:fs", () => ({ default: { statSync: mocks.stat, readFileSync: mocks.read } }));
vi.mock("synckit", () => ({ createSyncFn: () => mocks.worker }));

describe("Tailwind canonical result cache", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mocks.stat.mockReturnValue({ mtimeMs: 1 });
		mocks.read.mockReturnValue("@tailwind utilities;");
		mocks.worker.mockImplementation(job => job.type === "load" ? { ok: true } : job.candidates.map((token: string) => token === "mt-[16px]" ? `mt-${job.rem === 16 ? 4 : 2}` : token));
	});

	it("only sends unseen tokens to the worker across strings and files", async () => {
		const { ensureDesignSystem, canonicalizeTokens } = await import("../src/tailwind/design-system.ts");
		const key = ensureDesignSystem("/styles.css");
		expect(Object.fromEntries(canonicalizeTokens(key, ["mt-[16px]", "flex"], 16))).toEqual({ "mt-[16px]": "mt-4", flex: "flex" });
		ensureDesignSystem("/styles.css");
		expect(Object.fromEntries(canonicalizeTokens(key, ["flex", "mt-[16px]", "grid"], 16))).toEqual({ flex: "flex", "mt-[16px]": "mt-4", grid: "grid" });
		expect(Object.fromEntries(canonicalizeTokens(key, ["grid", "flex", "mt-[16px]"], 16))).toEqual({ grid: "grid", flex: "flex", "mt-[16px]": "mt-4" });
		expect(mocks.worker.mock.calls.filter(([job]) => job.type === "canonicalize").map(([job]) => job.candidates)).toEqual([["mt-[16px]", "flex"], ["grid"]]);
	});

	it("does not mix font sizes or design systems", async () => {
		const { ensureDesignSystem, canonicalizeTokens } = await import("../src/tailwind/design-system.ts");
		const first = ensureDesignSystem("/first.css");
		const second = ensureDesignSystem("/second.css");
		canonicalizeTokens(first, ["mt-[16px]"], 16);
		expect(canonicalizeTokens(first, ["mt-[16px]"], 32).get("mt-[16px]")).toBe("mt-2");
		mocks.worker.mockImplementation(job => job.type === "load" ? { ok: true } : ["mt-custom"]);
		expect(canonicalizeTokens(second, ["mt-[16px]"], 16).get("mt-[16px]")).toBe("mt-custom");
		expect(canonicalizeTokens(first, ["mt-[16px]"], 16).get("mt-[16px]")).toBe("mt-4");
	});

	it("drops cached results after a successful CSS reload", async () => {
		const { ensureDesignSystem, canonicalizeTokens } = await import("../src/tailwind/design-system.ts");
		const key = ensureDesignSystem("/styles.css");
		canonicalizeTokens(key, ["mt-[16px]"], 16);
		mocks.stat.mockReturnValue({ mtimeMs: 2 });
		mocks.worker.mockImplementation(job => job.type === "load" ? { ok: true } : ["mt-custom"]);
		ensureDesignSystem("/styles.css");
		expect(canonicalizeTokens(key, ["mt-[16px]"], 16).get("mt-[16px]")).toBe("mt-custom");
	});

	it("retries failed canonicalizations instead of caching them", async () => {
		const { ensureDesignSystem, canonicalizeTokens } = await import("../src/tailwind/design-system.ts");
		const key = ensureDesignSystem("/styles.css");
		mocks.worker.mockImplementationOnce(() => { throw new Error("worker failed"); });
		expect(() => canonicalizeTokens(key, ["mt-[16px]"], 16)).toThrow("worker failed");
		expect(canonicalizeTokens(key, ["mt-[16px]"], 16).get("mt-[16px]")).toBe("mt-4");
	});

	it("only canonicalizes duplicate input tokens once", async () => {
		const { ensureDesignSystem, canonicalizeTokens } = await import("../src/tailwind/design-system.ts");
		const key = ensureDesignSystem("/styles.css");
		expect(Object.fromEntries(canonicalizeTokens(key, ["mt-[16px]", "mt-[16px]"], 16))).toEqual({ "mt-[16px]": "mt-4" });
		expect(mocks.worker.mock.calls.find(([job]) => job.type === "canonicalize")?.[0].candidates).toEqual(["mt-[16px]"]);
	});
});
