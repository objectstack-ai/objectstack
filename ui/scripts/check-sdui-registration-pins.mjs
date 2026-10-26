#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-sdui-registration-pins -- the registrations a `sideEffects` array
 * PROMISES to keep must still be in the built console.
 *
 *   node scripts/check-sdui-registration-pins.mjs          # the verdict
 *   node scripts/check-sdui-registration-pins.mjs --list   # the derived key set
 *
 * Run it after `pnpm --filter @object-ui/console build`; it weighs
 * `apps/console/dist/assets/*.js`.
 *
 * ## Why a second gate, on the ARTIFACT (objectui#6683)
 *
 * `scripts/check-side-effects-array.mjs` is a static gate: it proves the array
 * agrees with the module bodies. It cannot prove the one thing the hazard turns
 * on -- that a real bundler, reading that array, still emits the registrations.
 * That question has a wrong answer that is invisible from inside the source:
 * `"sideEffects": false` on `@object-ui/app-shell` is statically coherent and
 * DROPS three live SDUI widget registrations. Measured in objectui#6535 /
 * PR #6682: `mcp:connect-agent`, `cloud:onboarding-next` and
 * `cloud:ai-model-status` all fall to **0 chunks**, on a green build, with no
 * warning anywhere -- the barrel reaches them through bare side-effect imports,
 * and `false` licenses the bundler to skip exactly those.
 *
 * The maintainer ruling of 2026-08-29 names those three as the controls this
 * work must pin present at >= 1 chunk each. This file is that pin, and it is
 * wider than the three on purpose (see below). `cloud:onboarding-next` has
 * since retired with its widget (objectui#12954), so two of the three remain
 * as controls.
 *
 * ## The key set is DERIVED from the array, not listed here
 *
 * The ruling requires the enumeration to be re-derived mechanically rather than
 * copied. So the population is: every module the `sideEffects` array names, read
 * with `scripts/component-registrations.mjs` -- this tree's ONE answer to "which
 * component keys does this source register?". Change the array and the pinned
 * key set changes with it; there is no second list to keep honest.
 *
 * `RULED_CONTROLS` below is not that list. It is an ANTI-VACUITY FLOOR: the
 * keys the ruling names that are still registered, asserted to be IN the derived set, so a derivation that
 * quietly stopped seeing registrations cannot report "0 keys, all present".
 * A floor is checked against the derivation; a list would replace it.
 *
 * ## Every zero here is loud, in both directions
 *
 *   - a pinned key in 0 chunks   -> the array dropped a registration (exit 1)
 *   - no dist to read            -> exit 2. A gate that reports success over a
 *                                   tree it never measured is the failure mode
 *                                   of every budget gate in this repo.
 *   - 0 keys derived             -> exit 2, for the same reason: "all present"
 *                                   over an empty set is green for nothing.
 *   - the matcher cannot MISS    -> exit 2. A sentinel key that must be absent
 *                                   is searched for on every run, because a
 *                                   matcher that matches everything reports
 *                                   every key present and can never fail.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findComponentRegistrations } from './component-registrations.mjs';
import { deriveSpellingMap, readArrayPackages } from './check-side-effects-array.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_DIST = 'apps/console/dist/assets';

export const EXIT_OK = 0;
export const EXIT_DROPPED = 1;
export const EXIT_NO_MEASUREMENT = 2;

/**
 * The registrations the 2026-08-29 ruling names as this work's controls, each
 * measured at 0 chunks under `"sideEffects": false`. The ruling named three;
 * `cloud:onboarding-next` left with its widget (objectui#12954).
 *
 * ⚠️ This is a FLOOR on the derived set, never the set itself. It answers "is
 * the derivation still seeing the registrations the ruling cared about?", and
 * it is the only hand-written key list in this gate for that reason.
 */
export const RULED_CONTROLS = Object.freeze([
  'cloud:ai-model-status',
  'mcp:connect-agent',
]);

/**
 * A key that must be found in ZERO chunks. Its absence is what proves the
 * matcher below can return zero at all — without it, a matcher that reported
 * every key present would pass every assertion in this file forever.
 */
export const NEGATIVE_CONTROL_KEY = 'objectui:6683-registration-pin-negative-control';

