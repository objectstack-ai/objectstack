#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-eager-locale-catalogues -- exactly ONE locale catalogue may be in the
 * console's EAGER closure, and it must be the resident one (objectui#7479).
 *
 *   pnpm check:eager-locale-catalogues     # after a full console build
 *
 * ## What this weighs, and why the budget gate cannot
 *
 * `scripts/check-eager-closure-budget.mjs` weighs BYTES. That is the right
 * instrument for growth and the wrong one for this: the ten catalogues could
 * come back into the eager closure one at a time, each arrival small enough to
 * fit inside a ceiling's headroom, and every run would be green until the last
 * one. It could also be defeated in the opposite direction -- objectui#7399
 * named that explicitly and refused it -- by routing the same bytes into a
 * chunk with a roomier ceiling, which changes WHERE the browser fetches them
 * from and not WHETHER it fetches them.
 *
 * So this gate weighs COMPOSITION: which catalogues a page load pulls, not what
 * they cost. The two halves are complementary and neither substitutes for the
 * other.
 *
 * ## The regression it exists to catch
 *
 * `packages/i18n/src/index.ts` used to re-export all ten catalogues, and
 * `locales/index.ts`'s `builtInLocales` named every one of them in a single
 * object literal. Both spellings make all ten statically reachable from any
 * import of the package, and nothing can tree-shake an object literal's
 * members. Measured on the console: ~445 KB gzipped of translation data
 * fetched before first paint, of which a viewer reads one catalogue's worth.
 *
 * ⛔ Restoring either spelling is a ONE-LINE regression that no byte budget
 * reports as one, because the bytes land in a chunk that already has a ceiling
 * sized to hold them. `packages/i18n/src/__tests__/entry-locale-shape-7479.test.ts`
 * fails on the SOURCE shape so the cause is legible without a build; this file
 * fails on the BUILT bundle so a new route to the same outcome -- a chunk group
 * that merges the ten back together, a consumer that imports the barrel on a
 * page-load path, a bundler upgrade that stops honouring `import()` boundaries
 * -- is caught even when every source file still reads correctly.
 *
 * ## Why `en` is the one that may be eager
 *
 * It is `fallbackLng`, it is the dictionary `@object-ui/app-shell`'s splash
 * renders from before i18n is usable, and it is what a synchronous
 * `createI18n()` call has to be able to answer with. The argument in full is in
 * `packages/i18n/src/locales/registry.ts`. This gate does not re-argue it; it
 * pins it, and {@link ACTIVE_CATALOGUE} is the single place the choice is
 * written down on this side.
 *
 * ## Exit codes (the same three meanings as the budget gate)
 *
 *   0  every non-resident catalogue is lazy -- a verdict about the bundle
 *   1  at least one is eager -- a verdict about the bundle
 *   2  no trustworthy verdict -- a verdict about the GAUGE
 *
 * ⛔ 2 is not a softer 1. A gate that cannot run is not a gate that passed:
 * without `apps/console/dist/` this checker has nothing to read, and a
 * "no catalogues are eager" printed over an absent build is the most confident
 * wrong answer available. Two counter-probes below turn each way that could
 * happen into a 2.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every language code `@object-ui/i18n` ships a catalogue for.
 *
 * ⚠️ Duplicated from `BUILT_IN_LANGUAGE_CODES` in
 * `packages/i18n/src/locales/registry.ts` on purpose: this file must state its
 * own population, or a code deleted from the registry would silently leave this
 * gate with nothing to look for and a green tick over it.
 * `scripts/__tests__/check-eager-locale-catalogues.test.ts` fails when the two
 * lists stop agreeing, which is the drift check a shared import cannot give.
 */
export const BUILT_IN_LANGUAGE_CODES = Object.freeze([
  'en',
  'zh',
  'ja',
  'ko',
  'de',
  'fr',
  'es',
  'pt',
  'ru',
  'ar',
]);

/**
 * The one catalogue that is statically resident, and therefore the one eager
 * catalogue this gate admits. Pinned against
 * `DEFAULT_BUILT_IN_LANGUAGE` by this gate's unit test.
 */
export const ACTIVE_CATALOGUE = 'en';

/**
 * The chunk-name prefix `apps/console/vite.config.ts` gives each catalogue's
 * `advancedChunks` group. Ten groups, ten single-module chunks; see that file
 * for why it is not one group.
 */
export const CATALOGUE_CHUNK_PREFIX = 'i18n-locale-';

const DIST_DIR = path.join(repoRoot, 'apps', 'console', 'dist');
const REPORT_PATH = path.join(DIST_DIR, 'eager-closure.json');
const ASSETS_DIR = path.join(DIST_DIR, 'assets');

/** `i18n-locale-zh-Bx9f1.js` -> `zh`; anything else -> `null`. */
export function catalogueCodeOfChunkName(name) {
  if (typeof name !== 'string' || !name.startsWith(CATALOGUE_CHUNK_PREFIX)) return null;
  const code = name.slice(CATALOGUE_CHUNK_PREFIX.length);
  return BUILT_IN_LANGUAGE_CODES.includes(code) ? code : null;
}

