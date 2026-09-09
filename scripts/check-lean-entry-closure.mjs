#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-lean-entry-closure — what a lean entry point ACTUALLY loads, measured
 * from a real load of the built artifact rather than read off its source.
 *
 *   node scripts/check-lean-entry-closure.mjs             # the gate
 *   node scripts/check-lean-entry-closure.mjs --list      # the measured closure, per condition
 *   node scripts/check-lean-entry-closure.mjs --self-test # verify the checker
 *
 * ## The gap this closes (#15347, found while measuring #14680)
 *
 * `packages/objectql/src/core-boundary.ratchet.test.ts` (ADR-0076 D2) is the
 * only thing guarding `@objectstack/objectql/core` today, and it guards it by
 * SCANNING SOURCE TEXT for two hard-coded names:
 *
 *     const FORBIDDEN_PACKAGES = ['@objectstack/metadata-protocol'];
 *     const FORBIDDEN_LOCAL = ['plugin', 'kernel-factory'];
 *
 * Two properties follow from that shape, and #14680 is what they cost. A
 * heavyweight arriving through ANY OTHER specifier is outside the scan by
 * construction — `@objectstack/metadata` is not on the list, so the import that
 * occasioned #14680 crossed nothing. And a scan of one package's own sources
 * cannot be TRANSITIVE: the regression arrived three packages deep, which is
 * the only way this class ever arrives. It was invisible for the whole time it
 * was live: no gate, test or CI job reported anything.
 *
 * ⛔ This gate does not replace that test and must not be read as doing so. The
 * source scan needs NOTHING — no build, no install, no child process — and that
 * is a property worth keeping exactly where it is. This one needs a built tree
 * (see PREREQUISITE below), which makes it a different kind of instrument for
 * the same boundary, not a better version of the same one.
 *
 * ## Why this asserts a SET and never a NUMBER (#9803)
 *
 * The neighbouring test's header argues at length, with commit-pinned evidence,
 * against selling this boundary with a figure: the old "268KB" was raw source
 * bytes of ONE FILE, was later re-pointed at a whole PACKAGE, and re-measuring
 * found a 21x spread straddling the quoted number in BOTH directions. Its
 * conclusion constrains what any new gate here may claim:
 *
 *   > The claim worth making is EXCLUSION, and the test below is what pins it.
 *
 * That is not a stale opinion this gate gets to revisit. It is also not merely
 * inherited here — it was re-measured on this gate's own subject, and the
 * measurement is the reason for the shape below.
 *
 * MEASURED 2026-09-08 on `origin/main` 70f7d6d735, `pnpm turbo run build
 * --filter=@objectstack/objectql`, one fresh child per published condition,
 * module set collected through `module.registerHooks` unioned with
 * `require.cache` (the method #15343 used). These figures are PROVENANCE for
 * the design decision — dated and tree-pinned, in the manner the neighbouring
 * test's header keeps its own — and they are ⛔ NOT a claim this gate makes or
 * re-measures:
 *
 *     condition          packages   modules   bytes
 *     import (ESM)             15       185   12,133,373
 *     require (CJS)            15       183   12,423,782
 *
 * One boundary, one tree, one day. The PACKAGE SET is identical across the two
 * published conditions. The module COUNT is not, and the byte total is not —
 * they differ by 2 and by 290,409 respectively, for reasons that have nothing
 * to do with the boundary (bundler chunking and the two flavours' differing
 * inlining). A module-count ratchet, the alternative #15347 names honestly,
 * would therefore have to pick one condition or carry two numbers, and would
 * move on every innocent change to either. The package set moves when, and only
 * when, a NEW PACKAGE enters the closure — which is exactly the event ADR-0076
 * D2 exists to notice.
 *
 * So: decidable, unit-carrying, and transitive. The unit is a package name.
 *
 * ## Why an ADMITTED set and not only a DENIED list
 *
 * #15347 prices its own sketch honestly: *"a forbidden-list gate still cannot
 * see a heavyweight nobody thought to list."* True, and it is the same defect
 * as the source scan's — one level up. A denial list is a set of names someone
 * already thought of; the #14680 class is precisely the arrival nobody thought
 * of.
 *
 * `ADMITTED_PACKAGES` closes it. The gate asserts SET EQUALITY against the
 * measured closure, so an unlisted arrival fails BY NAME with no one having had
 * to predict it, and a stale entry — a package that has left the closure — also
 * fails, so the set cannot rot into a list of things that used to be true.
 *
 * `DENIED_PACKAGES` is kept anyway, and it is not redundant. Set equality is
 * REPAIRED BY EDITING THE SET; that is what makes it a live instrument rather
 * than a wall, and it is the correct remedy for a genuinely new dependency. It
 * would also be a way to quietly re-admit the very packages ADR-0076 D2
 * excluded. So the denied names are checked separately, and `assertDisjoint()`
 * fails the gate outright if a name ever appears in both — widening cannot
 * reach them.
 *
 * ## PREREQUISITE — a built tree, and exit 3 when there is not one
 *
 * A loaded-module measurement needs the artifact that gets loaded. With no
 * `dist/` this exits 3 PREREQUISITE NOT MET, naming what was missing. ⛔ It
 * never skips and never passes: an unbuilt tree is NOT MEASURED, which is a
 * third answer, and collapsing it into "green" is the failure mode the whole
 * farm is built to refuse.
 *
 * That is also why this is a gate here and not a case in the vitest file it
 * guards beside. MEASURED on 70f7d6d735: `turbo run test
 * --filter=@objectstack/objectql --dry=json` schedules 16 tasks — 15 upstream
 * `build`s and `@objectstack/objectql#test` — and `@objectstack/objectql#build`
 * is NOT among them, because `test` declares `dependsOn: ["^build"]`. The
 * package's own `dist/` is therefore absent on exactly the run that would have
 * to enforce this, so a case living there would be permanently NOT MEASURED
 * (and, written the tempting way, permanently green). It runs in ci.yml's
 * `build-core` instead, which builds first — the same reason
 * `check:dual-build-cjs-loads` and `check:sourcemap-no-sources-content` live
 * there.
 *
 * ## Scope
 *
 * `GUARDED_ENTRIES` holds ONE entry, deliberately. #15346 measures a second
 * lean-entry promise (`@objectstack/metadata/errors`, 2.4 MB across 83 modules
 * standalone) and is the object a gate like this would measure — but it is a
 * separate card with a separate owner, and adding its row here would decide its
 * open question by writing down today's number as tomorrow's contract.
 *
 * ⛔ A second entry is NOT a one-row change, and an earlier revision of this
 * header said it was (#16980). The table row is the cheap half. The other half
 * is that `ADMITTED_PACKAGES` below is ONE set belonging to ONE entry: a second
 * entry measures its own closure and therefore needs its own admitted set, and
 * a package entering an admitted set is the ADR-0076 D2 boundary moving —
 * which is why every widening remedy this gate prints carries
 * `RATCHET_AUTHORITY_MARKER`. ⇒ Whoever owns a second entry owns a MAINTAINER
 * decision, not just a row. `resolveConditions()` reads both `exports`
 * spellings this workspace uses, so the row itself is at least honest now; that
 * is the part this header used to get wrong, not the price.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * POPULATION DECLARATION — what `scripts/pm/dispatch-gates.mjs` is told this
 * gate reads, in the subtree spelling that tool compares in. Provenance ONLY:
 * nothing in this file reads this array.
 *
 * The closure this gate measures is transitive, so the honest trigger surface
 * is wider than the entry's own package: a change anywhere in the closure can
 * add a package to it. It is declared as the guarded package plus the
 * workspace packages currently IN the closure, because a card touching any of
 * them can move this gate's verdict and should be told to run it.
 */
export const DECLARED_POPULATION = Object.freeze([
  'packages/objectql/**',
  'packages/spec/**',
  'packages/core/**',
  'packages/types/**',
  'packages/metadata/**',
  'packages/metadata-core/**',
  'packages/formula/**',
]);

/** The compliance token. Byte-identical to every instrumented gate's const (#8435). */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/** Exit code for "this gate could not run", kept distinct from pass and fail. */
const EXIT_PREREQUISITE_NOT_MET = 3;

/**
 * The lean entries under guard.
 *
 * `pkgDir` is the package holding the entry; `subpath` is the key in its
 * `exports` map. Conditions are read from the manifest rather than spelled
 * here, so a build-config change that re-points a condition is measured rather
 * than assumed.
 */
const GUARDED_ENTRIES = Object.freeze([
  Object.freeze({
    id: '@objectstack/objectql/core',
    pkgDir: 'packages/objectql',
    subpath: './core',
    adr: 'ADR-0076 D2',
  }),
]);

/**
 * The complete package set `@objectstack/objectql/core` may evaluate at
 * module-init, measured (see the header for tree and method).
 *
 * ⛔ THIS SET IS SHRINK-ONLY. It is not an inventory that grows as the code
 * grows: every name in it is weight every embedder of the lean entry pays, and
 * a name arriving here is the ADR-0076 D2 boundary moving. Removing a name as
 * the closure genuinely narrows is ordinary work and needs nobody's permission.
 *
 * Each row carries WHY the package is in the closure, so a reader can tell a
 * load-bearing dependency from one that drifted in.
 */
const ADMITTED_PACKAGES = Object.freeze({
  '@objectstack/objectql': 'the entry itself.',
  '@objectstack/spec': 'the authored-metadata contracts the engine validates against.',
  '@objectstack/core': 'shared runtime primitives.',
  '@objectstack/types': 'shared type-level surface with a small runtime tail.',
  '@objectstack/metadata': 'the leaf `errors` subpath only — the manager half is correctly absent (#15346).',
  '@objectstack/metadata-core': 'metadata primitives the registry reads; NOT the management protocol.',
  '@objectstack/formula': 'formula evaluation, reachable from the engine surface.',
  zod: 'the schema runtime `@objectstack/spec` is written in.',
  ajv: 'JSON Schema validation.',
  'ajv-formats': 'ajv format keywords.',
  'fast-uri': 'ajv dependency.',
  'fast-deep-equal': 'ajv dependency.',
  'json-schema-traverse': 'ajv dependency.',
  '@marcbachmann/cel-js': 'CEL expression evaluation, reached through the formula surface.',
  'pg-connection-string': 'reached from the shared runtime primitives.',
});

/**
 * Packages the lean entry must never load, whatever `ADMITTED_PACKAGES` says.
 *
 * The first is the ADR-0076 D2 boundary itself — the thing the neighbouring
 * source scan names, restated here where a transitive arrival is visible. The
 * rest are the filesystem/watcher tier a lean ENGINE entry has no business
 * loading; #15347 names them.
 *
 * ⛔ A name here may not also be admitted: `assertDisjoint()` fails the gate if
 * it is, so the admitted set cannot be edited into a re-admission.
 */
const DENIED_PACKAGES = Object.freeze({
  '@objectstack/metadata-protocol': 'ADR-0076 D2: the metadata-management layer the lean entry exists to exclude.',
  '@objectstack/metadata-fs': 'the filesystem tier of metadata — a lean engine entry never reads the disk.',
  chokidar: 'filesystem watcher tier.',
  readdirp: 'filesystem watcher tier.',
  glob: 'filesystem walk tier.',
  'js-yaml': 'the YAML machinery behind the loaders.',
});

// ── Measuring one condition ─────────────────────────────────────────────────

/**
 * The probe, as source for a fresh child process.
 *
 * `module.registerHooks` is registered BEFORE the entry is reached, so the load
 * hook sees every module node evaluates rather than a graph reconstructed after
 * the fact. The CJS flavour additionally unions `require.cache`, which is the
 * method #15343's measurement used and costs nothing to keep.
 *
 * The entry is loaded by ABSOLUTE PATH resolved from the manifest's `exports`
 * map — the same shape `check-dual-build-cjs-loads.mjs` uses, and the file a
 * consumer's `import` / `require` really reaches.
 *
 * @param {string} target absolute path to the condition's entry file
 * @param {'import' | 'require'} flavour
 * @returns {string} source for `node -e`
 */
export function probeSource(target, flavour) {
  const href = JSON.stringify(pathToFileURL(target).href);
  if (flavour === 'import') {
    return [
      "import { registerHooks } from 'node:module';",
      'const seen = new Set();',
      'registerHooks({ load(url, ctx, next) { seen.add(url); return next(url, ctx); } });',
      `await import(${href});`,
      'process.stdout.write(JSON.stringify([...seen]));',
    ].join('\n');
  }
  return [
    "const { registerHooks } = require('node:module');",
    "const { pathToFileURL } = require('node:url');",
    'const seen = new Set();',
    'registerHooks({ load(url, ctx, next) { seen.add(url); return next(url, ctx); } });',
    `require(${JSON.stringify(target)});`,
    'for (const k of Object.keys(require.cache)) seen.add(pathToFileURL(k).href);',
    'process.stdout.write(JSON.stringify([...seen]));',
  ].join('\n');
}

/**
 * Load one condition in a fresh child and return the file paths it evaluated.
 *
 * @param {string} target absolute path to the entry file
 * @param {'import' | 'require'} flavour
 * @returns {{ files: string[] } | { error: string }}
 */
export function measure(target, flavour) {
  const args = flavour === 'import'
    ? ['--input-type=module', '-e', probeSource(target, flavour)]
    : ['-e', probeSource(target, flavour)];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const stderr = (r.stderr || '').trim().split('\n').slice(0, 6).join('\n');
    return { error: `child exited ${r.status}${r.signal ? ` (${r.signal})` : ''}\n${stderr}` };
  }
  let urls;
  try {
    urls = JSON.parse(r.stdout);
  } catch {
    return { error: `probe produced no parseable module list; stdout began: ${(r.stdout || '').slice(0, 200)}` };
  }
  const files = urls
    .filter((u) => typeof u === 'string' && u.startsWith('file://'))
    .map((u) => fileURLToPath(u))
    .sort();
  return { files };
}

// ── Attributing a module file to the package that ships it ──────────────────

/**
 * The name of the package owning `file` — the nearest enclosing `package.json`
 * with a `name`, which is exact for pnpm's virtual store
 * (`node_modules/.pnpm/zod@4.4.3/node_modules/zod/...` -> `zod`) and for a
 * workspace package's `dist/`.
 *
 * Returns `null` for a file under no package at all rather than guessing from
 * the path, because a guess here would silently attribute an intruder to a
 * package that is legitimately admitted.
 *
 * @param {string} file absolute path
 * @param {Map<string, string | null>} [cache] directory -> package name
 * @returns {string | null}
 */
export function packageOf(file, cache = new Map()) {
  let dir = dirname(file);
  const seen = [];
  for (;;) {
    if (cache.has(dir)) {
      const hit = cache.get(dir);
      for (const d of seen) cache.set(d, hit);
      return hit;
    }
    seen.push(dir);
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      let name = null;
      try {
        name = JSON.parse(readFileSync(manifest, 'utf8')).name ?? null;
      } catch {
        name = null;
      }
      if (name) {
        for (const d of seen) cache.set(d, name);
        return name;
      }
    }
    const up = dirname(dir);
    if (up === dir) {
      for (const d of seen) cache.set(d, null);
      return null;
    }
    dir = up;
  }
}

