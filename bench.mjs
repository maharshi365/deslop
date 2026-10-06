import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

// Exercises the real rule callbacks and worker, without Oxlint's parser overhead.
const root = path.dirname(fileURLToPath(import.meta.url));
const stringsPerFile = 100;
const files = 1000;
const varied = process.argv.includes("--varied");
const moduleArg = process.argv.indexOf("--module-dir");
const moduleDir = moduleArg === -1 ? path.join(root, "dist") : path.resolve(process.argv[moduleArg + 1]);

if (process.argv.includes("--child")) {
	const { canonicalClassNames } = await import(pathToFileURL(path.join(moduleDir, "tailwind/rule.js")));
	const preferredTemp = path.join(os.tmpdir(), "opencode");
	const dir = fs.mkdtempSync(path.join(fs.existsSync(preferredTemp) ? preferredTemp : os.tmpdir(), "deslop-bench-"));
	try {
		const cssPath = path.join(dir, "styles.css");
		const themePath = path.join(root, "node_modules/tailwindcss/theme.css").replaceAll("\\", "/");
		fs.writeFileSync(cssPath, `@import ${JSON.stringify(themePath)};\n@tailwind utilities;`);
		const values = [
			"flex items-center gap-4 px-4 py-2 rounded-lg bg-white text-sm font-medium hover:bg-gray-100",
			"mt-[16px] flex gap-4",
			"px-[16px] py-2 text-[14px]",
			"grid grid-cols-2 gap-4 custom-component",
		];
		let reports = 0;
		const context = {
			options: [{ cssPath }],
			sourceCode: { text: 'className="fixture"' },
			report(report) {
				assert.equal(report.messageId, "nonCanonical");
				reports++;
			},
		};
		const visitor = canonicalClassNames.createOnce(context);
		const inputs = varied ? Array.from({ length: 512 }, (_, i) => `${values[i % values.length]} scope-${Math.floor(i / values.length)}`) : values;
		const nodes = inputs.map(value => ({
			type: "JSXAttribute", name: { type: "JSXIdentifier", name: "className" },
			value: { type: "Literal", value },
		}));
		const start = performance.now();
		visitor.before();
		visitor.JSXAttribute(nodes[0]);
		const coldMs = performance.now() - start;
		const warmStart = performance.now();
		for (let file = 0; file < files; file++) {
			visitor.before();
			for (let i = 0; i < stringsPerFile; i++) visitor.JSXAttribute(nodes[(file * stringsPerFile + i) % nodes.length]);
		}
		const warmMs = performance.now() - warmStart;
		assert.equal(reports, files * stringsPerFile / 2);
		console.log(JSON.stringify({ coldMs, warmMs, totalMs: coldMs + warmMs, reports }));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
} else {
	const samples = [];
	for (let i = 0; i < 3; i++) {
		const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", ...process.argv.slice(2)], { cwd: root, encoding: "utf8" });
		if (child.status !== 0) throw new Error(child.stderr || child.stdout || `Benchmark exited ${child.status}`);
		samples.push(JSON.parse(child.stdout));
	}
	const median = key => samples.map(sample => sample[key]).sort((a, b) => a - b)[1];
	const result = {
		node: process.version, strings: files * stringsPerFile, scenario: varied ? "varied" : "repeated", samples,
		coldMs: median("coldMs"), warmMs: median("warmMs"), totalMs: median("totalMs"),
	};
	const compare = process.argv.indexOf("--compare");
	const baseline = compare === -1 ? null : JSON.parse(fs.readFileSync(process.argv[compare + 1], "utf8"));
	if (baseline) assert.equal(baseline.scenario ?? "repeated", result.scenario, "Compare the same benchmark scenario");
	console.log(`Rule benchmark (${result.scenario}): ${result.strings.toLocaleString()} strings, ${files} files; median of 3 fresh processes`);
	for (const key of ["coldMs", "warmMs", "totalMs"]) {
		console.log(`${key}: ${result[key].toFixed(1)} ms${baseline ? ` (${(baseline[key] / result[key]).toFixed(2)}x faster)` : ""}`);
	}
	const save = process.argv.indexOf("--save");
	if (save !== -1) fs.writeFileSync(process.argv[save + 1], JSON.stringify(result, null, 2) + "\n");
}