/**
 * `assets/i18n-locale-zh-Bx9f1.js` -> `zh`; anything else -> `null`.
 *
 * ⛔ The hash segment is NOT constrained to hyphen-free text, and the premise
 * that it could be was measured false. Rolldown names a chunk with a
 * **base64url** content hash, whose alphabet includes `-` and `_`. Measured on
 * one console build of objectui#9078: `i18n-locale-de-cTrdGXD-.js`,
 * `i18n-locale-fr-CH3jagZ-.js` and `i18n-locale-zh-Ixe-DTac.js` were emitted
 * alongside seven siblings whose hashes happened to draw no `-`. A matcher
 * spelled `${code}-[^-]+\\.js$` read exactly those three as `null`, so the gate
 * reported three catalogues "emitted under no `i18n-locale-<code>` chunk at
 * all" while all three sat in `assets/`. Which codes fail is decided by the
 * content hash, i.e. by chance, and it re-rolls whenever a pack's bytes change
 * — so this gate went red on roughly a third of the packs in any build that
 * touched one, and green in the next build for no reason it could name.
 *
 * ⭐ What the old spelling actually bought is kept, by a different means. Its
 * comment gave the reason as "`i18n-locale-en-*.js` cannot be read as some
 * other code's chunk" — a real ambiguity, but one about the CODE, not the
 * hash: it appears only when one code is a prefix of another followed by `-`,
 * e.g. a future regional `zh-CN` beside `zh`. So the remainder is matched
 * against the declared code list LONGEST FIRST, which resolves that case
 * correctly (`zh-CN-<hash>.js` reads as `zh-CN`) and is indifferent to what
 * the hash contains.
 */
export function catalogueCodeOfFileName(fileName) {
  if (typeof fileName !== 'string') return null;
  const base = path.basename(fileName);
  if (!base.startsWith(CATALOGUE_CHUNK_PREFIX) || !base.endsWith('.js')) return null;
  const rest = base.slice(CATALOGUE_CHUNK_PREFIX.length, -'.js'.length);
  // Longest first, so a code that is a prefix of another never wins over it.
  const byLength = [...BUILT_IN_LANGUAGE_CODES].sort((a, b) => b.length - a.length);
  for (const code of byLength) {
    // A hash must actually follow: `i18n-locale-zh.js` names no chunk here.
    if (rest.startsWith(`${code}-`) && rest.length > code.length + 1) return code;
  }
  return null;
}

/**
 * The verdict, as data, so the unit test can drive every branch without a
 * console build.
 *
 * @param report parsed `eager-closure.json`, or `null` if it could not be read
 * @param emittedChunkFiles every file name in `apps/console/dist/assets/`
 */
export function evaluateEagerCatalogues(report, emittedChunkFiles) {
  if (!report || report.reportVersion !== 2 || !Array.isArray(report.files)) {
    return {
      status: 'error',
      message:
        `PREREQUISITE NOT MET: \`${path.relative(repoRoot, REPORT_PATH)}\` is missing or is not a ` +
        `v2 report, so no catalogue was weighed. This gate reads a BUILT bundle — run ` +
        `\`pnpm --filter @object-ui/console build\` (or \`pnpm build\`) first. ⛔ This is NOT a ` +
        `pass: a gate that cannot run is not a gate that ran clean.`,
      eager: [],
      lazy: [],
    };
  }

  // Counter-probe 1 — every catalogue must have been EMITTED as its own chunk.
  // A code with no chunk of its own is not a lazy catalogue; it is a catalogue
  // this gate has lost track of, and the verdict below would read its absence
  // from the eager set as good news.
  const emittedCodes = new Set(
    emittedChunkFiles.map((f) => catalogueCodeOfFileName(f)).filter((c) => c !== null),
  );
  const missing = BUILT_IN_LANGUAGE_CODES.filter((code) => !emittedCodes.has(code));
  if (missing.length > 0) {
    return {
      status: 'error',
      message:
        `counter-probe failed: ${missing.length} of ${BUILT_IN_LANGUAGE_CODES.length} catalogues ` +
        `were emitted under no \`${CATALOGUE_CHUNK_PREFIX}<code>\` chunk at all — ` +
        `${missing.join(', ')}. Either \`advancedChunks\` in \`apps/console/vite.config.ts\` no ` +
        `longer names them one group per code, or the catalogue was merged into a neighbour. ` +
        `Until that is fixed this gate is matching nothing, and matching nothing agrees with ` +
        `everything. (emitted: ${[...emittedCodes].join(', ') || 'NONE'})`,
      eager: [],
      lazy: [],
    };
  }

  const eagerCodes = new Set(
    report.files.map((f) => catalogueCodeOfChunkName(f?.name)).filter((c) => c !== null),
  );

  // Counter-probe 2 — the RESIDENT catalogue must be eager. It is statically
  // imported by `locales/registry.ts`, which the package entry reaches, so it
  // is eager by construction. Its absence means this walk is reading the graph
  // wrongly, not that the bundle improved — and "no catalogue is eager" is
  // exactly what a broken walk prints.
  if (!eagerCodes.has(ACTIVE_CATALOGUE)) {
    return {
      status: 'error',
      message:
        `counter-probe failed: the resident catalogue \`${ACTIVE_CATALOGUE}\` is NOT in the eager ` +
        `closure. \`packages/i18n/src/locales/registry.ts\` imports it statically and the package ` +
        `entry re-exports it, so it is eager by construction. Fix the walk — or the chunk naming — ` +
        `before reading the verdict below; a walk that finds no catalogues at all prints the same ` +
        `green tick as a bundle that has none. (eager catalogue chunks: ` +
        `${[...eagerCodes].join(', ') || 'NONE'})`,
      eager: [],
      lazy: [],
    };
  }

  const offenders = [...eagerCodes].filter((code) => code !== ACTIVE_CATALOGUE).sort();
  const lazy = BUILT_IN_LANGUAGE_CODES.filter((code) => !eagerCodes.has(code));

  if (offenders.length > 0) {
    return {
      status: 'fail',
      message:
        `${offenders.length} non-resident locale catalogue(s) are in the console's EAGER closure: ` +
        `${offenders.join(', ')}. Every page load now fetches them, in every language, for a ` +
        `viewer who reads one. The usual causes, in the order they are worth checking: a static ` +
        `re-export restored in \`packages/i18n/src/index.ts\`; a page-load module importing ` +
        `\`@object-ui/i18n/locales\` (the all-ten door) instead of \`loadBuiltInLocale\`; or an ` +
        `\`advancedChunks\` group in \`apps/console/vite.config.ts\` that merges catalogues into ` +
        `one chunk, which makes all of its members eager as soon as one of them is. ` +
        `⛔ Raising a byte ceiling does not address this and is not the remedy.`,
      eager: offenders,
      lazy,
    };
  }

  return {
    status: 'pass',
    message:
      `Exactly one locale catalogue is eager — \`${ACTIVE_CATALOGUE}\`, the resident fallback — ` +
      `and the other ${lazy.length} are fetched on demand: ${lazy.join(', ')}.`,
    eager: [],
    lazy,
  };
}

