// Speaks the `src/tailwind/worker.ts` protocol, one job at a time. Echoes each job's values;
// a job for the CSS file `fail` responds with an error.
import { workerData } from "node:worker_threads";

const { port } = workerData;
const signal = new Int32Array(workerData.signal);
let queue = Promise.resolve();
port.on("message", ({ id, job }) => {
	queue = queue.then(async () => {
		await new Promise(resolve => setTimeout(resolve, 1));
		port.postMessage(job.cssFile === "fail" ? { id, error: `failed ${id}` } : { id, result: job.values });
		Atomics.add(signal, 0, 1);
		Atomics.notify(signal, 0);
	});
});
