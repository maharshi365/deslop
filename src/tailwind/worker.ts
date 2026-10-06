import { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { runAsWorker } from "synckit";
import { optimizeDesignSystem } from "./optimize-system.ts";

interface LoadJob {
	type: "load";
	key: string;
	cssContent: string;
	base: string;
}

interface CanonicalizeJob {
	type: "canonicalize";
	key: string;
	candidates: Array<string>;
	rem: number;
}

type WorkerJob = LoadJob | CanonicalizeJob;

type DesignSystem = ReturnType<typeof optimizeDesignSystem>;

const designSystems = new Map<string, DesignSystem>();

runAsWorker(async (job: WorkerJob) => {
	if (job.type === "load") {
		designSystems.set(
			job.key,
			optimizeDesignSystem(await __unstable__loadDesignSystem(job.cssContent, { base: job.base })),
		);
		return { ok: true };
	}

	const designSystem = designSystems.get(job.key);
	if (!designSystem) throw new Error(`Tailwind design system not loaded for "${job.key}"`);
	// Tailwind deduplicates canonical spellings, so a batch result is not positional.
	return job.candidates.map(candidate => designSystem.canonicalizeCandidates([candidate], { rem: job.rem })[0] ?? candidate);
});