/** Gzipped size of an emitted chunk, or `null` when it cannot be read. */
function gzipBytesOf(fileName) {
  try {
    return zlib.gzipSync(fs.readFileSync(path.join(ASSETS_DIR, fileName))).length;
  } catch {
    return null;
  }
}

export function main() {
  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  } catch {
    report = null;
  }

  let emitted = [];
  try {
    emitted = fs.readdirSync(ASSETS_DIR);
  } catch {
    emitted = [];
  }

  const verdict = evaluateEagerCatalogues(report, emitted);

  if (verdict.status === 'pass') console.log(`✅ ${verdict.message}`);
  else console.error(`${verdict.status === 'error' ? '⚠️ ' : '❌'} ${verdict.message}`);

  // The sizes are printed on a PASS too. What this gate saves is only legible
  // as a number, and a gate that prints nothing when it passes is one nobody
  // can tell apart from a gate that was switched off.
  //
  // ⛔ Each row is labelled from the EAGER SET, never from its code. Labelling
  // "on demand" by `code !== ACTIVE_CATALOGUE` reads correctly on a healthy
  // build and lies on exactly the build this gate exists to report: an ablation
  // that made `zh` eager printed a red verdict naming `zh` above a table
  // calling it "on demand". The same table then has to stop claiming a saving
  // it did not make, so the deferred total counts the LAZY rows.
  if (verdict.status !== 'error') {
    const eagerCodes = new Set(
      (report?.files ?? []).map((f) => catalogueCodeOfChunkName(f?.name)).filter((c) => c !== null),
    );
    const rows = [];
    for (const file of emitted) {
      const code = catalogueCodeOfFileName(file);
      if (!code) continue;
      rows.push({ code, file, gz: gzipBytesOf(file), eager: eagerCodes.has(code) });
    }
    rows.sort((a, b) => (b.gz ?? 0) - (a.gz ?? 0));
    const lazyRows = rows.filter((r) => !r.eager);
    const deferred = lazyRows.reduce((sum, r) => sum + (r.gz ?? 0), 0);
    console.log('');
    console.log('Locale catalogue chunks (gzipped):');
    for (const row of rows) {
      const mark = row.eager
        ? row.code === ACTIVE_CATALOGUE
          ? 'EAGER (resident)'
          : 'EAGER — ⛔ this is the defect'
        : 'on demand';
      const kb = row.gz === null ? '     ?' : `${(row.gz / 1024).toFixed(1)} KB`;
      console.log(`  ${kb.padStart(9)}  ${row.code.padEnd(3)} ${mark}`);
    }
    console.log(
      `  ${(deferred / 1024).toFixed(1)} KB gzipped is deferred — the ${lazyRows.length} ` +
        `catalogue(s) a page load does not fetch.`,
    );
  }

  if (verdict.status === 'error') return 2;
  return verdict.status === 'fail' ? 1 : 0;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main());
}
