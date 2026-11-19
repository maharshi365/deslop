import path from "node:path";
import { expect, it } from "vitest";

import { startWorker } from "../src/tailwind/design-system.ts";

const echoWorker = path.resolve("tests/fixtures/echo-worker.mjs");
const job = (values: Array<string>, cssFile = "a.css") => ({ type: "canonicalize", cssFile, rem: 16, values }) as const;

it("takes kept results in posting order and drops the others", () => {
	const worker = startWorker(echoWorker);
	worker.post(job(["dropped"]), false);
	worker.post(job(["first"]), true);
	worker.post(job(["also dropped"]), false);
	worker.post(job(["second"]), true);
	expect(worker.take()).toEqual(["first"]);
	expect(worker.take()).toEqual(["second"]);
	expect(() => worker.take()).toThrow("No posted job to take");
});

it("throws a failed job's error from take, and keeps later results", () => {
	const worker = startWorker(echoWorker);
	worker.post(job([], "fail"), true);
	worker.post(job(["after"]), true);
	expect(() => worker.take()).toThrow("failed 1");
	expect(worker.take()).toEqual(["after"]);
});
