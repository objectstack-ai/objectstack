#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-element-data-source-declaration -- a block that WRAPS the runtime gate
 * must go through the seam that DECLARES the key the gate reads
 * (objectui#6678).
 *
 *   node scripts/check-element-data-source-declaration.mjs          # the verdict
 *   node scripts/check-element-data-source-declaration.mjs --list   # the sites
 *
 * ## What this is the mechanical half of
 *
 * `PageComponentSchema.dataSource` is the spec's per-element data binding and
 * the one spelling that resolves a saved view for an object-bound block. It is
 * READ by `ElementDataSourceGate` in `@object-ui/react` on behalf of every block
 * that wraps itself in the gate. It was DECLARED by none of them, so the html
 * tier reported the one key that works with the same `unknown-prop` warning it
 * gives the spellings that do nothing -- on the tier built to accept AI-authored
 * pages, where the diagnostic IS the contract.
 *
 * The maintainer ruling of 2026-08-29 took option B **in the injection form**:
 * the declaration is emitted mechanically at the wrapping seam, from the same
 * place that reads the key, rather than hand-written once per block. Nine
 * hand-kept copies is what that ruling refused -- copies drift, and the tenth
 * block forgets.
 *
 * The emission is `Registry.register` -> `withElementDataSourceInput`, keyed on
 * the renderer having passed through `elementDataSourceBlock()`. That is one
 * mechanism and one copy of the declaration. What it cannot do by itself is
 * notice a block that starts wrapping the gate WITHOUT passing through the seam
 * -- and that block would publish a page-authoring surface missing the one key
 * its own runtime honours, silently, exactly as before. So the "cannot forget"
 * half is this gate: wrapping the gate and skipping the seam is a red build, not
 * a discovery six months later.
 *
 * ## The rule, and why it is stated over FILES
 *
 * A source file that CONSUMES the gate must also call `elementDataSourceBlock(`.
 *
 * "Consumes" is wider than the JSX tag on purpose, and that width was measured
 * rather than guessed: `element:record_picker` reads the binding through
 * `useElementDataSource` and renders the gate's own status panels WITHOUT the
 * `<ElementDataSourceGate>` wrapper -- its object lives under `properties`, so
 * there is no schema key for the gate to write. A rule that only knew the tag
 * would have declared that file compliant while it published exactly the defect
 * this work closes. It was found by the render probe in
 * `apps/console/src/__tests__/element-data-source-input-injection.test.tsx`,
 * which detects the gate's panels and does not care how they got there, and the
 * rule here was widened to the family the probe actually sees.
 *
 * Prose does not count: the population is read through
 * `scripts/js-comment-mask.mjs`, the tree's one answer to "comment, or code?".
 * Three modules discuss `useElementDataSourceSchema` in docblocks without
 * consuming it, and a naive reader would have demanded the seam from all three.
 *
 * File granularity is deliberate and it is the honest limit of a static reader:
 * matching a particular use site to the particular renderer that encloses it
 * needs a TypeScript parse, and a reader that guesses would fail in the
 * direction that matters (a wrong pairing reads as compliance). A file that
 * consumes the gate twice and marks once is therefore NOT caught here -- it is
 * caught by the render probe above, which reads the LIVE registry and needs no
 * parsing at all. The two together are complete; neither is alone.
 *
 * ## Both zeroes are loud
 *
 *   - a file wraps the gate and never reaches the seam  -> exit 1
 *   - ZERO gate-wrapping files found                    -> exit 2. "All
 *     compliant" over an empty population is green for nothing, and this reader
 *     going blind (a rename, a moved package root) looks exactly like a repo
 *     that stopped using the gate.
 *   - the DEFINING package is excluded, and the exclusion is asserted to
 *     exclude something AND to be incapable of hiding a consumer: a filter that
 *     matched nothing would leave the definition sites in the population and
 *     demand they mark themselves, and one that matched too much would silently
 *     stop checking. `@object-ui/react` registers no component, so anything it
 *     excludes cannot be a registration this gate is about -- and that premise
 *     is CHECKED rather than trusted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskComments } from './js-comment-mask.mjs';
import { findComponentRegistrations } from './component-registrations.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PACKAGES = path.join(ROOT, 'packages');

/**
 * Consuming the gate -- the act this check is about, in every form the render
 * probe can see: the wrapper tag, the hook the wrapper is built on, and the two
 * status panels a block renders when it drives the resolution itself.
 */