/**
 * `pkg.declared`, ordered so a module's SOURCE spelling is read before its
 * PUBLISHED spelling.
 *
 * ## Why the order is fixed here rather than left to the array (objectui#6893)
 *
 * A `sideEffects` array names every registering module TWICE -- once as
 * `src/x.tsx`, once as `dist/x.js` (see `check-side-effects-array.mjs`: both
 * spellings are required, because consumers resolve the published one and
 * in-repo bundler aliases resolve the source one). {@link derivePinnedKeys}
 * attributes each key to the FIRST module it read the key from, so without an
 * order of its own the attribution was decided by two things that have nothing
 * to say about it: the literal order of the entries in `package.json`, and
 * whether `dist/` happens to be on disk. `packages/app-shell/dist` is
 * gitignored, so the SAME COMMIT attributed `mcp:connect-agent` to
 * `.../src/console/connect/ConnectAgentWidget.tsx` on an unbuilt checkout and to
 * `.../dist/console/connect/ConnectAgentWidget.js` on a built one.
 *
 * The published spelling is still READ -- `keys` is a union deduplicated by key,
 * so reordering cannot change the derived population, only which spelling is
 * reported for it. Source-first is the right end of that choice because the
 * attribution is a diagnostic pointing an author at the module to go fix, and
 * `dist/` is a build artifact nobody edits.
 *
 * `srcRoot` comes from the package's own derived spelling map rather than from a
 * hardcoded `dist` test, so there is no second answer here to "which prefix is
 * the source one" that could rot away from the one `check-side-effects-array`
 * derives and round-trip-checks.
 *
 * @param {{name: string, dir: string, manifest: object, declared: string[]}} pkg
 * @param {string} [root]
 * @returns {string[]}
 */
export function sourceFirstEntries(pkg, root = REPO_ROOT) {
  const map = deriveSpellingMap(pkg, root);
  if (map.error) {
    // Falling back to the array's own order would restore exactly the
    // build-state-dependent attribution above, and it would do it silently.
    // `scripts/check-side-effects-array.mjs` owns this condition and already
    // reports it as exit 2, so a workspace that reaches here is red there too.
    throw new Error(
      `${pkg.name}: this gate cannot tell the package's source spelling from its published one — ` +
        `${map.error}. Without that, the key attribution below falls back to array order, which is what ` +
        `made this derivation answer differently on a built and an unbuilt checkout (objectui#6893).`,
    );
  }
  const isSource = (entry) => entry === map.srcRoot || entry.startsWith(`${map.srcRoot}/`);
  return [...pkg.declared.filter(isSource), ...pkg.declared.filter((entry) => !isSource(entry))];
}

/**
 * Every component key registered by a module some package's `sideEffects` array
 * names. Derived; see the header.
 *
 * The per-package read order is {@link sourceFirstEntries}, so `sources`
 * answers the same spelling whether or not the tree has been built.
 *
 * @param {string} [root]
 * @returns {{keys: string[], sources: Map<string, string>, unreadable: string[], modulesRead: number}}
 */
export function derivePinnedKeys(root = REPO_ROOT) {
  const keys = [];
  const sources = new Map();
  const unreadable = [];
  let modulesRead = 0;

  for (const pkg of readArrayPackages(root)) {
    for (const entry of sourceFirstEntries(pkg, root)) {
      if (!/\.(ts|tsx|mts|js|jsx|mjs)$/.test(entry)) continue;
      const abs = path.join(root, pkg.dir, entry);
      if (!fs.existsSync(abs)) continue; // a `dist/*` spelling in an unbuilt tree
      modulesRead += 1;
      const rel = `${pkg.dir}/${entry}`;
      const scan = findComponentRegistrations(fs.readFileSync(abs, 'utf8'));
      for (const call of scan.unreadable) {
        unreadable.push(`${rel}:${call.line}: ${call.text}`);
      }
      for (const key of scan.keys) {
        if (!sources.has(key)) {
          keys.push(key);
          sources.set(key, rel);
        }
      }
    }
  }

  return { keys: keys.sort(), sources, unreadable, modulesRead };
}

/** The emitted JS chunks of a console build, absolute paths. */
export function readChunks(distDir) {
  if (!fs.existsSync(distDir)) return undefined;
  return fs
    .readdirSync(distDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(distDir, f));
}

/**
 * How many chunks carry `key` as a QUOTED string literal.
 *
 * Quoted rather than a bare substring: a registry key like `attachments` occurs
 * inside unrelated identifiers and prose all over a bundle, and a matcher that
 * counted those would report every key present whatever the bundler did.
 * Minified output uses whichever quote rolldown picked, so all three are tried.
 */
export function countChunksCarrying(chunkFiles, key, read = (f) => fs.readFileSync(f, 'utf8')) {
  const needles = [`'${key}'`, `"${key}"`, `\`${key}\``];
  let found = 0;
  for (const file of chunkFiles) {
    const code = read(file);
    if (needles.some((n) => code.includes(n))) found += 1;
  }
  return found;
}