/**
 * Group measured module paths by owning package.
 *
 * @param {string[]} files
 * @returns {Map<string, string[]>} package name (or `(unattributed)`) -> files
 */
export function byPackage(files) {
  const cache = new Map();
  const out = new Map();
  for (const f of files) {
    const name = packageOf(f, cache) ?? '(unattributed)';
    const list = out.get(name);
    if (list) list.push(f);
    else out.set(name, [f]);
  }
  return out;
}

// ── The assertions ──────────────────────────────────────────────────────────

/**
 * A name may never be both admitted and denied. Checked before anything is
 * measured, so a contradictory edit fails even on a tree where the closure
 * happens to be clean.
 *
 * @returns {string[]} findings
 */
export function assertDisjoint(admitted = ADMITTED_PACKAGES, denied = DENIED_PACKAGES) {
  const both = Object.keys(admitted).filter((n) => Object.hasOwn(denied, n));
  if (!both.length) return [];
  return [
    `CONTRADICTION: ${both.join(', ')} appears in both ADMITTED_PACKAGES and DENIED_PACKAGES. `
      + 'A denied package cannot be re-admitted by editing the admitted set — that is the one '
      + 'repair this gate does not offer.',
  ];
}

/**
 * The three per-condition questions, in the order a reader wants them.
 *
 * @param {Map<string, string[]>} grouped
 * @param {string} label human name for the condition
 * @returns {string[]} findings
 */