const CONSUMES_GATE = /<ElementDataSourceGate[\s>]|\buseElementDataSourceSchema\b|\buseElementDataSource\b|\bElementDataSource(Error|Loading)Panel\b/;
/** The seam that makes a consuming renderer declare the key. */
const REACHES_SEAM = /\belementDataSourceBlock\s*[(<]/;

/**
 * Where the seam must be imported FROM at a call site.
 *
 * It is one function under one name, exported by `@object-ui/core` (where the
 * marker and the declaration live) and re-exported by `@object-ui/react` beside
 * the gate for discoverability. Call sites must take the CORE one, and that is a
 * measured rule rather than a stylistic one: a registration runs at MODULE
 * SCOPE, 101 suites in this repo partially mock `@object-ui/react` by
 * hand-listing the exports they return, and a module-scope read of a name absent
 * from such a list throws at COLLECTION time -- the importing test file dies
 * before running a single assertion, so the failure arrives as an unexplained
 * red suite rather than as a failed expectation. Taking the seam from
 * `@object-ui/react` reddened 17 files across all four CI shards, with zero
 * failed assertions among them. Nothing in this repo mocks `@object-ui/core`,
 * and every registration module already imports `ComponentRegistry` from it, so
 * the core path adds no coupling that was not already there.
 */
const SEAM_FROM_CORE = /import\s*\{[^}]*\belementDataSourceBlock\b[^}]*\}\s*from\s*['"]@object-ui\/core['"]/;

/**
 * The package that DEFINES the gate, its hook and its panels, and exports the
 * seam. Demanding that a definition mark itself would be nonsense; it is safe to
 * exclude precisely because `@object-ui/react` registers no component, which is
 * asserted below rather than assumed.
 */
const DEFINING_PACKAGE = `${path.join('packages', 'react', 'src')}${path.sep}`;

const isTest = (rel) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || /(^|[\\/])__tests__[\\/]/.test(rel);

function* sources(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(full);
    else if (/\.tsx?$/.test(entry.name)) yield full;
  }
}

/**
 * Named HOSTS that consume the gate without being a registration -- one file
 * each, with its reason, and never a pattern or a directory.
 *
 * The rule above is stated over files because a static reader cannot pair a
 * use site with the renderer that encloses it. Its honest limit is a file that
 * consumes the gate and registers nothing at all: there is no registration for
 * the seam to mark, and no `dataSource` input it could publish. An entry here
 * is that limit, written down for exactly one file (the seat ruling on
 * objectui#12931, comment 6272155387).
 *
 * ⭐ SELF-LIMITING: an entry holds only while its file, read through
 * `scripts/js-comment-mask.mjs`, registers no component -- no
 * `ComponentRegistry.register(` and no bare `register(` call. The moment the
 * file registers one, it is judged like every other consumer and the seam is
 * demanded again. An entry whose file no longer consumes the gate is stale and
 * fails the run (exit 2), so the list cannot outlive what it excuses.
 */
export const HOST_EXEMPTIONS = Object.freeze({
  'packages/app-shell/src/views/PageView.tsx':
    'page host: resolves the page-level `PageSchema.record` binding (objectstack#24265, objectui#12931), ' +
    'a key the spec declares on the page itself; it registers no block, so there is no input for the seam to publish',
});