/**
 * @param {string[]} [argv]
 * @param {string} [root]
 * @param {readonly string[]} [controls] the anti-vacuity FLOOR on the derived key
 *   set. Defaults to {@link RULED_CONTROLS}; a fixture workspace passes its own,
 *   so the floor stays under test rather than being switched off to test around it.
 */
export function main(argv = process.argv.slice(2), root = REPO_ROOT, controls = RULED_CONTROLS) {
  const { keys, sources, unreadable, modulesRead } = derivePinnedKeys(root);

  if (unreadable.length > 0) {
    console.error(
      '❌ A module named in a `sideEffects` array registers a key this reader cannot read:\n' +
        unreadable.map((u) => `   ${u}`).join('\n') +
        '\n\n   Returning the readable keys and dropping this one is the objectui#4894 failure: the dropped key\n' +
        '   would simply never be asserted, and this gate would go green without ever weighing it. Write the\n' +
        '   key as a plain string literal, or teach scripts/component-registrations.mjs to resolve this form.',
    );
    return EXIT_NO_MEASUREMENT;
  }

  if (keys.length === 0) {
    console.error(
      `❌ No registration keys were derived from any \`sideEffects\` array (${modulesRead} module(s) read).\n` +
        '   "Every pinned key is present" over an empty set is green for an empty reason, which is the exact\n' +
        '   shape this gate exists to reject.',
    );
    return EXIT_NO_MEASUREMENT;
  }

  const missingControls = controls.filter((k) => !sources.has(k));
  if (missingControls.length > 0) {
    console.error(
      `❌ The derivation no longer sees ${missingControls.length} of the controls this gate pins:\n` +
        missingControls.map((k) => `   ${k}`).join('\n') +
        '\n\n   These are a FLOOR on the derived set, not the set itself. Either a `sideEffects` array stopped\n' +
        '   naming the module that registers the key — which is the silent drop, and must be fixed rather\n' +
        '   than re-pinned — or the reader has stopped seeing it.',
    );
    return EXIT_NO_MEASUREMENT;
  }

  if (argv.includes('--list')) {
    console.log(`${keys.length} key(s) derived from ${modulesRead} module(s) named by a \`sideEffects\` array:`);
    for (const key of keys) console.log(`   ${key.padEnd(28)} ${sources.get(key)}`);
    return EXIT_OK;
  }

  const distDir = path.join(root, DEFAULT_DIST);
  const chunks = readChunks(distDir);
  if (chunks === undefined || chunks.length === 0) {
    console.error(
      `❌ No console build to weigh at ${DEFAULT_DIST}.\n` +
        '   This is exit 2, not a pass: the registrations this gate pins are dropped by a WRONG ARRAY at\n' +
        '   BUNDLE time, so a run with nothing to read has measured nothing. Build the console first:\n' +
        '     pnpm --filter @object-ui/console build',
    );
    return EXIT_NO_MEASUREMENT;
  }

  // The matcher must be able to return zero, or every assertion below is
  // unfalsifiable.
  const sentinel = countChunksCarrying(chunks, NEGATIVE_CONTROL_KEY);
  if (sentinel !== 0) {
    console.error(
      `❌ The negative control ${NEGATIVE_CONTROL_KEY} was found in ${sentinel} chunk(s).\n` +
        '   Nothing registers it, so a matcher that finds it finds everything — and a gate whose matcher\n' +
        '   cannot miss reports every key present whatever the bundler did.',
    );
    return EXIT_NO_MEASUREMENT;
  }

  const dropped = [];
  const table = [];
  for (const key of keys) {
    const count = countChunksCarrying(chunks, key);
    table.push({ key, count, source: sources.get(key) });
    if (count === 0) dropped.push({ key, source: sources.get(key) });
  }

  for (const row of table) {
    console.log(`  ${row.count === 0 ? '❌' : '✅'} ${row.key.padEnd(28)} ${String(row.count).padStart(2)} chunk(s)   ${row.source}`);
  }

  if (dropped.length > 0) {
    console.error(
      `\n❌ ${dropped.length} SDUI registration(s) named by a \`sideEffects\` array are in ZERO chunks of the\n` +
        `   built console. The array told the bundler those modules were droppable and it dropped them —\n` +
        `   silently, on a green build, exactly as \`"sideEffects": false\` does (objectui#6535/#6683).\n` +
        dropped.map((d) => `   - ${d.key} (registered by ${d.source})`).join('\n'),
    );
    return EXIT_DROPPED;
  }

  console.log(
    `✅ All ${keys.length} registration(s) a \`sideEffects\` array promises are present in the built console ` +
      `(${chunks.length} chunks weighed; the ${controls.length} ruled control(s) are in the derived set).`,
  );
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main());
}