export function judge(grouped, label) {
  const findings = [];
  const measured = new Set(grouped.keys());

  // DENIED first: it is the claim ADR-0076 D2 actually made, and its failure
  // message is the module path, which is what makes it legible.
  for (const [name, why] of Object.entries(DENIED_PACKAGES)) {
    if (!measured.has(name)) continue;
    const paths = grouped.get(name).slice(0, 3).map((p) => relative(ROOT, p));
    findings.push(
      `[${label}] FORBIDDEN ${name} is in the closure — ${why}\n`
        + paths.map((p) => `          ${p}`).join('\n')
        + `\n          Repair the import so the lean entry stops reaching it. `
        + `${RATCHET_AUTHORITY_MARKER} is not available here: this name is denied outright.`,
    );
  }

  const arrivals = [...measured].filter((n) => !Object.hasOwn(ADMITTED_PACKAGES, n) && !Object.hasOwn(DENIED_PACKAGES, n));
  for (const name of arrivals.sort()) {
    const paths = grouped.get(name).slice(0, 3).map((p) => relative(ROOT, p));
    findings.push(
      `[${label}] UNLISTED ${name} entered the closure (${grouped.get(name).length} module(s)):\n`
        + paths.map((p) => `          ${p}`).join('\n')
        + '\n          If the lean entry should not reach it, repair the import — that repair is yours.\n'
        + `          Widening ADMITTED_PACKAGES to accept it is the other path, and that set is `
        + `shrink-only: every name in it is weight each embedder of the lean entry pays, so admitting `
        + `one moves the ADR-0076 D2 boundary. ${RATCHET_AUTHORITY_MARKER}`,
    );
  }

  const departures = Object.keys(ADMITTED_PACKAGES).filter((n) => !measured.has(n));
  for (const name of departures.sort()) {
    findings.push(
      `[${label}] STALE ADMITTED_PACKAGES entry ${name}: it is no longer in the closure. `
        + 'Delete the row — the set records what the entry loads TODAY, and an entry held by nothing '
        + 'is a name this gate has stopped checking.',
    );
  }

  return findings;
}

