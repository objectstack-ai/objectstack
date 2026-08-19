// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared probe derivation for the vendored-Console spec-injection guards.
 *
 * TWO scripts ask "does this console bundle carry THIS tree's @objectstack/spec
 * or the published one", at two different moments:
 *
 *   scripts/assert-console-spec-injection.mjs  — right after a build, with BOTH
 *     specs on disk. Derives the probes and STAMPS them into the dist.
 *   scripts/check-console-injection.mjs        — on every console-job run,
 *     including a cache HIT, where the objectui build tree does not exist and
 *     the published spec is therefore unavailable. Replays the stamped probes.
 *
 * They must derive probes IDENTICALLY: the second script re-asserts strings the
 * first one chose, so two implementations that drift would silently stop
 * agreeing about what a probe even is. Hence one module, imported by both,
 * rather than a copy in each — the copy is what rots.
 *
 * Nothing here exits the process; callers own exit codes. A module that called
 * process.exit() could not be unit-tested, and check-console-injection's
 * --self-test drives these functions directly.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Basename of the provenance stamp written into the console dist. */
export const STAMP_BASENAME = '.objectstack-injection.json';

/** Shape version of that stamp. Bump only on an incompatible field change. */
export const STAMP_VERSION = 1;

/** Export conditions a browser/ESM bundler picks, in preference order.
 *  `types` is deliberately absent — it sits first in each condition object and
 *  would resolve every subpath at a `.d.mts` file. */
const IMPORT_CONDITIONS = ['import', 'module', 'browser', 'default'];

/** Raised for every "cannot run" condition, so callers map it to their own
 *  inconclusive exit code instead of inheriting one from this module. */
export class ProbeError extends Error {}

const bad = (message) => {
  throw new ProbeError(message);
};

export function pickImportTarget(value) {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const hit = pickImportTarget(candidate);
      if (hit) return hit;
    }
    return null;
  }
  for (const condition of IMPORT_CONDITIONS) {
    if (!Object.hasOwn(value, condition)) continue;
    const hit = pickImportTarget(value[condition]);
    if (hit) return hit;
  }
  return null;
}

/** Every JS file a package's exports map resolves to, concatenated once. */
export function readSpecBlob(packageDir, label) {
  const manifestPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(manifestPath)) bad(`${label} spec has no package.json at \`${manifestPath}\``);
  let exportsMap;
  try {
    exportsMap = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).exports;
  } catch (error) {
    bad(`${label} \`${manifestPath}\` is not readable JSON (${error.message})`);
  }
  if (!exportsMap || typeof exportsMap !== 'object') bad(`${label} spec declares no exports map`);

  const chunks = [];
  for (const value of Object.values(exportsMap)) {
    const target = pickImportTarget(value);
    if (!target || !/\.(js|mjs|cjs)$/.test(target)) continue;
    const absolute = path.resolve(packageDir, target);
    if (!fs.existsSync(absolute)) continue;
    chunks.push(fs.readFileSync(absolute, 'utf8'));
  }
  if (chunks.length === 0) bad(`${label} spec at \`${packageDir}\` has no built JavaScript to compare`);
  return chunks.join('\n');
}

/**
 * Candidate probe strings: Zod `.describe()` arguments.
 *
 * They are prose written by spec authors, which makes them stable across a
 * bundler (plain string literals, preserved by minification) and specific enough
 * that a match is not a coincidence — the property objectstack#8134's own
 * measurement relied on, and the reason a bare key name like `object` is
 * unusable here (`optionsFrom.object` false-positives).
 */
export function describeCandidates(blob) {
  const found = new Set();
  const pattern = /\.describe\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*\)/g;
  for (const match of blob.matchAll(pattern)) {
    const text = match[2];
    // Long enough to be unique, short enough to survive intact, and free of
    // escapes and line breaks so a literal search means what it says.
    if (text.length < 32 || text.length > 160) continue;
    if (/[\\\r\n]/.test(text)) continue;
    found.add(text);
  }
  return [...found].sort();
}

/**
 * First candidate present in `mine` and absent from `theirs`, as raw text.
 *
 * SUBSTRING, not set difference. Descriptions are routinely reworded by
 * appending a clause, which makes the old text a PREFIX of the new one — three
 * of the first candidates measured for objectstack#8134 were exactly that, and a
 * set-difference check called them unique when a substring search matched both.
 */
export function pickProbe(candidates, theirs) {
  for (const candidate of candidates) {
    if (!theirs.includes(candidate)) return candidate;
  }
  return null;
}

/** Concatenated JavaScript of a built console `assets/` directory. */
export function readBundle(assetsDir) {
  if (!fs.existsSync(assetsDir)) bad(`assets dir \`${assetsDir}\` does not exist`);
  const chunks = [];
  for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) {
      chunks.push(fs.readFileSync(path.join(assetsDir, entry.name), 'utf8'));
    }
  }
  if (chunks.length === 0) bad(`no JavaScript assets under \`${assetsDir}\``);
  return chunks.join('\n');
}

/**
 * Write the provenance stamp beside a console dist.
 *
 * `entries` is an ARRAY, not a `spec` field: objectstack#9659 records that 4 of 6
 * `@objectstack/*` packages in the console build tree still resolve from
 * objectui's lockfile, and any of them gaining an injection later belongs in the
 * same staleness question. Appending an entry must not need a shape change.
 */
export function writeStamp(distDir, entries) {
  const stamp = {
    stampVersion: STAMP_VERSION,
    generatedBy: 'scripts/assert-console-spec-injection.mjs',
    packages: entries,
  };
  fs.writeFileSync(path.join(distDir, STAMP_BASENAME), `${JSON.stringify(stamp, null, 2)}\n`);
}

/** Read and shape-check a stamp. Returns null when the dist carries none. */
export function readStamp(distDir) {
  const file = path.join(distDir, STAMP_BASENAME);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    bad(`\`${file}\` is not readable JSON (${error.message})`);
  }
  if (!parsed || typeof parsed !== 'object') bad(`\`${file}\` is not a JSON object`);
  if (parsed.stampVersion !== STAMP_VERSION) {
    bad(
      `\`${file}\` is stampVersion ${JSON.stringify(parsed.stampVersion)}, expected ${STAMP_VERSION} — ` +
        'rebuild the console so the stamp matches this checkout',
    );
  }
  if (!Array.isArray(parsed.packages)) bad(`\`${file}\` has no \`packages\` array`);
  return parsed;
}
