import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(process.argv[process.argv.indexOf("--project") + 1]);
const configFile = path.join(project, "oxlint.config.mjs");
const cli = path.join(project, "node_modules/oxlint/bin/oxlint");
const localPlugin = path.join(root, "dist/index.js");
const preferredTemp = path.join(os.tmpdir(), "opencode");
const temp = fs.mkdtempSync(path.join(fs.existsSync(preferredTemp) ? preferredTemp : os.tmpdir(), "deslop-project-bench-"));

// Keep the config's original URL: moving it changes ignore and override globs.
// Only its ai-deslop plugin path is replaced, in memory. No --fix is used.
const preload = path.join(temp, "local-plugin.mjs");
fs.writeFileSync(preload, `import { registerHooks } from "node:module";
registerHooks({ load(url, context, nextLoad) {
	const loaded = nextLoad(url, context);
	if (!url.startsWith(${JSON.stringify(pathToFileURL(configFile).href)})) return loaded;
	const source = String(loaded.source).replace(/(['"])ai-deslop\\1(?=\\s*[,\\]])/g, ${JSON.stringify(JSON.stringify(localPlugin))});
	if (source === String(loaded.source)) throw new Error("Expected ai-deslop in jsPlugins in oxlint.config.mjs");
	return { ...loaded, source };
} });
`);

try {
	const { default: config } = await import(pathToFileURL(configFile));
	const samples = { installed: [], local: [] };
	let baselineDiagnostics;
	for (let round = 0; round < 3; round++) {
		for (const mode of round % 2 === 0 ? ["installed", "local"] : ["local", "installed"]) {
			const args = mode === "local" ? ["--import", pathToFileURL(preload).href] : [];
			args.push(cli, "--config", "oxlint.config.mjs", "--debug", "timings", "--format", "default");
			if (config.options?.typeAware) args.push("--type-aware");
			const start = performance.now();
			const child = spawnSync(process.execPath, args, { cwd: project, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
			const wallMs = performance.now() - start;
			if (child.error) throw child.error;
			const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
			fs.writeFileSync(path.join(temp, `${mode}-${round}.txt`), output);
			const timing = output.match(/^deslop\/canonical-class-names\s+([\d,.]+)/m);
			if (!timing) throw new Error(`No canonical-class-names timing was reported.\n${output}`);
			const ruleMs = Number(timing[1].replaceAll(",", ""));
			const diagnosticCounts = output.match(/Found (\d+) warnings and (\d+) errors/);
			assert.ok(diagnosticCounts, "Expected diagnostic counts");
			const diagnosticKey = `${child.status}:${diagnosticCounts[1]}:${diagnosticCounts[2]}`;
			baselineDiagnostics ??= diagnosticKey;
			assert.equal(diagnosticKey, baselineDiagnostics, "Exit status and diagnostic counts must match");
			samples[mode].push({ wallMs, ruleMs });
			console.log(`${mode}: rule ${ruleMs.toFixed(1)} ms; CLI ${wallMs.toFixed(1)} ms`);
		}
	}
	const median = (mode, key) => samples[mode].map(sample => sample[key]).sort((a, b) => a - b)[1];
	for (const key of ["ruleMs", "wallMs"]) {
		const before = median("installed", key);
		const after = median("local", key);
		console.log(`${key}: ${before.toFixed(1)} → ${after.toFixed(1)} ms (${(before / after).toFixed(2)}x faster)`);
	}
	console.log(`Matching exit status and diagnostic counts. Logs: ${temp}`);
} catch (error) {
	console.error(`Benchmark logs: ${temp}`);
	throw error;
}
