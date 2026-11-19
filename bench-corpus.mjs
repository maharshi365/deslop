// End-to-end Oxlint benchmark over pinned open-source projects.
//
//   node bench-corpus.mjs setup                      Clone the pinned corpus.
//   node bench-corpus.mjs --save base.json           Measure and save timings and diagnostics.
//   node bench-corpus.mjs --compare base.json        Measure; fail if any diagnostic changed.
//   node bench-corpus.mjs --profile                  CPU-profile one run; attribute time to rules.
//
// Options: --corpus DIR (default ../../deslop-bench/corpus or $DESLOP_CORPUS), --runs N,
// --only a,b (projects), --rules a,b (rule subset), --module-dir DIR (default dist).
// The corpus is untrusted data: Oxlint only parses it, nested configs are disabled.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const PROJECTS = [
	{ name: "zod", url: "https://github.com/colinhacks/zod", sha: "e32e08836e451e26f53f5ff6efe4fb92b07a47ad" },
	{ name: "hono", url: "https://github.com/honojs/hono", sha: "75ff8e3ea18485589816881c6278bc9783e56602" },
	{ name: "excalidraw", url: "https://github.com/excalidraw/excalidraw", sha: "2c3dcc06ec807e81ab9437eceb1a8f7a3c590743" },
	{ name: "shadcn", url: "https://github.com/shadcn-ui/ui", sha: "f50887ae68d0fdcbfbe86b57be08af94a4c88a68" },
	{ name: "vitest", url: "https://github.com/vitest-dev/vitest", sha: "45d199c586bff37bac3cb653ab37f85ef1e3537a" },
	{ name: "drizzle", url: "https://github.com/drizzle-team/drizzle-orm", sha: "3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d" },
	{ name: "query", url: "https://github.com/TanStack/query", sha: "f6689e04be493e2e83f9c93d7e478f92c3e5d328" },
];

const root = path.dirname(fileURLToPath(import.meta.url));
const argument = (name, fallback) => {
	const index = process.argv.indexOf(name);
	return index === -1 ? fallback : process.argv[index + 1];
};
const corpus = path.resolve(argument("--corpus", process.env.DESLOP_CORPUS ?? path.join(os.homedir(), "deslop-bench", "corpus")));
const moduleDir = path.resolve(argument("--module-dir", path.join(root, "dist")));
const runs = Number(argument("--runs", "5"));
const only = argument("--only", null)?.split(",");
const ruleSubset = argument("--rules", null)?.split(",");
const projects = PROJECTS.filter(project => only === null || only === undefined || only.includes(project.name));
const cli = path.join(root, "node_modules/oxlint/bin/oxlint");

if (process.argv[2] === "setup") {
	fs.mkdirSync(corpus, { recursive: true });
	for (const project of PROJECTS) {
		const dir = path.join(corpus, project.name);
		const git = (...args) => {
			const child = spawnSync("git", ["-c", "core.longpaths=true", ...args], { stdio: "inherit" });
			if (child.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
		};
		if (!fs.existsSync(dir)) {
			git("init", "--quiet", dir);
			git("-C", dir, "remote", "add", "origin", project.url);
		}
		git("-C", dir, "fetch", "--quiet", "--depth", "1", "origin", project.sha);
		git("-C", dir, "checkout", "--quiet", "--force", project.sha);
		console.log(`${project.name}: ${project.sha}`);
	}
	process.exit(0);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "deslop-corpus-"));
const slash = file => file.replaceAll("\\", "/");

