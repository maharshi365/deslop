import fs from "node:fs";
import path from "node:path";
import { isMainThread, workerData, type MessagePort } from "node:worker_threads";
import type { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { rewriteClassValue, type Rewrite } from "./candidates.ts";
import { optimizeDesignSystem } from "./optimize-system.ts";

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;

/**
 * `load` (re)loads a design system when its CSS file changed. `canonicalize` uses the loaded one,
 * and loads it first if needed; the main thread sends a `load` before each file's first strings.
 */
export type WorkerJob =
	| { readonly type: "load"; readonly cssFile: string }
	| { readonly type: "canonicalize"; readonly cssFile: string; readonly values: ReadonlyArray<string>; readonly rem: number };

/** `null` means the CSS entry could not be loaded. Otherwise, one entry per input value. */
export type CanonicalizeResult = Array<Rewrite | null> | null;

export interface WorkerRequest { readonly id: number; readonly job: WorkerJob }
export type WorkerResponse = { readonly id: number; readonly result: CanonicalizeResult } | { readonly id: number; readonly error: string };

interface LoadedSystem {
	readonly cssFile: string;
	readonly mtimeMs: number;
	readonly system: DesignSystem;
}

/** Create the job handler. Design systems load on first use and reload when their CSS file changes. */
export function createJobHandler(load: typeof __unstable__loadDesignSystem = defaultLoad): (job: WorkerJob) => Promise<CanonicalizeResult> {
	const systems: Array<LoadedSystem> = [];

	// A failed load is not recorded, so the next `load` retries it.
	async function reload(cssFile: string): Promise<DesignSystem | null> {
		const index = systems.findIndex(entry => entry.cssFile === cssFile);
		let mtimeMs: number;
		try {
			mtimeMs = fs.statSync(cssFile).mtimeMs;
		} catch {
			if (index !== -1) systems.splice(index, 1);
			return null;
		}
		if (index !== -1 && systems[index].mtimeMs === mtimeMs) return systems[index].system;
		let system: DesignSystem;
		try {
			system = optimizeDesignSystem(await load(fs.readFileSync(cssFile, "utf8"), { base: path.dirname(cssFile) }));
		} catch {
			if (index !== -1) systems.splice(index, 1);
			return null;
		}
		const entry = { cssFile, mtimeMs, system };
		if (index === -1) systems.push(entry);
		else systems[index] = entry;
		return system;
	}

	return async job => {
		if (job.type === "load") {
			await reload(job.cssFile);
			return null;
		}
		const system = systems.find(entry => entry.cssFile === job.cssFile)?.system ?? await reload(job.cssFile);
		if (system === null) return null;
		const options = { rem: job.rem };
		// Tailwind deduplicates canonical spellings, so canonicalize one token per call.
		const canonicalize = (token: string) => system.canonicalizeCandidates([token], options)[0] ?? token;
		return job.values.map(value => {
			try { return rewriteClassValue(value, canonicalize); } catch { return null; }
		});
	};
}

async function defaultLoad(...args: Parameters<typeof __unstable__loadDesignSystem>) {
	const { __unstable__loadDesignSystem } = await import("@tailwindcss/node");
	return __unstable__loadDesignSystem(...args);
}

// Jobs run one at a time. Each response is followed by a signal for the waiting main thread.
if (!isMainThread && workerData?.deslopTailwind === true) {
	const port: MessagePort = workerData.port;
	const signal = new Int32Array(workerData.signal as SharedArrayBuffer);
	const handle = createJobHandler();
	let queue = Promise.resolve();
	port.on("message", ({ id, job }: WorkerRequest) => {
		queue = queue.then(async () => {
			let response: WorkerResponse;
			try {
				response = { id, result: await handle(job) };
			} catch (error) {
				response = { id, error: error instanceof Error ? error.message : String(error) };
			}
			port.postMessage(response);
			Atomics.add(signal, 0, 1);
			Atomics.notify(signal, 0);
		});
	});
}
