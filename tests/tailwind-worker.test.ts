import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { createJobHandler } from "../src/tailwind/worker.ts";

const theme = path.resolve("node_modules/tailwindcss/theme.css").replaceAll("\\", "/");
let dir: string;
let cssFile: string;

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "deslop-worker-"));
	cssFile = path.join(dir, "styles.css");
	fs.writeFileSync(cssFile, `@import ${JSON.stringify(theme)};\n@tailwind utilities;\n`);
});

afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

it("rewrites each class string and summarizes its first change", async () => {
	const handle = createJobHandler();
	const result = await handle({ type: "canonicalize", cssFile, rem: 16, values: ["  mt-[16px]\tflex px-[16px] custom ", "flex gap-4"] });
	expect(result).toEqual([["  mt-4\tflex px-4 custom ", "mt-[16px]", "mt-4", 2], null]);
});

it("uses the root font size for rem normalization", async () => {
	const handle = createJobHandler();
	const values = ["mt-[20px]"];
	expect(await handle({ type: "canonicalize", cssFile, rem: 16, values })).toEqual([["mt-5", "mt-[20px]", "mt-5", 1]]);
	expect(await handle({ type: "canonicalize", cssFile, rem: 20, values })).toEqual([["mt-4", "mt-[20px]", "mt-4", 1]]);
});

it("refreshes the design system before the first batch for a file", async () => {
	const handle = createJobHandler();
	const values = ["mt-[16px]"];
	expect(await handle({ type: "canonicalize", cssFile, rem: 16, values })).toEqual([["mt-4", "mt-[16px]", "mt-4", 1]]);
	fs.appendFileSync(cssFile, "@theme { --spacing: 0.5rem; }\n");
	fs.utimesSync(cssFile, new Date(), new Date(Date.now() + 10_000));
	expect(await handle({ type: "canonicalize", cssFile, rem: 16, values, refresh: true })).toEqual([["mt-2", "mt-[16px]", "mt-2", 1]]);
});

it("returns null while the CSS file cannot be loaded, including after it is deleted", async () => {
	const handle = createJobHandler();
	const other = path.join(dir, "other.css");
	expect(await handle({ type: "canonicalize", cssFile: other, rem: 16, values: ["mt-[16px]"] })).toBeNull();
	fs.copyFileSync(cssFile, other);
	await handle({ type: "load", cssFile: other });
	expect(await handle({ type: "canonicalize", cssFile: other, rem: 16, values: ["mt-[16px]"] })).toEqual([["mt-4", "mt-[16px]", "mt-4", 1]]);
	fs.rmSync(other);
	await handle({ type: "load", cssFile: other });
	expect(await handle({ type: "canonicalize", cssFile: other, rem: 16, values: ["mt-[16px]"] })).toBeNull();
});
