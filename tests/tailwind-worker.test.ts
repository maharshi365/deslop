import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	load: vi.fn(),
	register: vi.fn(),
}));
vi.mock("@tailwindcss/node", () => ({ __unstable__loadDesignSystem: mocks.load }));
vi.mock("synckit", () => ({ runAsWorker: mocks.register }));

it("preserves a result for every input when canonical spellings collide", async () => {
	const canonical = new Map([["mt-[16px]", "mt-4"], ["mt-4", "mt-4"], ["text-[14px]", "text-sm"]]);
	mocks.load.mockResolvedValue({
		canonicalizeCandidates: (tokens: Array<string>) => [...new Set(tokens.map(token => canonical.get(token) ?? token))],
	});
	await import("../src/tailwind/worker.ts");
	const run = mocks.register.mock.calls[0][0];
	await run({ type: "load", key: "styles", cssContent: "", base: "/" });
	expect(await run({ type: "canonicalize", key: "styles", candidates: ["mt-[16px]", "mt-4", "text-[14px]", "custom"], rem: 16 })).toEqual(["mt-4", "mt-4", "text-sm", "custom"]);
});