// Exercise every rule, including the opt-in ones, with options that enable their detectors.
const cssPath = path.join(temp, "styles.css");
fs.writeFileSync(cssPath, `@import ${JSON.stringify(slash(path.join(root, "node_modules/tailwindcss/theme.css")))};\n@tailwind utilities;\n`);
const plugin = (await import(pathToFileURL(path.join(moduleDir, "index.js")))).default;
const ruleOptions = {
	"canonical-class-names": [{ cssPath: slash(cssPath) }],
	"no-duplicate-types": [{ schemas: { libraries: ["zod", "valibot", "arktype"] }, drizzle: {} }],
	"no-restricted-syntax": [{
		selector: "NewExpression[callee.name='Map'][arguments.length=0]:not([typeArguments])",
		message: "Bare new Map() infers Map<any, any>. Provide entries so types can be inferred.",
	}],
};
// `no-constant-substring-tests` is an alias of `no-poor-substring-tests`.
const skipped = argument("--skip", "").split(",");
const ruleNames = Object.keys(plugin.rules).filter(name => name !== "no-constant-substring-tests" && !skipped.includes(name) && (ruleSubset == null || ruleSubset.includes(name)));
// `--floor` replaces every rule with no-op handlers on the same visitor keys: Oxlint's dispatch cost.
let measuredPlugin = path.join(moduleDir, "index.js");
if (process.argv.includes("--floor")) {
	const keys = {};
	for (const name of ruleNames) {
		const rule = plugin.rules[name];
		const context = new Proxy({}, { get: (_, key) => key === "options" ? (ruleOptions[name] ?? []) : undefined });
		keys[name] = Object.keys((rule.createOnce ?? rule.create)(context));
	}
	measuredPlugin = path.join(temp, "floor-plugin.mjs");
	fs.writeFileSync(measuredPlugin, `const keys = ${JSON.stringify(keys)};
export default { meta: { name: "deslop" }, rules: Object.fromEntries(Object.entries(keys).map(([name, visitorKeys]) => [name, {
	createOnce() { return Object.fromEntries(visitorKeys.map(key => [key, key === "before" ? () => true : () => {}])); },
}])) };
`);
}
const allConfig = path.join(temp, "all.json");
fs.writeFileSync(allConfig, JSON.stringify({
	jsPlugins: [slash(measuredPlugin)],
	categories: { correctness: "off" },
	rules: Object.fromEntries(ruleNames.map(name => [`deslop/${name}`, process.argv.includes("--floor") ? "error" : ["error", ...(ruleOptions[name] ?? [])]])),
}));
// The fixed cost of any JS plugin: transfer, deserialization, and a full AST walk.
const basePlugin = path.join(temp, "base-plugin.mjs");
fs.writeFileSync(basePlugin, `export default { meta: { name: "base" }, rules: { noop: { create() { return { Identifier() {} }; } } } };\n`);
const baseConfig = path.join(temp, "base.json");
fs.writeFileSync(baseConfig, JSON.stringify({ jsPlugins: [slash(basePlugin)], categories: { correctness: "off" }, rules: { "base/noop": "error" } }));

// CPU time of the whole Oxlint process (all threads), printed at exit. Contention from other
// programs inflates it much less than wall time.
const cpuPreload = path.join(temp, "cpu-preload.mjs");
fs.writeFileSync(cpuPreload, `import fs from "node:fs";
process.on("exit", () => { const usage = process.cpuUsage(); fs.writeSync(2, "\\nDESLOP_CPU " + (usage.user + usage.system) / 1000 + "\\n"); });
`);