// ── The run ─────────────────────────────────────────────────────────────────

/**
 * Describe a condition value this gate refused, in terms a manifest author can
 * act on — the JS shape, and for an object the keys it does carry.
 *
 * ⛔ It reports what was found and nothing more. It does not name a cause,
 * because from here the gate cannot tell a malformed manifest from an `exports`
 * spelling it has simply never been taught.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function describeConditionShape(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length} element(s)`;
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.length
      ? `an object with keys [${keys.join(', ')}] and no string "default"`
      : 'an empty object';
  }
  if (typeof value === 'string') return 'an empty string';
  return `a ${typeof value} (${JSON.stringify(value) ?? String(value)})`;
}

/**
 * The path ONE `exports` condition names — for the two spellings this workspace
 * actually uses — or a refusal that says what it found instead.
 *
 *     flat    "./core":   { "import": "./dist/core.mjs" }
 *     nested  "./errors": { "import": { "types": "…", "default": "./dist/errors.js" } }
 *
 * Both spellings are live here, so reading only the flat one was never a
 * simplification: it was a gate that could not read half of its own repo.
 * Before #16980 the nested spelling was handed to `node:path` as an object and
 * died with a raw `TypeError: The "paths[2]" argument must be of type string`
 * — no gate name, no entry id, no repair. The shape guard one level up (the
 * `exports[subpath]` object check in `resolveConditions()`) already had the
 * right form; it was checking the wrong level.
 *
 * ⛔ Any other shape is REFUSED here rather than guessed at. A guess would pick
 * some file and then report a closure measured from the wrong artifact as if it
 * had measured the right one — a confident wrong answer, which is strictly
 * worse than the crash it would replace.
 *
 * ⚠️ Absent means absent, and only `undefined` and `null` mean it. Every other
 * falsy value was skipped silently by the previous `if (!rel) continue`; they
 * are refusals now, because `""` and `false` are not a manifest declining to
 * publish a condition — they are a manifest this gate cannot read.
 *
 * @param {{pkgDir: string, subpath: string, id: string}} entry
 * @param {'import' | 'require'} flavour
 * @param {unknown} value the raw `exports[subpath][flavour]`
 * @returns {string | null} the relative path, or null when the condition is not published
 */
