import path from "node:path";
import { fileURLToPath } from "node:url";
import { MessageChannel, receiveMessageOnPort, Worker } from "node:worker_threads";
import type { CanonicalizeResult, WorkerJob, WorkerRequest, WorkerResponse } from "./worker.ts";

/**
 * A worker that runs jobs in order while the caller keeps working. `post` returns at once;
 * `take` blocks until the next kept job finishes, and returns its result or throws its error.
 */
export interface WorkerChannel {
	post(job: WorkerJob, keepResult: boolean): void;
	take(): CanonicalizeResult;
}

/** Start a worker that speaks the `worker.ts` protocol. The worker does not keep the process alive. */
export function startWorker(workerPath: string, workerData: Record<string, unknown> = {}): WorkerChannel {
	const signal = new SharedArrayBuffer(4);
	const flag = new Int32Array(signal);
	const { port1, port2 } = new MessageChannel();
	const worker = new Worker(workerPath, {
		workerData: { ...workerData, deslopTailwind: true, port: port2, signal },
		transferList: [port2],
	});
	worker.unref();
	port1.unref();
	let nextId = 0;
	// Responses arrive in request order, and kept requests are taken in order. So while waiting for
	// the oldest kept id, every other response that arrives belongs to a dropped request.
	const kept: Array<number> = [];
	let keptHead = 0;
	return {
		post(job, keepResult) {
			const request: WorkerRequest = { id: ++nextId, job };
			if (keepResult) kept.push(request.id);
			port1.postMessage(request);
		},
		take() {
			if (keptHead === kept.length) throw new Error("No posted job to take");
			const id = kept[keptHead++];
			if (keptHead === kept.length) {
				kept.length = 0;
				keptHead = 0;
			}
			for (;;) {
				const seen = Atomics.load(flag, 0);
				for (let message = receiveMessageOnPort(port1); message !== undefined; message = receiveMessageOnPort(port1)) {
					const response = message.message as WorkerResponse;
					if (response.id !== id) continue;
					if ("error" in response) throw new Error(response.error);
					return response.result;
				}
				Atomics.wait(flag, 0, seen);
			}
		},
	};
}

// `tsc` emits `worker.ts` as `dist/tailwind/worker.js` next to this file; Node cannot type-strip
// `.ts` files under node_modules, so consumers always load the compiled worker. Tests load sources.
const workerPath = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url));
let channel: WorkerChannel | null = null;

function worker(): WorkerChannel {
	channel ??= startWorker(workerPath);
	return channel;
}

export function resolveCssPath(cssPath: string | undefined, cwd = process.cwd()): string {
	if (!cssPath) throw new Error("cssPath is required");
	return path.isAbsolute(cssPath) ? cssPath : path.resolve(cwd, cssPath);
}

/** Load the design system in the background, or reload it if its CSS file changed. */
export function loadDesignSystem(cssFile: string): void {
	worker().post({ type: "load", cssFile }, false);
}

/** Start canonicalizing class strings in the background. Collect the result with `takeRewrites`. */
export function postClassValues(cssFile: string, values: ReadonlyArray<string>, rem: number, refresh: boolean): void {
	worker().post({ type: "canonicalize", cssFile, values, rem, refresh }, true);
}

/** Wait for the oldest posted class strings. Returns null when the CSS entry cannot be loaded. */
export function takeRewrites(): CanonicalizeResult {
	return worker().take();
}