function lint(project, config, extraNodeArgs = []) {
	const cwd = path.join(corpus, project.name);
	const args = ["--import", pathToFileURL(cpuPreload).href, ...extraNodeArgs, cli, "--config", config, "--disable-nested-config", "--threads=1", "--format", "json", "."];
	const start = performance.now();
	const child = spawnSync(process.execPath, args, { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
	const wallMs = performance.now() - start;
	if (child.error) throw child.error;
	if (child.status === null || child.status > 1) throw new Error(`Oxlint exited ${child.status} on ${project.name}\n${child.stderr}`);
	const cpu = /DESLOP_CPU ([\d.]+)/.exec(child.stderr);
	return { wallMs, cpuMs: cpu === null ? NaN : Number(cpu[1]), stdout: child.stdout, stderr: child.stderr };
}

// Oxlint prints JS plugin diagnostics in report order. Rules may move relative to each other, but
// each rule's order within a file must not change: group by file and rule with a stable sort.
function diagnostics(stdout) {
	const parsed = JSON.parse(stdout);
	return parsed.diagnostics
		.map(d => ({ group: `${slash(d.filename)} ${d.code}`, line: `${slash(d.filename)}:${d.labels.map(l => `${l.span.offset}+${l.span.length}`).join(",")} ${d.code} ${d.message}` }))
		.sort((a, b) => a.group < b.group ? -1 : a.group > b.group ? 1 : 0)
		.map(d => d.line);
}

// Interference only adds time, so the fastest run is the best estimate of the true cost.
const fastest = values => Math.min(...values);

if (process.argv.includes("--profile")) {
	const distUrl = pathToFileURL(moduleDir).href;
	const byRule = new Map();
	const byFunction = new Map();
	const byInnermost = new Map();
	const byEntry = new Map();
	const outside = new Map();
	let totalMs = 0;
	for (const project of projects) {
		const profileDir = path.join(temp, `prof-${project.name}`);
		lint(project, allConfig, ["--cpu-prof", `--cpu-prof-dir=${profileDir}`]);
		for (const file of fs.readdirSync(profileDir)) {
			const profile = JSON.parse(fs.readFileSync(path.join(profileDir, file), "utf8"));
			const nodes = new Map(profile.nodes.map(node => [node.id, node]));
			const parent = new Map();
			for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
			const ours = node => node.callFrame.url.startsWith(distUrl);
			const label = node => `${node.callFrame.functionName || "(anonymous)"} ${node.callFrame.url.slice(distUrl.length + 1)}:${node.callFrame.lineNumber + 1}`;
			for (let i = 0; i < profile.samples.length; i++) {
				const ms = (profile.timeDeltas[i] ?? 0) / 1000;
				totalMs += ms;
				let id = profile.samples[i];
				const leaf = nodes.get(id);
				let innermost = null;
				let outermost = null;
				let entry = null;
				let previous = null;
				while (id !== undefined) {
					const node = nodes.get(id);
					if (ours(node)) {
						if (innermost === null && previous !== null) entry = previous;
						innermost ??= node;
						outermost = node;
					}
					previous = node;
					id = parent.get(id);
				}
				if (entry !== null) {
					const key = `${entry.callFrame.functionName || "(anonymous)"} ${path.basename(entry.callFrame.url)}:${entry.callFrame.lineNumber + 1}`;
					byEntry.set(key, (byEntry.get(key) ?? 0) + ms);
				}
				if (outermost === null) {
					const key = `${leaf.callFrame.functionName || "(anonymous)"} ${path.basename(leaf.callFrame.url)}`;
					outside.set(key, (outside.get(key) ?? 0) + ms);
					continue;
				}
				const rule = outermost.callFrame.url.slice(distUrl.length + 1);
				byRule.set(rule, (byRule.get(rule) ?? 0) + ms);
				const key = ours(leaf) ? label(leaf) : `${label(innermost)} -> ${leaf.callFrame.functionName || "(anonymous)"}`;
				byFunction.set(key, (byFunction.get(key) ?? 0) + ms);
				const inclusive = `${label(innermost)}  [${rule}]`;
				byInnermost.set(inclusive, (byInnermost.get(inclusive) ?? 0) + ms);
			}
		}
	}
	const print = (title, map, limit) => {
		console.log(`\n${title}`);
		for (const [key, ms] of [...map].sort((a, b) => b[1] - a[1]).slice(0, limit)) console.log(`${ms.toFixed(0).padStart(8)} ms  ${key}`);
	};
	console.log(`Profiled ${projects.map(p => p.name).join(", ")}: ${totalMs.toFixed(0)} ms of JS samples`);
	print("Inclusive time by outermost deslop frame (rule entry file):", byRule, 40);
	print("Inclusive time by innermost deslop function (includes library callees):", byInnermost, 40);
	print("Library entry points called from deslop code (inclusive):", byEntry, 25);
	print("Hot spots (deslop leaf, or deslop caller -> library leaf):", byFunction, 40);
	print("Outside deslop frames (leaf):", outside, 25);
	fs.rmSync(temp, { recursive: true, force: true });
	process.exit(0);
}

const result = { node: process.version, rules: ruleNames.length, projects: {} };
const compareFile = argument("--compare", null);
const baseline = compareFile ? JSON.parse(fs.readFileSync(compareFile, "utf8")) : null;
let failed = false;
try {
	console.log(`Corpus benchmark: ${ruleNames.length} rules, 1 thread, fastest of ${runs} runs. Wall time, then CPU time of all threads.`);
	for (const project of projects) {
		const runsOf = { base: { wall: [], cpu: [] }, all: { wall: [], cpu: [] } };
		let output = null;
		for (let i = 0; i < runs; i++) {
			// Alternate order so drift affects both configurations equally.
			for (const mode of i % 2 === 0 ? ["base", "all"] : ["all", "base"]) {
				const run = lint(project, mode === "base" ? baseConfig : allConfig);
				runsOf[mode].wall.push(run.wallMs);
				runsOf[mode].cpu.push(run.cpuMs);
				if (mode === "all") {
					const lines = diagnostics(run.stdout);
					if (output !== null) assert.deepEqual(lines, output, `${project.name}: diagnostics differ between runs`);
					output = lines;
				}
			}
		}
		const entry = {
			baseMs: fastest(runsOf.base.wall), allMs: fastest(runsOf.all.wall),
			baseCpuMs: fastest(runsOf.base.cpu), allCpuMs: fastest(runsOf.all.cpu),
			diagnostics: output.length, digest: crypto.createHash("sha256").update(output.join("\n")).digest("hex"), lines: output,
		};
		entry.rulesMs = entry.allMs - entry.baseMs;
		entry.rulesCpuMs = entry.allCpuMs - entry.baseCpuMs;
		result.projects[project.name] = entry;
		const before = baseline?.projects[project.name];
		const speed = key => before?.[key] ? ` (${(before[key] / entry[key]).toFixed(2)}x)` : "";
		console.log(`${project.name.padEnd(11)} base ${entry.baseMs.toFixed(0).padStart(6)}  all ${entry.allMs.toFixed(0).padStart(6)}  rules ${entry.rulesMs.toFixed(0).padStart(6)} ms${speed("rulesMs")}  | cpu rules ${entry.rulesCpuMs.toFixed(0).padStart(6)} ms${speed("rulesCpuMs")}  ${entry.diagnostics} diagnostics`);
		if (before && before.digest !== entry.digest) {
			failed = true;
			const beforeSet = new Set(before.lines);
			const afterSet = new Set(entry.lines);
			const removed = before.lines.filter(line => !afterSet.has(line));
			const added = entry.lines.filter(line => !beforeSet.has(line));
			console.log(removed.length + added.length === 0 ? "  DIAGNOSTIC ORDER CHANGED within a rule" : `  DIAGNOSTICS CHANGED: -${removed.length} +${added.length}`);
			for (const line of removed.slice(0, 10)) console.log(`  - ${line}`);
			for (const line of added.slice(0, 10)) console.log(`  + ${line}`);
			if (removed.length + added.length === 0) {
				const index = before.lines.findIndex((line, i) => line !== entry.lines[i]);
				console.log(`  first difference at ${index}:\n  was ${before.lines[index]}\n  now ${entry.lines[index]}`);
			}
		}
	}
	const sum = key => Object.values(result.projects).reduce((total, entry) => total + entry[key], 0);
	result.total = Object.fromEntries(["baseMs", "allMs", "rulesMs", "baseCpuMs", "allCpuMs", "rulesCpuMs"].map(key => [key, sum(key)]));
	const speed = key => baseline?.total[key] ? ` (${(baseline.total[key] / result.total[key]).toFixed(2)}x)` : "";
	console.log(`${"TOTAL".padEnd(11)} base ${result.total.baseMs.toFixed(0).padStart(6)}  all ${result.total.allMs.toFixed(0).padStart(6)}  rules ${result.total.rulesMs.toFixed(0).padStart(6)} ms${speed("rulesMs")}  | cpu rules ${result.total.rulesCpuMs.toFixed(0).padStart(6)} ms${speed("rulesCpuMs")}`);
	const save = argument("--save", null);
	if (save) fs.writeFileSync(save, JSON.stringify(result) + "\n");
} finally {
	fs.rmSync(temp, { recursive: true, force: true });
}
if (failed) {
	console.error("Diagnostics changed.");
	process.exit(1);
}
