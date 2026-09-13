/**
 * synckit worker: the only place that touches async Tailwind APIs.
 *
 * oxlint (like ESLint) runs rule visitors synchronously, but Tailwind v4's
 * `__unstable__loadDesignSystem` is async. This worker loads each design
 * system once and caches it; the main thread blocks on it via synckit only
 * the first time a stylesheet is seen. All per-file canonicalization calls
 * afterwards are synchronous `designSystem.canonicalizeCandidates()` calls
 * made inside this worker — the exact same function the Tailwind language
 * server's `suggestCanonicalClasses` lint and the `tailwindcss canonicalize`
 * CLI are built on.
 */
import { runAsWorker } from 'synckit';
import { __unstable__loadDesignSystem } from '@tailwindcss/node';

/** @type {Map<string, any>} */
const designSystems = new Map();

runAsWorker(
  /**
   * @param {{ type: "load", key: string, cssContent: string, base: string } |
   *   { type: "canonicalize", key: string, candidates: string[], rem: number }} job
   */
  async (job) => {
    if (job.type === 'load') {
      designSystems.set(
        job.key,
        await __unstable__loadDesignSystem(job.cssContent, { base: job.base })
      );
      return { ok: true };
    }

    const designSystem = designSystems.get(job.key);
    if (!designSystem) {
      throw new Error(`Tailwind design system not loaded for "${job.key}"`);
    }
    // 1:1 spelling canonicalization only — no `collapse`, no sorting.
    // (Sorting/dedup is the formatter's job: oxfmt `sortTailwindcss`.)
    return designSystem.canonicalizeCandidates(job.candidates, { rem: job.rem });
  }
);
