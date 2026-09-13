/**
 * Synchronous bridge between lint rules and the Tailwind design system.
 *
 * Loading a Tailwind v4 design system is async, but lint rules are sync, so
 * the async load is performed once per stylesheet inside a synckit worker
 * (`worker.js`) and cached there. This module handles stylesheet resolution,
 * mtime-based cache invalidation, and input de-duplication (Tailwind's
 * `canonicalizeCandidates` de-duplicates its output, so inputs must be
 * unique to keep the result aligned).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncFn } from 'synckit';

const workerPath = fileURLToPath(new URL('./worker.js', import.meta.url));

/** @type {ReturnType<typeof createSyncFn> | null} */
let syncCall = null;

/** @type {Map<string, number>} cssFile -> mtimeMs of the loaded content */
const loadedSystems = new Map();

/** @returns {ReturnType<typeof createSyncFn>} */
function getSyncCall() {
  if (syncCall === null) {
    syncCall = createSyncFn(workerPath);
  }
  return syncCall;
}

/**
 * Resolve the Tailwind stylesheet entry file. Relative paths resolve from
 * the process working directory (the repo root when running `bun run lint`).
 *
 * @param {string | undefined} cssPath
 * @param {string} [cwd]
 * @returns {string} absolute path
 */
export function resolveCssPath(cssPath, cwd = process.cwd()) {
  if (!cssPath) throw new Error('cssPath is required');
  return path.isAbsolute(cssPath) ? cssPath : path.resolve(cwd, cssPath);
}

/**
 * Ensure the design system for `cssFile` is loaded in the worker.
 * Throws (fs errors propagate) when the file cannot be read.
 *
 * @param {string} cssFile absolute path to the Tailwind entry CSS
 * @returns {string} cache key for {@link canonicalizeTokens}
 */
export function ensureDesignSystem(cssFile) {
  const stat = fs.statSync(cssFile);
  if (loadedSystems.get(cssFile) === stat.mtimeMs) {
    return cssFile;
  }
  const cssContent = fs.readFileSync(cssFile, 'utf8');
  getSyncCall()({
    type: 'load',
    key: cssFile,
    cssContent,
    base: path.dirname(cssFile),
  });
  loadedSystems.set(cssFile, stat.mtimeMs);
  return cssFile;
}

/**
 * Canonical spelling for each token (1:1, order-preserving).
 *
 * @param {string} key cache key from {@link ensureDesignSystem}
 * @param {string[]} tokens unique class candidates
 * @param {number} rem root font size in px (converts `rem` <-> `px`)
 * @returns {Map<string, string>} token -> canonical spelling
 */
export function canonicalizeTokens(key, tokens, rem) {
  if (tokens.length === 0) {
    return new Map();
  }
  const canonical = getSyncCall()({
    type: 'canonicalize',
    key,
    candidates: tokens,
    rem,
  });
  const result = new Map();
  for (let i = 0; i < tokens.length; i++) {
    result.set(tokens[i], canonical[i] ?? tokens[i]);
  }
  return result;
}