export function conditionTarget(entry, flavour, value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value !== '') return value;
  if (
    typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.default === 'string'
    && value.default !== ''
  ) {
    return value.default;
  }
  throw new Error(
    `${entry.pkgDir}/package.json declares exports["${entry.subpath}"]["${flavour}"] as `
      + `${describeConditionShape(value)}; this gate reads a condition only as a path string, or as `
      + 'a nested condition object whose "default" is a path string.\n'
      + `          entry:   ${entry.id}\n`
      + `          subpath: ${entry.subpath}\n`
      + `          flavour: ${flavour}\n`
      + '          ⇒ Either that manifest is wrong, or it uses an exports spelling conditionTarget() '
      + 'in this file has not been taught. This gate cannot tell which from here, so it names the '
      + 'shape and stops. ⛔ What it may not do is resolve something anyway: a closure measured from '
      + 'the wrong artifact would be reported as if it were the right one.',
  );
}

/**
 * Resolve a guarded entry's conditions from its own manifest.
 *
 * @param {{pkgDir: string, subpath: string, id: string}} entry
 * @returns {{conditions: Array<{flavour: 'import'|'require', target: string}>, missing: string[]}}
 */
export function resolveConditions(entry) {
  const manifestPath = join(ROOT, entry.pkgDir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const map = manifest.exports?.[entry.subpath];
  if (!map || typeof map !== 'object') {
    throw new Error(`${entry.pkgDir}/package.json declares no exports["${entry.subpath}"] object`);
  }
  const conditions = [];
  const missing = [];
  for (const flavour of /** @type {const} */ (['import', 'require'])) {
    const rel = conditionTarget(entry, flavour, map[flavour]);
    if (rel === null) continue;
    const target = resolve(ROOT, entry.pkgDir, rel);
    if (existsSync(target)) conditions.push({ flavour, target });
    else missing.push(`${entry.id} (${flavour}) -> ${relative(ROOT, target)}`);
  }
  return { conditions, missing };
}

/**
 * @returns {{findings: string[], prereq: string[], report: Array<object>}}
 */
export function run() {
  const findings = [...assertDisjoint()];
  const prereq = [];
  const report = [];

  for (const entry of GUARDED_ENTRIES) {
    const { conditions, missing } = resolveConditions(entry);
    prereq.push(...missing);
    if (missing.length) continue;

    /** @type {Map<string, Set<string>>} flavour -> package names, for the cross-condition check */
    const setsByFlavour = new Map();

    for (const { flavour, target } of conditions) {
      const label = `${entry.id} ${flavour}`;
      const result = measure(target, flavour);
      if ('error' in result) {
        findings.push(`[${label}] the entry did not load: ${result.error}`);
        continue;
      }
      const grouped = byPackage(result.files);
      setsByFlavour.set(flavour, new Set(grouped.keys()));
      findings.push(...judge(grouped, label));
      report.push({
        entry: entry.id,
        flavour,
        target: relative(ROOT, target),
        modules: result.files.length,
        packages: [...grouped.entries()]
          .map(([name, files]) => ({ name, modules: files.length }))
          .sort((a, b) => b.modules - a.modules || a.name.localeCompare(b.name)),
      });
    }

    // Both published conditions answer for the same boundary. Measured on
    // 70f7d6d735 they carry identical package sets while their module counts
    // differ, so an inequality here is a condition-specific regression — the
    // #12971 class, where one half of a dual build rots while the other stays
    // green.
    if (setsByFlavour.size === 2) {
      const [[flavourA, setA], [flavourB, setB]] = [...setsByFlavour.entries()];
      const onlyA = [...setA].filter((n) => !setB.has(n)).sort();
      const onlyB = [...setB].filter((n) => !setA.has(n)).sort();
      if (onlyA.length || onlyB.length) {
        findings.push(
          `[${entry.id}] the two published conditions disagree on their package set — `
            + `only in ${flavourA}: ${onlyA.join(', ') || '(none)'}; `
            + `only in ${flavourB}: ${onlyB.join(', ') || '(none)'}. `
            + 'One half of the dual build reaches something the other does not, so the boundary '
            + 'holds for only one kind of consumer.',
        );
      }
    }
  }

  return { findings, prereq, report };
}

function main() {
  const { findings, prereq, report } = run();

  if (prereq.length) {
    console.error('PREREQUISITE NOT MET — this gate loads BUILT entry points, and some target is absent:');
    for (const p of prereq) console.error(`  ${p}`);
    console.error('\nRun `pnpm turbo run build --filter=@objectstack/objectql` (or `pnpm build`) first.');
    console.error('This is NOT MEASURED. It is neither a pass nor a failure, and exits 3 so nothing reads it as either.');
    process.exit(EXIT_PREREQUISITE_NOT_MET);
  }

  if (findings.length) {
    console.error(`✗ check-lean-entry-closure: ${findings.length} finding(s).\n`);
    for (const f of findings) console.error(`  ${f}\n`);
    process.exit(1);
  }

  const lines = report.map((r) => `${r.entry} (${r.flavour}): ${r.packages.length} packages, ${r.modules} modules`);
  console.log(`✓ check-lean-entry-closure: ${lines.length} published condition(s) measured from a real load.`);
  for (const l of lines) console.log(`  ${l}`);
  console.log(
    `  Admitted set held exactly (${Object.keys(ADMITTED_PACKAGES).length} packages); `
      + `${Object.keys(DENIED_PACKAGES).length} denied names absent.`,
  );
}

function list() {
  const { prereq, report } = run();
  if (prereq.length) {
    console.error('PREREQUISITE NOT MET — nothing to list:');
    for (const p of prereq) console.error(`  ${p}`);
    process.exit(EXIT_PREREQUISITE_NOT_MET);
  }
  for (const r of report) {
    console.log(`\n${r.entry}  [${r.flavour}]  ${r.target}`);
    console.log(`  ${r.packages.length} packages, ${r.modules} modules`);
    for (const p of r.packages) {
      const verdict = Object.hasOwn(DENIED_PACKAGES, p.name)
        ? 'DENIED  '
        : Object.hasOwn(ADMITTED_PACKAGES, p.name)
          ? 'admitted'
          : 'UNLISTED';
      console.log(`    ${verdict}  ${String(p.modules).padStart(4)} mod  ${p.name}`);
    }
  }
  // ⛔ No byte totals here, deliberately. This gate's whole claim is the set;
  // printing a size beside it would hand the next reader a number to quote,
  // which is how "268KB" happened (#9803). The header carries the figures that
  // justified the design, dated and tree-pinned, as provenance.
  console.log('\n(module counts only — this gate states no size; see the header for why)');
}

// ── Self-test ───────────────────────────────────────────────────────────────
//
// The production run's finding set is empty on a clean tree, and every
// weakening of a matching rule here can only keep it empty. So the rules are
// pinned against adversarial input that a clean tree, by construction, does not
// contain: a denied arrival, an unlisted arrival, a departed admission, a
// contradictory edit, and an unbuilt target.

const SELF_TEST_BATTERIES = Object.freeze({
  'package attribution': 4,
  'the three judgements': 5,
  'the disjointness wall': 2,
  'measuring a real load': 3,
  'reading a condition': 6,
  'the prerequisite': 2,
});

/** Deleting a roster entry silences its floor as surely as zeroing it. */
const SELF_TEST_BATTERY_FLOOR = 6;

const UNATTRIBUTED_BATTERY = '(no battery open)';

const batteryCases = new Map();
let openBattery = null;

function battery(name) {
  openBattery = name;
}

function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batteryCases.set(name, (batteryCases.get(name) ?? 0) + 1);
}