/** A registration in masked code: the registry call, or any bare `register(` call. */
const BARE_REGISTER_CALL = /(?<![\w$])register\s*\(/;

/** Does masked `code` register a component? Either form counts; a string mention errs toward "yes". */
export function registersComponent(code) {
  return findComponentRegistrations(code).calls > 0 || BARE_REGISTER_CALL.test(code);
}

/**
 * Judge one gate-consuming file (repo-relative POSIX path, comment-masked text).
 * `host` carries the exemption's reason when -- and only when -- the file is a
 * named host that registers nothing.
 */
export function judgeSite(rel, code) {
  const posix = rel.split(path.sep).join('/');
  const reason = Object.hasOwn(HOST_EXEMPTIONS, posix) ? HOST_EXEMPTIONS[posix] : undefined;
  const host = reason !== undefined && !registersComponent(code) ? reason : undefined;
  const reachesSeam = REACHES_SEAM.test(code);
  return {
    rel,
    host,
    reachesSeam,
    // Only meaningful for a file that actually calls the seam.
    seamFromCore: !reachesSeam || SEAM_FROM_CORE.test(code),
  };
}

function main() {
const wrapping = [];
const excluded = [];
for (const full of sources(PACKAGES)) {
  const rel = path.relative(ROOT, full);
  if (isTest(rel)) continue;
  // Prose is not consumption -- several modules name the hook in docblocks only.
  const text = maskComments(fs.readFileSync(full, 'utf8'));
  if (!CONSUMES_GATE.test(text)) continue;
  if (rel.startsWith(DEFINING_PACKAGE)) {
    excluded.push({ rel, registers: findComponentRegistrations(text).calls });
    continue;
  }
  wrapping.push(judgeSite(rel, text));
}

if (process.argv.includes('--list')) {
  for (const site of wrapping.sort((a, b) => a.rel.localeCompare(b.rel))) {
    if (site.host) {
      console.log(`HOST ${site.rel} -- exempt while it registers no component: ${site.host}`);
      continue;
    }
    const verdict = !site.reachesSeam ? 'MISS' : !site.seamFromCore ? 'FROM-REACT' : 'ok  ';
    console.log(`${verdict} ${site.rel}`);
  }
}

if (wrapping.length === 0) {
  console.error(
    'check-element-data-source-declaration: found ZERO files that consume ElementDataSourceGate.\n' +
      'That is reported as a failure, not a pass: every assertion below is an absence, and an\n' +
      'absence over an empty population is green for nothing. Either the gate is genuinely gone\n' +
      '(then this gate should be deleted, deliberately), or this reader has stopped seeing it.',
  );
  process.exit(2);
}

if (excluded.length === 0) {
  console.error(
    'check-element-data-source-declaration: the defining-package exclusion matched NOTHING.\n' +
      `Path is stale (${DEFINING_PACKAGE}). A filter that matches nothing silently stops excluding,\n` +
      "so the gate's own definition sites would be told to mark themselves.",
  );
  process.exit(2);
}

const hidden = excluded.filter((f) => f.registers > 0);
if (hidden.length > 0) {
  console.error(
    'check-element-data-source-declaration: the defining-package exclusion is hiding a REGISTRATION:\n' +
      hidden.map((f) => `  ${f.rel} (${f.registers} register call(s))`).join('\n') +
      '\n\nThe exclusion is sound only while that package registers no component. It now does, so the\n' +
      'exclusion has stopped being "definitions only" and has started suppressing the very thing this\n' +
      'gate checks. Narrow it to the definition modules, or move the registration out.',
  );
  process.exit(2);
}

const consuming = new Set(wrapping.map((s) => s.rel.split(path.sep).join('/')));
const stale = Object.keys(HOST_EXEMPTIONS).filter((rel) => !consuming.has(rel));
if (stale.length > 0) {
  console.error(
    'check-element-data-source-declaration: a HOST_EXEMPTIONS entry names a file that no longer consumes the gate:\n' +
      stale.map((rel) => `  ${rel}`).join('\n') +
      '\n\nDelete the entry: an exemption may not outlive the consumption it excuses.',
  );
  process.exit(2);
}

const missing = wrapping.filter((s) => !s.host && !s.reachesSeam);
if (missing.length > 0) {
  console.error(
    `check-element-data-source-declaration: ${missing.length} file(s) consume ElementDataSourceGate\n` +
      'without passing their registered renderer through the seam:\n' +
      missing.map((s) => `  ${s.rel}`).join('\n') +
      '\n\n' +
      'The gate READS `PageComponentSchema.dataSource`. A block that consumes it and skips the seam\n' +
      'publishes an authoring surface with no `dataSource` input, so the html tier reports the one\n' +
      'spelling that resolves a saved view as `unknown-prop` -- objectui#6678, on the tier where the\n' +
      'diagnostic is the contract.\n\n' +
      'Fix: wrap the RENDERER this file registers in `elementDataSourceBlock(...)`, imported from\n' +
      '@object-ui/core (see the import-source rule below -- @object-ui/react re-exports the same\n' +
      'function, but a module-scope read of it breaks every suite that mocks that package). The\n' +
      'declaration itself is emitted by Registry.register; do not write a `dataSource` input by\n' +
      'hand -- hand-kept copies is the shape the 2026-08-29 ruling refused.',
  );
  process.exit(1);
}

const fromReact = wrapping.filter((s) => !s.host && s.reachesSeam && !s.seamFromCore);
if (fromReact.length > 0) {
  console.error(
    `check-element-data-source-declaration: ${fromReact.length} file(s) import the seam from\n` +
      '@object-ui/react instead of @object-ui/core:\n' +
      fromReact.map((s) => `  ${s.rel}`).join('\n') +
      '\n\n' +
      'It is the same function under the same name, so this is not a naming preference. A\n' +
      'registration runs at MODULE SCOPE, and 101 suites here partially mock @object-ui/react by\n' +
      'hand-listing the exports they return: a module-scope read of a name absent from such a list\n' +
      'throws at COLLECTION time, so the importing test file dies before running one assertion.\n' +
      'Measured on objectui#6678: 17 files red across all four CI shards, zero failed assertions.\n\n' +
      "Fix: import { elementDataSourceBlock } from '@object-ui/core'. Nothing mocks that package,\n" +
      'and every registration module already imports ComponentRegistry from it.',
  );
  process.exit(1);
}

const hosts = wrapping.filter((s) => s.host).length;
console.log(
  `check-element-data-source-declaration: OK — ${wrapping.length} gate-consuming file(s) checked, `
    + `${excluded.length} definition file(s) excluded, ${hosts} named host(s) exempt (registering nothing); `
    + 'the rest reach the seam and take it from core.',
);
}

if (isEntrypoint(import.meta.url)) main();