function batteryFloorFailures() {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batteryCases) {
    if (declared.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]}.`,
    );
  }
  return problems;
}

let selfTestReachedVerdict = false;

export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => {
    registerCase();
    return cases.push({ name, ok: Boolean(ok), detail });
  };

  const scratch = mkdtempSync(join(tmpdir(), 'lean-entry-closure-'));
  try {
    // ── package attribution ───────────────────────────────────────────────
    battery('package attribution');
    const store = join(scratch, 'node_modules', '.pnpm', 'zod@4.4.3', 'node_modules', 'zod', 'lib');
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, '..', 'package.json'), JSON.stringify({ name: 'zod', version: '4.4.3' }));
    writeFileSync(join(store, 'index.js'), '');
    t('a pnpm virtual-store path attributes to the package name', packageOf(join(store, 'index.js')) === 'zod');

    const nested = join(scratch, 'pkg', 'dist', 'sub');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(scratch, 'pkg', 'package.json'), JSON.stringify({ name: '@scope/pkg' }));
    writeFileSync(join(nested, 'chunk.js'), '');
    t('a nested dist file attributes to its enclosing package', packageOf(join(nested, 'chunk.js')) === '@scope/pkg');

    const orphanDir = join(scratch, 'orphan');
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, 'x.js'), '');
    // The nearest manifest above `orphan/` is the scratch root's — there is
    // none — so this must be null rather than a guess from the path.
    t('a file under no package is null, never guessed', packageOf(join(orphanDir, 'x.js')) === null);

    const grouped = byPackage([join(store, 'index.js'), join(nested, 'chunk.js'), join(orphanDir, 'x.js')]);
    t(
      'byPackage groups by owner and files the unattributed separately',
      grouped.get('zod')?.length === 1 && grouped.get('@scope/pkg')?.length === 1 && grouped.get('(unattributed)')?.length === 1,
      [...grouped.keys()].join(','),
    );

    // ── the three judgements ──────────────────────────────────────────────
    battery('the three judgements');
    const admittedName = Object.keys(ADMITTED_PACKAGES)[0];
    const cleanGroups = new Map(Object.keys(ADMITTED_PACKAGES).map((n) => [n, [`/fake/${n}/index.js`]]));
    t('a closure equal to the admitted set produces no finding', judge(cleanGroups, 'clean').length === 0);

    const denied = new Map(cleanGroups);
    denied.set('@objectstack/metadata-protocol', ['/fake/metadata-protocol/dist/index.js']);
    const deniedFindings = judge(denied, 'denied');
    t(
      'a DENIED package in the closure is a finding naming the module path',
      deniedFindings.length === 1 && deniedFindings[0].includes('FORBIDDEN @objectstack/metadata-protocol')
        && deniedFindings[0].includes('metadata-protocol/dist/index.js'),
      deniedFindings.join(' | '),
    );

    const unlisted = new Map(cleanGroups);
    unlisted.set('chalk', ['/fake/chalk/index.js']);
    const unlistedFindings = judge(unlisted, 'unlisted');
    t(
      'an UNLISTED arrival nobody predicted is a finding — the property a denial list cannot have',
      unlistedFindings.length === 1 && unlistedFindings[0].includes('UNLISTED chalk'),
      unlistedFindings.join(' | '),
    );
    t(
      'and its widening remedy carries the authority token',
      unlistedFindings[0].includes(RATCHET_AUTHORITY_MARKER),
    );

    const departed = new Map(cleanGroups);
    departed.delete(admittedName);
    const departedFindings = judge(departed, 'departed');
    t(
      'a STALE admitted entry is a finding too — the set cannot rot into what used to be true',
      departedFindings.length === 1 && departedFindings[0].includes(`STALE ADMITTED_PACKAGES entry ${admittedName}`),
      departedFindings.join(' | '),
    );

    // ── the disjointness wall ─────────────────────────────────────────────
    battery('the disjointness wall');
    t('the shipped sets are disjoint', assertDisjoint().length === 0, assertDisjoint().join(' | '));
    t(
      'admitting a denied package fails the gate outright',
      assertDisjoint({ ...ADMITTED_PACKAGES, chokidar: 'x' }, DENIED_PACKAGES).length === 1,
    );

    // ── measuring a real load ─────────────────────────────────────────────
    //
    // A real child, a real `registerHooks` run, on a fixture built here — so
    // the harness is pinned by something other than the tree it will run on.
    battery('measuring a real load');
    const fixture = join(scratch, 'fixture');
    mkdirSync(join(fixture, 'node_modules', 'leaf'), { recursive: true });
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'fixture-root', version: '0.0.0' }));
    writeFileSync(
      join(fixture, 'node_modules', 'leaf', 'package.json'),
      JSON.stringify({ name: 'leaf', version: '0.0.0', main: 'index.cjs' }),
    );
    writeFileSync(join(fixture, 'node_modules', 'leaf', 'index.cjs'), 'module.exports = 1;\n');
    writeFileSync(join(fixture, 'entry.mjs'), "import 'leaf';\nexport const ok = true;\n");
    writeFileSync(join(fixture, 'entry.cjs'), "require('leaf');\nmodule.exports = { ok: true };\n");

    const esm = measure(join(fixture, 'entry.mjs'), 'import');
    t(
      'the import probe reaches a transitive dependency of the entry',
      !('error' in esm) && byPackage(esm.files).has('leaf'),
      JSON.stringify(esm).slice(0, 300),
    );

    const cjs = measure(join(fixture, 'entry.cjs'), 'require');
    t(
      'the require probe reaches it too',
      !('error' in cjs) && byPackage(cjs.files).has('leaf'),
      JSON.stringify(cjs).slice(0, 300),
    );

    const broken = measure(join(fixture, 'no-such-entry.mjs'), 'import');
    t('an entry that does not load is an ERROR, never an empty closure', 'error' in broken, JSON.stringify(broken).slice(0, 200));

    // ── reading a condition ───────────────────────────────────────────────
    //
    // One case per branch of conditionTarget(), because the branch that was
    // MISSING is exactly what #16980 cost: a nested condition was handed to
    // node:path as an object and died there. The refusal branch is pinned in
    // the same battery — an unreadable shape has to arrive as this gate's own
    // sentence, naming the entry, and never as a crash from a node builtin.
    battery('reading a condition');
    const condEntry = { id: '@fixture/pkg/errors', pkgDir: 'packages/fixture', subpath: './errors' };
    t(
      'a flat condition is the path string itself',
      conditionTarget(condEntry, 'import', './dist/errors.js') === './dist/errors.js',
    );
    t(
      'a nested condition is read through its "default"',
      conditionTarget(condEntry, 'require', { types: './dist/errors.d.cts', default: './dist/errors.cjs' })
        === './dist/errors.cjs',
    );
    t(
      'an unpublished condition is absent, not a refusal',
      conditionTarget(condEntry, 'import', undefined) === null
        && conditionTarget(condEntry, 'require', null) === null,
    );

    /** @param {unknown} value */
    const refuseCondition = (value) => {
      try {
        conditionTarget(condEntry, 'import', value);
        return { threw: false, ctor: '(none)', message: '(returned a target instead of refusing)' };
      } catch (e) {
        return { threw: true, ctor: e.constructor.name, message: String(e.message) };
      }
    };

    const noDefault = refuseCondition({ types: './dist/errors.d.ts', browser: './dist/errors.browser.js' });
    t(
      'a condition object with no "default" is refused by this gate, naming entry, subpath and shape',
      noDefault.threw && noDefault.ctor === 'Error'
        && noDefault.message.includes(condEntry.id)
        && noDefault.message.includes(condEntry.subpath)
        && noDefault.message.includes('types, browser'),
      `${noDefault.ctor}: ${noDefault.message.slice(0, 220)}`,
    );

    const thirdShape = refuseCondition(['./dist/a.js', './dist/b.js']);
    t(
      'a third shape is refused too, and the refusal reports what it found rather than guessing',
      thirdShape.threw && thirdShape.ctor === 'Error'
        && thirdShape.message.includes('an array of 2 element(s)')
        && thirdShape.message.includes(condEntry.id),
      `${thirdShape.ctor}: ${thirdShape.message.slice(0, 220)}`,
    );

    t(
      'resolveConditions reads a NESTED manifest end to end — the shape that used to reach node:path',
      (() => {
        const nestedPkg = join(scratch, 'nestedpkg');
        mkdirSync(nestedPkg, { recursive: true });
        writeFileSync(
          join(nestedPkg, 'package.json'),
          JSON.stringify({
            name: 'nestedpkg',
            exports: {
              './errors': {
                import: { types: './dist/errors.d.ts', default: './dist/errors.js' },
                require: { types: './dist/errors.d.cts', default: './dist/errors.cjs' },
              },
            },
          }),
        );
        const { conditions, missing } = resolveConditions({
          id: 'nestedpkg/errors',
          pkgDir: relative(ROOT, nestedPkg),
          subpath: './errors',
        });
        // Unbuilt by construction, so both conditions land in `missing` — which
        // is the point: they are NAMED, having been resolved to real paths,
        // rather than never reaching a diagnostic at all.
        return conditions.length === 0 && missing.length === 2
          && missing[0].endsWith(join('dist', 'errors.js'))
          && missing[1].endsWith(join('dist', 'errors.cjs'));
      })(),
    );

    // ── the prerequisite ──────────────────────────────────────────────────
    battery('the prerequisite');
    t(
      'the guarded entry declares both published conditions in its own manifest',
      (() => {
        const manifest = JSON.parse(readFileSync(join(ROOT, GUARDED_ENTRIES[0].pkgDir, 'package.json'), 'utf8'));
        const map = manifest.exports?.[GUARDED_ENTRIES[0].subpath] ?? {};
        return Boolean(map.import && map.require);
      })(),
    );
    t(
      'an absent build target is reported as a prerequisite, not as a clean closure',
      (() => {
        const saved = GUARDED_ENTRIES[0].subpath;
        // Resolve against a manifest whose condition targets cannot exist.
        const fake = join(scratch, 'fakepkg');
        mkdirSync(fake, { recursive: true });
        writeFileSync(
          join(fake, 'package.json'),
          JSON.stringify({ name: 'fakepkg', exports: { './core': { import: './dist/core.mjs', require: './dist/core.js' } } }),
        );
        const { conditions, missing } = resolveConditions({
          id: 'fakepkg/core',
          pkgDir: relative(ROOT, fake),
          subpath: './core',
        });
        return saved === './core' && conditions.length === 0 && missing.length === 2;
      })(),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  for (const message of batteryFloorFailures()) cases.push({ name: message, ok: false });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-lean-entry-closure self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-lean-entry-closure self-test: ${cases.length} cases pass `
      + '(attribution, all three judgements, the disjointness wall, two real child loads, '
      + 'both condition spellings plus two refusals, the prerequisite).',
  );
  selfTestReachedVerdict = true;
  return 0;
}

// Exports bindings, so an import for those exports alone must run nothing.
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
  const code = selfTest();
  if (!selfTestReachedVerdict) {
    console.error(
      '\n✗ check-lean-entry-closure self-test: selfTest() returned without reaching its verdict,\n'
        + 'so no success line was printed. Exiting 0 here would report a self-test that never\n'
        + 'finished as a self-test that passed.\n',
    );
    process.exit(1);
  }
  process.exit(code);
} else if (process.argv.includes('--list')) {
  list();
} else {
  main();
}
