#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-dual-build-cjs-loads -- every published `require` entry point must
 * actually load.
 *
 *   node scripts/check-dual-build-cjs-loads.mjs              # the gate
 *   node scripts/check-dual-build-cjs-loads.mjs --list       # every entry it found
 *   node scripts/check-dual-build-cjs-loads.mjs --self-test  # verify the checker
 *
 * ## The bug it exists to prevent (#12971)
 *
 * `@objectstack/metadata-core` declares `"type": "module"` with a dual
 * `exports` map, so `require('@objectstack/metadata-core')` is a published,
 * supported entry point. #12843 added `createRequire(import.meta.url)` to one
 * source file -- correct for the ESM output, and written with a `try`/`catch`
 * around it and a comment reasoning that the CJS build would see `undefined`
 * there. tsup does not rewrite the identifier: at this build `target` esbuild
 * emits `import.meta` VERBATIM into `dist/index.cjs`, and outside an ES module
 * that is a PARSE-time error. The module therefore never begins executing --
 * so neither the `typeof require === 'function'` fast path above it nor the
 * `catch` around it ever runs, and the package's WHOLE `require` condition is
 * unloadable, for every consumer and every code path:
 *
 *   $ node -e "require('./dist/index.cjs')"
 *   SyntaxError: Cannot use 'import.meta' outside a module
 *
 * Downstream (measured in `objectstack-ai/cloud`): `@objectstack/organizations`
 * resolves through that condition, fails to load, and the ADR-0093 D5
 * fail-closed tenancy wall then correctly refuses to boot the walled EE
 * runtime -- reddening cloud's only required check. One line in one source
 * file, one release away from every CJS consumer of the package.
 *
 * Two properties make this class invisible without a gate, and they are why
 * this is a gate rather than a fixed line:
 *
 *   1. **The repo's own tests never see it.** vitest resolves workspace
 *      packages through the `import` condition (and often through source
 *      aliases), so every suite stays green while the `require` half is
 *      rubble. `pnpm build` is green too -- the bytes emit fine, they just
 *      cannot be parsed by the runtime they are declared for.
 *   2. **The author cannot see it either.** The two sibling packages that hit
 *      this before (`packages/runtime` #10993, `packages/metadata-protocol`
 *      #11235) each carry a long `shims: true` comment in their tsup config
 *      warning the next author -- and the next author was in a THIRD package
 *      that had no such comment, because there is nothing to read a comment
 *      in a file you never open.
 *
 * ## What it checks, per published `require` entry point
 *
 *   PARSES   every CommonJS file the package emits (`dist/**\/*.cjs`, plus
 *            `*.js` when the manifest is not `"type": "module"`) parses as
 *            CommonJS. This is the #12971 class, and it is checked over the
 *            whole emitted set rather than the entry alone because code
 *            splitting puts the offending line in a shared chunk as easily as
 *            in `index.cjs`.
 *   LOADS    `require(<entry>)` in a fresh child process completes.
 *   AGREES   for the entries a probe is declared on
 *            (`DUAL_FORMAT_BEHAVIOUR_PROBES` below), the same exported call
 *            answers the same value through the `require` and the `import`
 *            condition, and that value is the declared one. Loading is not
 *            agreement, and the #12971 repair works by making the CJS output
 *            resolve the SAME anchor -- so agreement is the property a
 *            regression would actually break, quietly.
 *   TYPED    the declaration a `require` consumer RESOLVES is CommonJS-
 *            flavoured and is really on disk. This is the #13112 class and it
 *            is a different question from the three above: those ask whether
 *            the JavaScript works, this asks whether the TYPES the same
 *            consumer reads describe the module kind they were resolved for.
 *
 * ## Why BOTH, when either alone would have caught #12971
 *
 * They fail differently and neither subsumes the other. A parse check is total
 * -- it reads every emitted byte, including chunks no entry happens to pull in
 * on the day it runs -- but it says nothing about a module that parses and
 * then throws at load. A `require()` smoke is the real question a consumer
 * asks, but it only ever reaches the graph the entry actually imports. Running
 * both costs one extra spawn per file and removes the "gate was green, package
 * still broken" answer from both directions.
 *
 * ## The ledger, and the one thing it may never silence
 *
 * `scripts/dual-build-cjs-loads.baseline.json` is a shrink-only, hand-edited
 * list of entries that legitimately cannot be `require()`d, each with a
 * reason. It exists because a `require` condition can be unloadable for a
 * cause that is not ours at all: `@objectstack/metadata-core`'s `./testing`
 * subpath and `@objectstack/service-cluster`'s re-export vitest, and vitest
 * REFUSES to be required from CommonJS by design ("Vitest cannot be imported
 * in a CommonJS module using require()"). That is a real declared-but-unusable
 * entry point -- a separate defect from this one, filed rather than fixed here
 * -- and pretending the gate is green over it would be the lie this file
 * exists to stop.
 *
 * ⛔ **A SyntaxError is never ledgerable.** The ledger accepts a load-time
 * failure only; an entry whose emitted bytes do not PARSE is refused with a
 * pointer back to the shim, whatever the ledger says. That asymmetry is the
 * whole gate: a runtime load failure is a fact about a dependency, a parse
 * failure is always a fact about what WE emitted. Pinned in `--self-test`.
 *
 * The ledger reconciles in BOTH directions, and "both" is two checks rather
 * than one, because a row goes stale two different ways:
 *
 *   * a ledgered entry that now LOADS is a finding -- the exemption must be
 *     deleted in the same PR that fixes it, so a stale row is an error rather
 *     than dead text;
 *   * a ledgered entry that is no longer in the POPULATION at all -- the
 *     subpath stopped declaring a `require` condition, the package was renamed
 *     or unpublished -- is a finding too, and until #13014 it was not. Nothing
 *     else could see it: the only read of the ledger was `ledger[r.id]` from
 *     inside the walk over DISCOVERED rows, so a key no row names was never
 *     looked up, and a lookup that never happens cannot report. Measured on
 *     `8cb96ec41b` before the fix -- a row exempting a package that does not
 *     exist left the pass line byte-identical, exit 0, the id unmentioned.
 *
 * The second direction is the shape the card is about rather than a detail of
 * this file: a lookup that comes back empty must be an ERROR, never silence.
 * The same file already had it right one invariant over -- `runBehaviourProbes`
 * refuses a probe naming an entry point that no longer exists, because it "is
 * asserting nothing" -- so the ledger was the odd one out, not a new idea.
 *
 * ## Vacuity floors -- an empty sweep reports what a clean tree reports
 *
 * Every count in this gate's pass line is also a way for it to pass having read
 * nothing: a manifest walk that discovers nothing, an `exports` resolver that
 * reads no `require` condition, a CommonJS collector that matches no file, a
 * probe table that was emptied. Each produces zero findings, and zero findings
 * is exactly what success looks like. So each carries a floor derived from the
 * census recorded in `MEASURED` below and held with margin, and below any of
 * them the gate REFUSES (`exit 2`) rather than passing. Same idiom and same
 * reason as `check-keyed-text-bounds.mjs` (five floors) and
 * `check-undeclared-dep-imports.mjs` (three) -- and, measured 2026-08-29, the
 * same exposure below: those are the only other two gates in `scripts/` that
 * record a census beside inequality floors, and both had already drifted from
 * their own record.
 *
 * ## The provenance of a floor, and how to reproduce it
 *
 * `MEASURED` is a claim about ONE named commit -- `MEASURED.ref` -- and never
 * about `main`. It is what this gate's own instrument printed on that tree, and
 * it is what the floors under it were derived from. It is NOT a statement about
 * the tree you are running on. To re-derive it, take the ref from `MEASURED`
 * (every passing run prints it) and:
 *
 *   git worktree add --detach ../os-cjs-provenance "$REF"    # $REF = MEASURED.ref
 *   cd ../os-cjs-provenance
 *   node scripts/check-dual-build-cjs-loads.mjs --list        # entries + packages
 *
 * ⚠️ Two of the four counters are cheap to reproduce and two are not, and that
 * asymmetry is the thing a reader most needs to know:
 *
 *   entries, packages   read from `packages/**\/package.json` ALONE -- no
 *                       install, no build, because `--list` returns before the
 *                       prerequisite check. Re-derived at `MEASURED.ref` on
 *                       2026-08-29: 103 / 67, exactly the record.
 *   cjsFiles, probes    read from emitted `dist/`, so reproducing them costs a
 *                       full `pnpm install && pnpm build` AT that ref. ⛔ Do
 *                       not read a matching `cjsFiles` as corroboration of the
 *                       other two -- it moves with the BUILD, not with the
 *                       source. On 2026-08-29 the built tree read 610 against a
 *                       recorded 613 while `probes` still matched exactly.
 *
 * ## This population shrinks for good reasons, not only grows
 *
 * A floor reads as if the thing under it only ever rises. This one does not. A
 * package with no `exports` map publishes its `main` AS a require entry point,
 * so giving it an accurate ESM-only `exports` map REMOVES it from this
 * population -- an improvement that decrements `entries` AND `packages`. That
 * is exactly how this record first parted company with the tree: it was exact
 * at `MEASURED.ref` and stayed exact for its whole life until
 * `@objectstack/cli` left the population that way. ⇒ a drop here is not
 * evidence of a broken walk; only a drop below the floor is.
 *
 * ## Why no equality against the tree, and why no band either
 *
 * An equality reds on every legitimate move, in both directions -- the very PR
 * that declared the `exports` map above would have reddened it. A band around
 * the record is the next thing to reach for, and it fails a derivation rather
 * than a taste test. Two reasons, either one sufficient:
 *
 *   1. The band already exists and is called the FLOOR. `MIN_ENTRIES` IS
 *      `MEASURED.entries` minus the headroom this gate declared. A second,
 *      narrower band would be a second tolerance for one fact, and its width
 *      would be invented rather than measured.
 *   2. No width measures anything. Measured 2026-08-29, the three gates in
 *      `scripts/` carrying a record of this shape had drifted -1, -5 and +15
 *      from theirs, in both directions, within days of landing. A band narrow
 *      enough to notice this file's -1 reds on the +15 next door; one wide
 *      enough to survive the +15 cannot see a -1.
 *
 * So the repair is not enforcement. What was missing is that a GREEN run never
 * showed the reader the two numbers side by side, so the record could stop
 * describing the tree with nothing, anywhere, saying so. `provenanceLine`
 * prints both on every pass: the drift is a fact in the log now, not a
 * discovery.
 *
 * ## Where it runs, and why not in the lint job
 *
 * It needs a real `dist/`, so it is a step in **Build Core** (ci.yml), beside
 * "Verify capability packages ship a runtime entry" and "No compiled test
 * files in any dist" -- the same genre, the same phase, and a required
 * context. With no `dist/` it exits 3 (`PREREQUISITE NOT MET`) naming
 * `pnpm build`; ⛔ it never degrades to a silent green (Route & surface
 * ownership §3: a verifier that quietly skips is worse than none).
 *
 * It is the DYNAMIC half of a pair. `scripts/check-published-files.mjs` owns
 * the static half -- that the manifest's declared paths are whitelisted for
 * npm -- and cannot know whether the bytes at those paths load. Same split as
 * `check-override-consistency.mjs` (static) beside `publish-smoke.sh`
 * (dynamic); the publish smoke does not cover this because the project it
 * scaffolds is ESM and never calls `require()`.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SCAN_ROOT = 'packages';
const BASELINE_PATH = 'scripts/dual-build-cjs-loads.baseline.json';

/**
 * ## The dispatch-gates declaration -- the `ROOT_DIR_WATCH_HINTS` idiom
 *
 * `scripts/pm/dispatch-gates.mjs` derives WHICH gates a card owes by matching
 * path literals in a gate's source against the card's changed files. `SCAN_ROOT`
 * above is a bare single-segment word, which `hintCovers` refuses as too
 * generic, and the population sentence lives in prose the hint extractor masks
 * by design -- so without this declaration the gate would be invisible to the
 * derivation for every card in the tree, including the one shape it exists to
 * catch.
 *
 * Two literals -- the two files whose CONTENT this gate's verdict is a
 * function of, and which it can name at a precision worth having:
 *
 *   `packages/**\/package.json`    declares the `require` condition -- adding
 *                                  one puts a new entry into the population.
 *                                  74 tracked files, 1.0% of the tree.
 *   `packages/**\/tsup.config.ts`  decides the emitted bytes; DROPPING
 *                                  `shims: true` is how a fixed package
 *                                  regresses, and it is a one-line edit that
 *                                  touches no source file at all. 20 tracked
 *                                  files, 0.3%.
 *
 * ⛔ A third literal is deliberately NOT declared, and the omission is
 * measured rather than an oversight. #12843 arrived through
 * `packages/**\/src/**` -- one source line, no manifest change, no config
 * change -- so that spelling has the best recall of the three. It reaches
 * **4482 files, 62.2% of the tracked tree** (98.8% of them really are in a
 * dual-built package, so the imprecision is not the problem). Declaring it
 * would name this gate on nearly every card in the repo, which is the trade
 * `scripts/pm/bare-root-worklist.mjs` records as REFUSE-WIDE for rows at 39%,
 * one column narrower than this one: recall bought at the cost of precision,
 * on the column whose whole value is precision. And this gate does not READ
 * those files at all -- it reads `dist/` -- so declaring them would be
 * declaring a population the gate does not walk, which that ledger names as
 * the costlier error of the two. The recall is not lost: the gate is a step in
 * **Build Core**, a required context that runs on every PR, so the cost of the
 * omission is one CI round trip, not a missed defect. The row in that ledger
 * carries this measurement.
 *
 * ⛔ Spelled as LITERALS, never built from `SCAN_ROOT` -- the extractor reads
 * source text, so a computed template would produce no hint and leave the gate
 * as invisible as no declaration at all. Pinned in `--self-test`.
 */
const ROOT_DIR_WATCH_HINTS = ['packages/**/package.json', 'packages/**/tsup.config.ts'];

/**
 * ## AGREES -- the third invariant, and the one loading alone cannot give you
 *
 * A dual build has two outputs of one source, and "both load" is a weaker
 * claim than "both behave the same". #12971's fix works by making the CJS
 * output derive a REAL module URL rather than carrying `import.meta` verbatim,
 * so the thing actually at risk on a regression is not loadability but
 * AGREEMENT: a shim that resolved to the wrong anchor would load fine and
 * quietly answer `null` where the ESM build answers a version — and `null` is
 * a legal value here (`resolveInstalledSpecVersion()` returning it closes the
 * ADR-0087 forward-conversion window), so the whole degradation is silent.
 *
 * Each probe names one export, an argument-free call, and the expected value,
 * evaluated in BOTH conditions of the same package and required to match each
 * other AND the expectation. Node evaluates the two in separate child
 * processes, so neither can borrow the other's module graph.
 *
 * ⛔ This lives here rather than in the package's vitest suite because it can
 * only be asked of BUILT output, and `Test Core` has none: turbo's `test` task
 * declares `dependsOn: ["^build"]` (dependencies only, never the package's own
 * dist) and explicitly excludes `dist/**` from its inputs, so a suite reading
 * its own `dist/` would be unbuilt in CI and un-invalidated by a rebuild —
 * the `check:cross-package-test-inputs` failure shape, one package over. The
 * package's own unit suite still covers the FUNCTION; what needs built bytes
 * is the cross-FORMAT claim, and this is where built bytes exist.
 *
 * @type {{pkg: string, subpath: string, export: string, expect: string, why: string}[]}
 */
const DUAL_FORMAT_BEHAVIOUR_PROBES = [
  {
    pkg: '@objectstack/metadata-core',
    subpath: '.',
    export: 'resolveInstalledSpecVersion',
    // The installed @objectstack/spec version, read from the workspace rather
    // than hard-coded, so the probe survives every release.
    expect: 'spec-version',
    why: "#12843's intent: the ADR-0087 forward-conversion window opens only on positive version evidence, and #12971 was a broken attempt to obtain that evidence from the CJS build. Both formats must answer the installed spec version, not `null`.",
  },
];

/**
 * ## TYPED's declared exemptions -- and the one thing they are NOT
 *
 * Giving a `require` condition its own `.d.cts` splits one declaration into
 * two, and TypeScript compares a class with a `private` member NOMINALLY: two
 * declaration files mean two incompatible identities of the same class, even
 * byte-for-byte identical ones. That is TypeScript's dual-package hazard, on
 * the type axis, and it is a property of the DEPENDENCY, never of the consumer
 * that trips over it.
 *
 * `@objectstack/core` is where the repo actually meets it. `ObjectKernel`
 * carries `private plugins` and travels through `PluginContext.getKernel()`
 * into every plugin's `init`, so the moment core ships two declarations, any
 * compilation that reaches core through BOTH resolution modes sees two
 * `ObjectKernel`s. Measured on this branch, whole-repo `pnpm build`:
 *
 *   28 packages split (core included)      RED — @objectstack/verify, 5 × TS2345
 *   27 packages split (core held back)     GREEN — 71/71 tasks
 *   28 + the 37-package ESM mirror         RED — @objectstack/plugin-dev, TS2345
 *
 * The mirror round is the informative one: it moves the failure rather than
 * removing it. Splitting `@objectstack/objectql` is what fixes `verify` and
 * what breaks `plugin-dev`, because a split dependency resolves core one way
 * from its `.d.mts` and the other from its `.d.ts`. So the exemption is not
 * "core is hard", it is: **core cannot be split until `ObjectKernel`'s
 * identity stops being nominal**, and that is a decision about core's public
 * types, not about an exports map.
 *
 * ⛔ An exemption here is NOT a quieter red. It is a declaration that the
 * entry's `.d.cts` ships unreachable ON PURPOSE, with the measurement that
 * says why. Shrink-only: an entry that can be split must lose its row in the
 * same PR that splits it, and a row naming an entry point that no longer
 * exists is a finding (the same both-directions rule the load ledger learned).
 *
 * @type {Record<string, {reason: string}>}
 */
const TYPED_EXEMPTIONS = Object.freeze({
  '@objectstack/core#.': {
    reason: 'Splitting core\'s declarations gives `ObjectKernel` (which carries `private plugins`) two nominal identities, and it crosses every plugin boundary via `PluginContext.getKernel()`. Measured: with core split, `pnpm build` fails in @objectstack/verify with 5 × TS2345; with core held back and the other 27 packages split, 71/71 tasks pass. Blocked on a decision about core\'s public types, not on this exports map (#13112).',
  },
  '@objectstack/core#./logger': {
    reason: 'Same declaration set as `@objectstack/core#.` — the subpath is emitted from the same tsup pass and splits the same identities. Held back with its sibling so core has one resolution story rather than two (#13112).',
  },
});

const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_REFUSE = 2;
const EXIT_PREREQ = 3;

// ---------------------------------------------------------------------------
// Vacuity floors, and the provenance of the census they were derived from --
// the header is the authority on how to reproduce it and on why it is recorded
// rather than enforced. The ref lives INSIDE the record, so a count and the
// tree it came from cannot be edited apart, and every site that quotes either
// interpolates from here instead of restating it. Re-measuring UP is free;
// LOWERING a floor to make a run pass is the move this block exists to make
// visible in a diff.

const MEASURED = Object.freeze({
  // The commit this census was taken on -- a full install and build, then this
  // gate. Immutable, so the record stays reproducible forever even as `main`
  // moves away from it. ⛔ Never repoint it without re-running all four counts.
  ref: '8cb96ec41b',
  entries: 103,
  packages: 67,
  cjsFiles: 613,
  probes: 1,
});
const MIN_ENTRIES = 90;
const MIN_PACKAGES = 58;
const MIN_CJS_FILES = 520;
const MIN_PROBES = 1;
const MIN_TYPED_JUDGED = 88;

/**
 * TYPED's own census record -- a SECOND single-ref claim beside `MEASURED`,
 * never a fifth count inside it. The four counts above were taken on
 * `MEASURED.ref`, where the TYPED invariant's subject did not exist yet (the
 * 27 typed manifests are what #13112's fix landed), so folding this number
 * under that commit's name would make the refusal message cite a tree the
 * number does not come from — a small lie in the one place a reader goes to
 * decide whether a floor is trustworthy. Same discipline as `MEASURED`: one
 * claim about one named commit; ⛔ never repoint without re-running the count.
 * `dist/` is unaffected by that diff (an `exports` map decides what a resolver
 * READS, never what tsup EMITS), so the count is the one a clean build of that
 * commit produces.
 */
const MEASURED_TYPED = Object.freeze({ ref: '196612a313', typedJudged: 102 });

/**
 * The first floor a run falls below, as a refusal message -- or `null` when
 * every count clears. Pure, so `--self-test` drives every floor with no tree.
 *
 * @param {{entries?: number, packages?: number, cjsFiles?: number, probes?: number}} counts
 * @returns {string | null}
 */
export function floorProblem(counts) {
  const rows = [
    [counts?.entries ?? 0, MIN_ENTRIES, MEASURED.entries, 'published `require` entry point(s)',
      'The manifest walk or the `exports` resolver broke. With no entries nothing is required, nothing is parsed, and the gate prints what a clean tree prints.',
      MEASURED.ref],
    [counts?.packages ?? 0, MIN_PACKAGES, MEASURED.packages, 'publishable package(s)',
      'Entries were found but collapsed onto a fraction of the tree — the walk is reading part of `packages/`, not the whole of it.',
      MEASURED.ref],
    [counts?.cjsFiles ?? 0, MIN_CJS_FILES, MEASURED.cjsFiles, 'emitted CommonJS file(s)',
      'This is the PARSES population. `commonJsFilesUnder` matched (almost) nothing, so `node --check` ran over an empty set and every byte we emit went unread.',
      MEASURED.ref],
    [counts?.probes ?? 0, MIN_PROBES, MEASURED.probes, 'cross-format behaviour probe(s) run',
      'AGREES is the invariant loading alone cannot give you, and an empty probe table satisfies it vacuously.',
      MEASURED.ref],
    [counts?.typedJudged ?? 0, MIN_TYPED_JUDGED, MEASURED_TYPED.typedJudged, 'require entry point(s) JUDGED by TYPED',
      'This is the TYPED population — entries reached and answered, clean or not. It does not move when packages are defective, only when the row loop stops asking, so a fall here means TYPED went silent rather than that the tree got worse.',
      MEASURED_TYPED.ref],
  ];
  for (const [got, min, measured, what, why, at] of rows) {
    if (got >= min) continue;
    return `measured only ${got} ${what}, below the floor of ${min} (${measured} on ${at}).\n`
      + `  ${why}\n`
      + '  ⛔ NOT a pass: nothing, or nearly nothing, was read.';
  }
  return null;
}

/**
 * The provenance footer for a PASSING run: the census this run read, the floors
 * it cleared, the census those floors were derived from, and the ref that
 * census belongs to -- side by side.
 *
 * This is the whole repair. The floors are inequalities on purpose, so no run
 * can ever contradict the record; without this line the record could stop
 * describing the tree and every green log would look identical either way. The
 * delta is reported as INFORMATION and never as a verdict: this population
 * moves in both directions for good reasons (see the header), and only the
 * floors decide anything.
 *
 * Pure, so `--self-test` drives it with no tree.
 *
 * @param {{entries?: number, packages?: number, cjsFiles?: number, probes?: number}} counts
 * @returns {string}
 */
export function provenanceLine(counts) {
  const got = [counts?.entries ?? 0, counts?.packages ?? 0, counts?.cjsFiles ?? 0, counts?.probes ?? 0];
  const rec = [MEASURED.entries, MEASURED.packages, MEASURED.cjsFiles, MEASURED.probes];
  const floors = [MIN_ENTRIES, MIN_PACKAGES, MIN_CJS_FILES, MIN_PROBES];
  const delta = got.map((g, i) => (g === rec[i] ? '=' : `${g > rec[i] ? '+' : ''}${g - rec[i]}`));
  return `  provenance — entries/packages/cjsFiles/probes: this run ${got.join('/')}`
    + ` · floors ${floors.join('/')} · derived from ${rec.join('/')} measured on ${MEASURED.ref}`
    + ` (${delta.join('/')} vs the record).\n`
    + '  ⚠ The delta is information, not a verdict — this population grows AND shrinks for good'
    + ' reasons, and only the floors decide. Reproduce the record: see this file\'s header.';
}

/**
 * Ledger rows naming an id the discovered population does not contain. Pure.
 *
 * A separate pass over `Object.keys(ledger)` rather than another branch inside
 * the row walk, and that is the whole point: the row walk can only ever reach a
 * key some row NAMES, so the orphan direction is unreachable from there. See
 * the header for the measurement.
 *
 * @param {Record<string, {reason?: string}>} ledger
 * @param {{id: string}[]} rows
 * @returns {string[]}
 */
export function orphanLedgerRows(ledger, rows) {
  const ids = new Set((rows ?? []).map((r) => r.id));
  return Object.keys(ledger ?? {})
    .filter((id) => !ids.has(id))
    .sort()
    .map((id) => `${id} — ${BASELINE_PATH} exempts an entry point that is not in the population: `
      + 'no published `require` condition resolves to it. Delete the row — it is exempting nothing, '
      + 'and a reader takes it for coverage that was never checked.');
}

const PARSE_CONCURRENCY = 8;

// ---------------------------------------------------------------------------
// Population
// ---------------------------------------------------------------------------

/** Every `package.json` under `<root>/packages`, node_modules and dist pruned. */
export function manifestPaths(root) {
  const out = [];
  const start = join(root, SCAN_ROOT);
  if (!existsSync(start)) return out;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.turbo') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'package.json') out.push(p);
    }
  };
  walk(start);
  return out.sort();
}

/**
 * Resolve one `exports` value the way node resolves it under the `require`
 * condition: descend condition objects taking `require` / `node` / `default`,
 * never `import`, `browser` or `module`.
 *
 * The nesting matters and is easy to get wrong: `@objectstack/spec` spells its
 * entry `{"require": {"types": "...", "default": "./dist/index.js"}}`, so the
 * string lives one level BELOW the `require` key. A resolver that only accepts
 * a string directly under `require` silently drops every package spelled that
 * way -- measured while writing this gate: 19 of the 105 entries. Pinned in
 * `--self-test`.
 *
 * @param {unknown} node an `exports` subtree
 * @param {boolean} inRequire are we already inside a `require` condition?
 * @returns {string | null}
 */
export function resolveRequireTarget(node, inRequire = false) {
  if (typeof node === 'string') return inRequire ? node : null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = resolveRequireTarget(n, inRequire);
      if (r) return r;
    }
    return null;
  }
  if (node === null || typeof node !== 'object') return null;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'types' || k === 'import' || k === 'browser' || k === 'module' || k.startsWith('.')) continue;
    if (k === 'require') {
      const r = resolveRequireTarget(v, true);
      if (r) return r;
      continue;
    }
    if (k === 'node' || k === 'default') {
      const r = resolveRequireTarget(v, inRequire);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Resolve the declaration file a `require`-condition consumer READS, the way
 * TypeScript's node16/nodenext resolver does: walk the condition object in key
 * order, take `types` wherever it is reached, descend `require` / `node` /
 * `default`, never `import` / `module` / `browser`.
 *
 * ⚠️ `types` matches at ANY level -- including as a SIBLING of
 * `import`/`require`, which is the whole #13112 defect. A sibling `types`
 * answers for BOTH conditions, so a dual-build package hands its `require`
 * consumer the ESM-flavoured `.d.ts` while the `.d.cts` twin tsup emitted
 * beside `index.cjs` is named by nothing and ships unreachable. A resolver
 * that looked only INSIDE the `require` branch would report "no types" for the
 * defective shape and "no types" for a legitimately CJS-first package alike,
 * and could not tell the two apart -- so it is the RESOLVED path that is
 * judged here, never the spelling.
 *
 * @param {unknown} node an `exports` subtree
 * @returns {string | null}
 */
export function resolveRequireTypes(node) {
  if (typeof node === 'string' || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = resolveRequireTypes(n);
      if (r) return r;
    }
    return null;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('.') || k === 'import' || k === 'module' || k === 'browser') continue;
    if (k === 'types') {
      if (typeof v === 'string') return v;
      continue;
    }
    if (k === 'require' || k === 'node' || k === 'default') {
      const r = resolveRequireTypes(v);
      if (r) return r;
    }
  }
  return null;
}

/**
 * The module kind TypeScript assigns a declaration file: the extension decides
 * when it carries one (`.d.cts` is always CommonJS, `.d.mts` always ESM),
 * otherwise the package's `"type"` decides -- the same rule TypeScript applies
 * to `.cjs` / `.mjs` / `.js`. So `dist/index.d.ts` is CJS-flavoured in a
 * CJS-first package and ESM-flavoured in a `"type": "module"` one, and the
 * SAME path is correct under `require` in the first and wrong in the second.
 * ⛔ Hence the invariant is module KIND, never the `.d.cts` extension: demanding
 * the extension would red every correct CJS-first package in the repo.
 *
 * @param {string} path a declaration path
 * @param {boolean} isModuleType the package declares `"type": "module"`
 * @returns {'commonjs' | 'module'}
 */
export function declarationModuleKind(path, isModuleType) {
  if (path.endsWith('.d.cts')) return 'commonjs';
  if (path.endsWith('.d.mts')) return 'module';
  return isModuleType ? 'module' : 'commonjs';
}

/**
 * The declaration one subpath hands a `require` consumer. Mirrors
 * `importTargetFor`'s subpath lookup; falls back to the root `types`/`typings`
 * field for the `(main)` row, which is what a resolver reads when there is no
 * `exports` map at all.
 *
 * @returns {string | null}
 */
export function requireTypesFor(pkg, subpath) {
  const ex = pkg?.exports;
  if (ex && typeof ex === 'object' && !Array.isArray(ex)) {
    const keys = Object.keys(ex);
    if (keys.some((k) => k.startsWith('.'))) return subpath in ex ? resolveRequireTypes(ex[subpath]) : null;
    if (subpath === '.') return resolveRequireTypes(ex);
    return null;
  }
  for (const key of ['types', 'typings']) {
    if (typeof pkg?.[key] === 'string') return pkg[key].startsWith('./') ? pkg[key] : `./${pkg[key]}`;
  }
  return null;
}

/**
 * The published `require` entry points of one manifest.
 *
 * @param {any} pkg parsed package.json
 * @returns {{subpath: string, target: string}[]}
 */
export function requireEntries(pkg) {
  const out = [];
  const ex = pkg?.exports;
  if (ex && typeof ex === 'object' && !Array.isArray(ex)) {
    const keys = Object.keys(ex);
    if (keys.some((k) => k.startsWith('.'))) {
      for (const [sub, v] of Object.entries(ex)) {
        if (!sub.startsWith('.') || sub.includes('*')) continue;
        const t = resolveRequireTarget(v);
        if (t) out.push({ subpath: sub, target: t });
      }
    } else {
      const t = resolveRequireTarget(ex);
      if (t) out.push({ subpath: '.', target: t });
    }
  } else if (!ex && typeof pkg?.main === 'string') {
    // No `exports` map: `main` IS the require entry point.
    out.push({ subpath: '(main)', target: pkg.main });
  }
  return out;
}

/**
 * The `import`-condition twin of one subpath, for the AGREES probe. Mirror of
 * `resolveRequireTarget` with the two condition names swapped.
 *
 * @returns {string | null}
 */
export function importTargetFor(pkg, subpath) {
  const pick = (node, inImport = false) => {
    if (typeof node === 'string') return inImport ? node : null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const r = pick(n, inImport);
        if (r) return r;
      }
      return null;
    }
    if (node === null || typeof node !== 'object') return null;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'types' || k === 'require' || k === 'browser' || k.startsWith('.')) continue;
      if (k === 'import' || k === 'module') {
        const r = pick(v, true);
        if (r) return r;
        continue;
      }
      if (k === 'node' || k === 'default') {
        const r = pick(v, inImport);
        if (r) return r;
      }
    }
    return null;
  };
  const ex = pkg?.exports;
  if (ex && typeof ex === 'object' && !Array.isArray(ex)) {
    const keys = Object.keys(ex);
    if (keys.some((k) => k.startsWith('.'))) return subpath in ex ? pick(ex[subpath]) : null;
    if (subpath === '.') return pick(ex);
  }
  return null;
}

/** Collect the whole population: one row per published `require` entry point. */
export function collectEntries(root) {
  const rows = [];
  for (const mp of manifestPaths(root)) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(mp, 'utf8'));
    } catch {
      continue;
    }
    if (!pkg?.name || pkg.private === true) continue;
    const dir = dirname(mp);
    for (const { subpath, target } of requireEntries(pkg)) {
      const importTarget = importTargetFor(pkg, subpath);
      const typesTarget = requireTypesFor(pkg, subpath);
      rows.push({
        id: `${pkg.name}#${subpath}`,
        pkg: pkg.name,
        subpath,
        target,
        dir,
        relDir: relative(root, dir),
        abs: resolve(dir, target),
        importAbs: importTarget ? resolve(dir, importTarget) : null,
        typesTarget,
        typesAbs: typesTarget ? resolve(dir, typesTarget) : null,
        isModuleType: pkg.type === 'module',
      });
    }
  }
  return rows;
}

/**
 * Every emitted file in `dir`'s tree that node parses as CommonJS: `.cjs`
 * always, `.js` only when the package is not `"type": "module"`.
 */
function commonJsFilesUnder(dir, isModuleType) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.cjs') || (e.name.endsWith('.js') && !isModuleType)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// Probes -- both run in child processes, so a hard crash is a finding, not a
// dead gate.
// ---------------------------------------------------------------------------

function run(args) {
  return new Promise((res) => {
    const c = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    let out = '';
    c.stderr.on('data', (d) => {
      err += d;
    });
    c.stdout.on('data', (d) => {
      out += d;
    });
    c.on('close', (code) => res({ code, err, out: out.trim() }));
    c.on('error', (e) => res({ code: 1, err: String(e), out: '' }));
  });
}

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const k = i++;
      if (k >= items.length) return;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** First `…Error: …` line of a node diagnostic, trimmed for a one-line report. */
export function firstErrorLine(stderr) {
  const line = String(stderr)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^[A-Za-z]*Error(:| )/.test(l));
  return (line || String(stderr).split('\n').find(Boolean) || 'unknown failure').slice(0, 200);
}

/** Does this diagnostic say the bytes failed to PARSE? Never ledgerable. */
export function isParseFailure(stderr) {
  return /\bSyntaxError\b/.test(String(stderr));
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{rows: any[], findings: string[], prereq: string[], ledgerHits: string[], staleLedger: string[], orphanLedger: string[], cjsFileCount: number, typedEntries: number, typedJudged: number, typedExempt: string[], typedOrphans: string[], probesRun: number}>}
 */
export async function scan(root, ledger, probes = DUAL_FORMAT_BEHAVIOUR_PROBES, exemptions = TYPED_EXEMPTIONS) {
  const rows = collectEntries(root);
  const findings = [];
  const prereq = [];
  const ledgerHits = [];
  const staleLedger = [];
  // Computed off the population alone, so it survives the prerequisite early
  // return below: an orphaned exemption is a fact about the ledger, not about
  // whether anything was built.
  const orphanLedger = orphanLedgerRows(ledger, rows);
  let cjsFileCount = 0;
  // TYPED's own count, and its findings held aside so they report together
  // rather than interleaved with the per-row LOADS diagnostics.
  let typedEntries = 0;
  const typedFindings = [];
  // ⚠️ The floor counts entries JUDGED, never entries CLEAN. Measured while
  // ablating #13112's fix: with the floor on the clean count, restoring the 28
  // defective manifests drove it from 102 to 67 and the gate REFUSED (exit 2,
  // "nothing was read") instead of reporting its 35 findings — a real
  // regression rendered as a broken instrument, which is the one reading a
  // vacuity floor must never produce. A judged count is invariant to how many
  // entries are defective and falls only when the walk or the resolver stops
  // asking, which is the thing the floor is for.
  let typedJudged = 0;
  const typedExempt = [];
  // Both directions, same rule the load ledger learned the hard way: a row that
  // no longer names a live entry point is a finding, not dead text.
  const typedOrphans = Object.keys(exemptions)
    .filter((id) => !rows.some((r) => r.id === id))
    .map((id) => `${id} — TYPED_EXEMPTIONS carries a row for this id, but no published require condition resolves to it. Delete the row; it is exempting nothing.`);

  for (const r of rows) {
    r.distDir = join(r.dir, 'dist');
    r.exists = existsSync(r.abs) && statSync(r.abs).isFile();
    if (!r.exists) {
      if (!existsSync(r.distDir)) prereq.push(`${r.id} -> ${r.target} (no ${relative(root, r.distDir)})`);
      else findings.push(`${r.id}: declared require target ${r.target} is NOT emitted, though ${relative(root, r.distDir)} exists — the manifest advertises an entry point npm would ship and node cannot resolve.`);
      continue;
    }
    r.cjsFiles = commonJsFilesUnder(r.distDir, r.isModuleType);
    cjsFileCount += r.cjsFiles.length;

    // TYPED — see the header. Asked only of rows whose require target really
    // emitted, so a package that failed to build answers the LOADS question
    // first rather than collecting a second finding about the same absence.
    typedJudged++;
    if (!r.typesTarget) {
      findings.push(
        `${r.id}: the require condition resolves NO \`types\` — a consumer reading this entry point gets whatever `
          + `TypeScript finds beside ${r.target} by file adjacency, or nothing. Declare it: `
          + `"require": { "types": "./<the .d.cts twin>", "default": "${r.target}" }.`,
      );
    } else if (!(existsSync(r.typesAbs) && statSync(r.typesAbs).isFile())) {
      findings.push(
        `${r.id}: the require condition declares types ${r.typesTarget}, which is NOT emitted though `
          + `${relative(root, r.distDir)} exists — the manifest promises a declaration npm would ship and tsc cannot read.`,
      );
    } else if (declarationModuleKind(r.typesTarget, r.isModuleType) !== 'commonjs') {
      if (exemptions[r.id]) {
        typedExempt.push(`${r.id} — ${exemptions[r.id].reason}`);
        continue;
      }
      typedFindings.push(
        `${r.id}: the require condition resolves types ${r.typesTarget}, which is ESM-flavoured in a `
          + `"type": "module" package — so a CommonJS consumer under node16/nodenext resolution is handed an ES-module `
          + `declaration for a CommonJS entry point and gets TS1479 ("the referenced file is an ECMAScript module and `
          + `cannot be imported with 'require'"), while the JavaScript at ${r.target} loads perfectly. Give each `
          + `condition its own types: "import": { "types": "./x.d.ts", "default": "./x.js" }, `
          + `"require": { "types": "./x.d.cts", "default": "./x.cjs" }.`,
      );
    } else {
      typedEntries++;
    }
  }
  findings.push(...typedFindings);
  // The shrink-only direction: an exempted entry that is now CORRECT must lose
  // its row in the PR that fixed it, or the next reader reads a live blocker
  // where there is none.
  for (const [id, row] of Object.entries(exemptions)) {
    const r = rows.find((x) => x.id === id);
    if (!r || !r.exists || !r.typesTarget) continue;
    if (declarationModuleKind(r.typesTarget, r.isModuleType) === 'commonjs') {
      staleLedger.push(`${id} — TYPED_EXEMPTIONS says its require condition cannot resolve a CommonJS declaration, but it now does (${r.typesTarget}). Delete the row (shrink-only). Its recorded reason: ${row.reason}`);
    }
  }
  if (prereq.length) return { rows, findings, prereq, ledgerHits, staleLedger, orphanLedger, cjsFileCount, typedEntries, typedJudged, typedExempt, typedOrphans, probesRun: 0 };

  // PARSES — over the union of emitted CommonJS files, deduped across the
  // several entries a package may declare.
  const parseTargets = [...new Set(rows.flatMap((r) => r.cjsFiles ?? []))].sort();
  const parseResults = await mapLimited(parseTargets, PARSE_CONCURRENCY, async (f) => ({ f, ...(await run(['--check', f])) }));
  const parseBad = new Map();
  for (const { f, code, err } of parseResults) if (code !== 0) parseBad.set(f, firstErrorLine(err));

  // LOADS — one fresh child per entry.
  const live = rows.filter((r) => r.exists);
  const loadResults = await mapLimited(live, PARSE_CONCURRENCY, async (r) => ({ r, ...(await run(['-e', `require(${JSON.stringify(r.abs)})`])) }));

  for (const { r, code, err } of loadResults) {
    const ownParseBad = (r.cjsFiles ?? []).filter((f) => parseBad.has(f));
    const ledgered = ledger[r.id];
    if (ownParseBad.length) {
      // ⛔ Never ledgerable — see the header. A parse failure is always about
      // bytes we emitted.
      for (const f of ownParseBad) {
        const hint = /import\.meta/.test(readFileSync(f, 'utf8'))
          ? " The output carries `import.meta`, which is a PARSE-time error outside an ES module — add `shims: true` to this package's tsup.config.ts (see packages/metadata-core, packages/runtime, packages/metadata-protocol)."
          : '';
        findings.push(`${r.id}: emitted CommonJS does NOT parse — ${relative(root, f)}: ${parseBad.get(f)}.${hint}${ledgered ? ` ⛔ ${BASELINE_PATH} carries an entry for this id; a parse failure is never ledgerable, so it is ignored here.` : ''}`);
      }
      continue;
    }
    if (code === 0) {
      if (ledgered) staleLedger.push(`${r.id} — ${BASELINE_PATH} says it cannot be required, but it loads. Delete the entry (the ledger is shrink-only).`);
      continue;
    }
    const line = firstErrorLine(err);
    if (ledgered) ledgerHits.push(`${r.id} — ${ledgered.reason}`);
    else findings.push(`${r.id}: require(${r.target}) FAILED — ${line}`);
  }

  // AGREES — the declared cross-format behaviour probes.
  const probeResults = await runBehaviourProbes(root, rows, probes);
  findings.push(...probeResults.findings);

  return { rows, findings, prereq, ledgerHits, staleLedger, orphanLedger, cjsFileCount, typedEntries, typedJudged, typedExempt, typedOrphans, probesRun: probeResults.ran };
}

/** Read the expectation a probe declares. Only `spec-version` exists today. */
function expectedValueFor(root, probe) {
  if (probe.expect === 'spec-version') {
    const p = join(root, SCAN_ROOT, 'spec', 'package.json');
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')).version ?? null;
  }
  return probe.expect;
}

/**
 * Evaluate each declared probe's export in BOTH conditions, in two separate
 * child processes, and require the two answers to match each other and the
 * expectation.
 */
export async function runBehaviourProbes(root, rows, probes = DUAL_FORMAT_BEHAVIOUR_PROBES) {
  const findings = [];
  let ran = 0;
  for (const probe of probes) {
    const row = rows.find((r) => r.pkg === probe.pkg && r.subpath === probe.subpath);
    if (!row) {
      findings.push(`behaviour probe ${probe.pkg}#${probe.subpath} names an entry point that no longer exists — delete or repoint the probe (it is asserting nothing).`);
      continue;
    }
    if (!row.importAbs || !existsSync(row.importAbs)) {
      findings.push(`behaviour probe ${probe.pkg}#${probe.subpath}: no resolvable \`import\` condition to compare against — a cross-format claim needs both formats.`);
      continue;
    }
    const expected = expectedValueFor(root, probe);
    if (expected === null || expected === undefined) {
      findings.push(`behaviour probe ${probe.pkg}#${probe.subpath}: could not read the expectation '${probe.expect}' — ⛔ NOT a pass, nothing was compared.`);
      continue;
    }
    const call = `String(m[${JSON.stringify(probe.export)}]())`;
    const cjs = await run(['-e', `const m = require(${JSON.stringify(row.abs)}); process.stdout.write(${call});`]);
    const esm = await run(['--input-type=module', '-e', `const m = await import(${JSON.stringify(row.importAbs)}); process.stdout.write(${call});`]);
    ran += 1;
    const label = `behaviour probe ${probe.pkg}#${probe.subpath} → ${probe.export}()`;
    if (cjs.code !== 0) findings.push(`${label}: the require condition threw — ${firstErrorLine(cjs.err)}. ${probe.why}`);
    else if (esm.code !== 0) findings.push(`${label}: the import condition threw — ${firstErrorLine(esm.err)}. ${probe.why}`);
    else if (cjs.out !== esm.out) findings.push(`${label}: the two formats DISAGREE — require said '${cjs.out}', import said '${esm.out}'. ${probe.why}`);
    else if (cjs.out !== String(expected)) findings.push(`${label}: both formats agree on '${cjs.out}', but the declared expectation is '${expected}'. ${probe.why}`);
  }
  return { findings, ran };
}

function readLedger(root) {
  const p = join(root, BASELINE_PATH);
  if (!existsSync(p)) return {};
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  return raw.entries ?? {};
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(argv) {
  const root = REPO_ROOT;
  const ledger = readLedger(root);
  const { rows, findings, prereq, ledgerHits, staleLedger, orphanLedger, cjsFileCount, typedEntries, typedJudged, typedExempt, typedOrphans, probesRun } = await scan(root, ledger);

  if (argv.includes('--list')) {
    for (const r of rows) console.log(`${r.id.padEnd(48)} ${String(r.target).padEnd(34)} types=${r.typesTarget ?? '(none)'}`);
    console.log(`\n${rows.length} require entry point(s) across ${new Set(rows.map((r) => r.pkg)).size} publishable package(s).`);
    return EXIT_OK;
  }

  if (prereq.length) {
    console.error('PREREQUISITE NOT MET — this gate reads built output, and some package has no dist/.');
    for (const p of prereq.slice(0, 8)) console.error(`  · ${p}`);
    if (prereq.length > 8) console.error(`  · … ${prereq.length - 8} more`);
    console.error('Run `pnpm build` first. ⛔ This is NOT a pass: nothing was measured.');
    return EXIT_PREREQ;
  }

  // ⛔ Before any verdict: a run that read (almost) nothing must refuse, not
  // report the clean tree. Ordered after the prerequisite check so an unbuilt
  // tree still answers 3 — "nothing was measured" has its own code.
  const floor = floorProblem({
    entries: rows.length,
    packages: new Set(rows.map((r) => r.pkg)).size,
    cjsFiles: cjsFileCount,
    probes: probesRun,
    typedJudged,
  });
  if (floor !== null) {
    console.error(`check:dual-build-cjs-loads REFUSES — ${floor}`);
    return EXIT_REFUSE;
  }

  const problems = [...findings, ...staleLedger, ...orphanLedger, ...typedOrphans];
  if (problems.length) {
    console.error(`✗ check:dual-build-cjs-loads — ${problems.length} finding(s) across ${rows.length} published require entry point(s):`);
    for (const f of problems) console.error(`  ✗ ${f}`);
    console.error('');
    console.error('A `require` condition in an exports map is a published promise. A consumer that');
    console.error('resolves through it gets a load failure, not a degraded feature — and the repo\'s');
    console.error('own suites cannot see it, because vitest resolves workspace packages through the');
    console.error('`import` condition. The same blindness covers the TYPED findings: the declaration');
    console.error('a CJS consumer resolves is never the one this repo\'s own typecheck reads.');
    return EXIT_FINDINGS;
  }

  console.log(
    `✓ check:dual-build-cjs-loads — ${rows.length} published require entry point(s) across ` +
      `${new Set(rows.map((r) => r.pkg)).size} package(s) load; ${cjsFileCount} emitted CommonJS file(s) parse; ` +
      `${probesRun} cross-format behaviour probe(s) agree; ` +
      `${typedEntries} require condition(s) resolve a CommonJS-flavoured \`types\` that exists` +
      (ledgerHits.length ? `; ${ledgerHits.length} declared non-loadable entr(ies) still justified.` : '.'),
  );
  for (const h of ledgerHits) console.log(`  · declared: ${h}`);
  for (const h of typedExempt) console.log(`  · declared UNREACHABLE declaration: ${h}`);
  console.log(provenanceLine({
    entries: rows.length,
    packages: new Set(rows.map((r) => r.pkg)).size,
    cjsFiles: cjsFileCount,
    probes: probesRun,
  }));
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Self-test -- a REAL fixture tree with REAL emitted bytes, spawned for real.
// A model of a CJS parse failure would pass against a gate that never spawns.
// ---------------------------------------------------------------------------

function writePkg(root, name, manifest, files) {
  const dir = join(root, SCAN_ROOT, name);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), body);
  }
  return dir;
}

export async function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });

  // ── the declaration itself ────────────────────────────────────────────────
  const selfSrc = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  t('the watch hints are spelled as literals the extractor can read', ROOT_DIR_WATCH_HINTS.every((h) => selfSrc.includes(`'${h}'`)));
  t('the watch hints cover the manifest and the tsup config', ROOT_DIR_WATCH_HINTS.length === 2 && ROOT_DIR_WATCH_HINTS.every((h) => h.startsWith(`${SCAN_ROOT}/`)));
  t('⛔ the wide source spelling stays UNDECLARED — the measured refusal above', !ROOT_DIR_WATCH_HINTS.some((h) => h.endsWith('/src/**')));
  t('no hint collapses to the bare scan root', !ROOT_DIR_WATCH_HINTS.some((h) => h.replace(/\/\*+$/, '') === SCAN_ROOT));

  // ── the exports resolver ──────────────────────────────────────────────────
  t('a plain string under `require` resolves', resolveRequireTarget({ types: './x.d.ts', import: './x.js', require: './x.cjs' }) === './x.cjs');
  t('a NESTED {types, default} under `require` resolves (the @objectstack/spec spelling)', resolveRequireTarget({ import: { types: './a.d.mts', default: './a.mjs' }, require: { types: './a.d.ts', default: './a.js' } }) === './a.js');
  t('an `import`-only entry contributes nothing', resolveRequireTarget({ types: './x.d.ts', import: './x.js' }) === null);
  t('a bare `default` string outside any `require` is not a require target', resolveRequireTarget({ default: './x.js' }) === null);
  t('`browser` is never taken', resolveRequireTarget({ browser: { require: './b.js' }, require: './n.cjs' }) === './n.cjs');
  t('a subpath map yields one row per subpath', requireEntries({ exports: { '.': { require: './i.cjs' }, './t': { require: './t.cjs' }, './e': { import: './e.js' } } }).length === 2);
  t('a manifest with no exports falls back to `main`', requireEntries({ main: 'dist/index.js' })[0]?.target === 'dist/index.js');
  t('a wildcard subpath is skipped (no single file to probe)', requireEntries({ exports: { './x/*': { require: './x/*.cjs' } } }).length === 0);

  // ── the types resolver: what a `require` consumer actually READS ──────────
  t('THE #13112 shape: a SIBLING `types` answers for the require condition too',
    resolveRequireTypes({ types: './x.d.ts', import: './x.js', require: './x.cjs' }) === './x.d.ts');
  t('a nested `types` inside the require branch wins over nothing else',
    resolveRequireTypes({ import: { types: './x.d.ts', default: './x.js' }, require: { types: './x.d.cts', default: './x.cjs' } }) === './x.d.cts');
  t('⛔ the `import` branch is never read for a require consumer',
    resolveRequireTypes({ import: { types: './only-esm.d.ts', default: './x.mjs' }, require: { default: './x.cjs' } }) === null);
  t('`types` under a `default` fallback is reached', resolveRequireTypes({ default: { types: './x.d.ts', default: './x.js' } }) === './x.d.ts');
  t('an entry with no types anywhere resolves null', resolveRequireTypes({ import: './x.mjs', require: './x.js' }) === null);
  t('`browser` is not a types source', resolveRequireTypes({ browser: { types: './b.d.ts' }, require: { types: './n.d.cts', default: './n.cjs' } }) === './n.d.cts');

  // ── module kind: the reason the invariant is not "must end in .d.cts" ────
  t('`.d.cts` is CommonJS whatever the package type', declarationModuleKind('./x.d.cts', true) === 'commonjs' && declarationModuleKind('./x.d.cts', false) === 'commonjs');
  t('`.d.mts` is ESM whatever the package type', declarationModuleKind('./x.d.mts', false) === 'module');
  t('GREEN CONTROL — `.d.ts` in a CJS-first package is CommonJS-flavoured and correct under require',
    declarationModuleKind('./x.d.ts', false) === 'commonjs');
  t('THE defect — `.d.ts` in a "type": "module" package is ESM-flavoured', declarationModuleKind('./x.d.ts', true) === 'module');
  t('requireTypesFor reads the named subpath', requireTypesFor({ exports: { '.': { types: './a.d.ts' }, './b': { require: { types: './b.d.cts', default: './b.cjs' } } } }, './b') === './b.d.cts');
  t('requireTypesFor falls back to the root `types` for a (main) row', requireTypesFor({ types: 'dist/index.d.ts' }, '(main)') === './dist/index.d.ts');

  // ── diagnostics classification ────────────────────────────────────────────
  t('a SyntaxError diagnostic is a parse failure', isParseFailure("foo.cjs:1\nSyntaxError: Cannot use 'import.meta' outside a module"));
  t('a plain Error diagnostic is NOT a parse failure', !isParseFailure('Error: Vitest cannot be imported in a CommonJS module using require().'));
  t('firstErrorLine picks the error, not the source echo', firstErrorLine("dist/index.cjs:810\n  const x = import.meta.url\nSyntaxError: Cannot use 'import.meta' outside a module") === "SyntaxError: Cannot use 'import.meta' outside a module");

  // ── the fixture tree ──────────────────────────────────────────────────────
  const root = mkdtempSync(join(tmpdir(), 'dual-cjs-'));
  try {
    // The shape the TYPED invariant demands: each condition names its own
    // declaration. Every fixture below is built from it, so a TYPED regression
    // shows up as a failure in the case it belongs to rather than as noise in
    // all of them.
    const dual = {
      type: 'module',
      exports: {
        '.': {
          import: { types: './dist/index.d.ts', default: './dist/index.js' },
          require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
        },
      },
    };
    // The declarations those conditions name. Real files, because TYPED asks
    // whether they are on disk and a modelled answer would not be an answer.
    const DTS = { 'dist/index.d.ts': 'export declare const ok: number;\n', 'dist/index.d.cts': 'export declare const ok: number;\n' };

    writePkg(root, 'good', { name: '@t/good', version: '0.0.0', ...dual }, {
      'dist/index.js': 'export const ok = 1;\n',
      'dist/index.cjs': 'exports.ok = 1;\n',
      ...DTS,
    });
    // THE case: `import.meta` verbatim in a CJS output — #12971 exactly.
    writePkg(root, 'importmeta', { name: '@t/importmeta', version: '0.0.0', ...dual }, {
      'dist/index.js': 'export const u = import.meta.url;\n',
      'dist/index.cjs': 'exports.u = import.meta.url;\n',
      ...DTS,
    });
    // …and in a shared CHUNK the entry does not even reference, which a
    // require-only smoke would miss.
    writePkg(root, 'chunk', { name: '@t/chunk', version: '0.0.0', ...dual }, {
      'dist/index.js': 'export const ok = 1;\n',
      'dist/index.cjs': 'exports.ok = 1;\n',
      'dist/chunk-AAA.cjs': 'exports.u = import.meta.url;\n',
      ...DTS,
    });
    // Parses, then throws at load — the half a parse check cannot see.
    writePkg(root, 'throws', { name: '@t/throws', version: '0.0.0', ...dual }, {
      'dist/index.js': 'export const ok = 1;\n',
      'dist/index.cjs': "throw new Error('nope at load');\n",
      ...DTS,
    });
    writePkg(root, 'esmonly', { name: '@t/esmonly', version: '0.0.0', type: 'module', exports: { '.': { import: './dist/index.js' } } }, {
      'dist/index.js': 'export const ok = 1;\n',
    });

    const empty = {};
    const r1 = await scan(root, empty, []);
    t('a clean dual package is silent', !r1.findings.some((f) => f.includes('@t/good')), r1.findings.join(' | '));
    t('an ESM-only package is not in the population at all', !r1.rows.some((x) => x.pkg === '@t/esmonly'));
    t('THE case: `import.meta` in the CJS output is a finding', r1.findings.some((f) => f.startsWith('@t/importmeta#.') && /does NOT parse/.test(f)), r1.findings.join(' | '));
    t('…and the finding names the shim as the remedy', r1.findings.some((f) => f.includes('@t/importmeta') && f.includes('shims: true')));
    t('a poisoned CHUNK the entry never imports is still a finding', r1.findings.some((f) => f.startsWith('@t/chunk#.') && f.includes('chunk-AAA.cjs')), r1.findings.join(' | '));
    t('a module that parses and throws at load is a finding', r1.findings.some((f) => f.startsWith('@t/throws#.') && /require\(.*\) FAILED/.test(f)), r1.findings.join(' | '));
    t('the load finding carries the real message', r1.findings.some((f) => f.includes('nope at load')));

    // ── the ledger, both directions ───────────────────────────────────────────
    const withLedger = { '@t/throws#.': { reason: 'declared for the self-test' } };
    const r2 = await scan(root, withLedger, []);
    t('a ledgered load failure is declared, not a finding', !r2.findings.some((f) => f.startsWith('@t/throws#.')) && r2.ledgerHits.some((h) => h.startsWith('@t/throws#.')), JSON.stringify(r2.ledgerHits));
    const rNoHelp = await scan(root, { '@t/importmeta#.': { reason: 'should not help' } }, []);
    t('⛔ a ledger entry can NEVER silence a parse failure', rNoHelp.findings.some((f) => f.startsWith('@t/importmeta#.') && /does NOT parse/.test(f)));
    t('…and the gate SAYS the ledger was ignored', rNoHelp.findings.some((f) => f.includes('never ledgerable')));
    const r3 = await scan(root, { '@t/good#.': { reason: 'stale' } }, []);
    t('a ledger entry that now loads is a finding (shrink-only)', r3.staleLedger.some((s) => s.startsWith('@t/good#.')), JSON.stringify(r3.staleLedger));

    // THE #13014 case: a row whose id left the population. Unreachable from
    // the row walk by construction, so it needs its own pass and its own pin.
    const rOrphan = await scan(root, { '@t/vanished#./gone': { reason: 'exempts an entry point that no longer exists' } }, []);
    t('THE #13014 case: a ledger row naming an entry NOT in the population is a finding',
      rOrphan.orphanLedger.some((s) => s.startsWith('@t/vanished#./gone')), JSON.stringify(rOrphan.orphanLedger));
    t('…and the finding says the row is exempting nothing',
      rOrphan.orphanLedger.some((s) => s.includes('exempting nothing')));
    t('…and it is reported even with the rest of the tree clean',
      rOrphan.orphanLedger.length === 1, JSON.stringify(rOrphan.orphanLedger));
    // GREEN CONTROL — the half that proves the new pass is not just "always
    // red". A row that DOES name a live entry point must stay silent here.
    t('GREEN CONTROL — a ledger row naming a live entry point is not an orphan',
      r2.orphanLedger.length === 0, JSON.stringify(r2.orphanLedger));
    t('GREEN CONTROL — an empty ledger produces no orphans', r1.orphanLedger.length === 0);
    // Pure, so it can be driven without a tree at all.
    t('orphanLedgerRows() reads the ids, not the order',
      orphanLedgerRows({ 'b#.': {}, 'a#.': {} }, [{ id: 'a#.' }]).length === 1
      && orphanLedgerRows({ 'b#.': {}, 'a#.': {} }, [{ id: 'a#.' }])[0].startsWith('b#.'));

    // ── AGREES: the cross-format behaviour probe, both directions ────────────
    writePkg(root, 'agree', { name: '@t/agree', version: '0.0.0', ...dual }, {
      'dist/index.js': "export const v = () => 'same';\n",
      'dist/index.cjs': "exports.v = () => 'same';\n",
      ...DTS,
    });
    // Loads in both formats, parses in both, and still disagrees — the silent
    // degradation a load smoke alone cannot see.
    writePkg(root, 'disagree', { name: '@t/disagree', version: '0.0.0', ...dual }, {
      'dist/index.js': "export const v = () => 'from-esm';\n",
      'dist/index.cjs': "exports.v = () => null;\n",
      ...DTS,
    });
    const agreeProbe = [{ pkg: '@t/agree', subpath: '.', export: 'v', expect: 'same', why: 'self-test' }];
    const disagreeProbe = [{ pkg: '@t/disagree', subpath: '.', export: 'v', expect: 'from-esm', why: 'self-test' }];
    const pOk = await scan(root, empty, agreeProbe);
    t('two agreeing formats pass the behaviour probe', !pOk.findings.some((f) => f.includes('@t/agree')) && pOk.probesRun === 1, pOk.findings.join(' | '));
    const pBad = await scan(root, empty, disagreeProbe);
    t('THE silent case: both formats load, both parse, and they DISAGREE → finding', pBad.findings.some((f) => f.includes('@t/disagree') && f.includes('DISAGREE')), pBad.findings.join(' | '));
    t('…and the finding quotes both answers', pBad.findings.some((f) => f.includes("'from-esm'") && f.includes("'null'")));
    const pWrong = await scan(root, empty, [{ pkg: '@t/agree', subpath: '.', export: 'v', expect: 'something-else', why: 'self-test' }]);
    t('agreement on the WRONG value is still a finding', pWrong.findings.some((f) => f.includes('@t/agree') && f.includes('declared expectation')), pWrong.findings.join(' | '));
    const pGone = await scan(root, empty, [{ pkg: '@t/no-such-package', subpath: '.', export: 'v', expect: 'x', why: 'self-test' }]);
    t('a probe naming a vanished entry point is a finding, not a silent skip', pGone.findings.some((f) => f.includes('no longer exists')), pGone.findings.join(' | '));

    // ── TYPED: the #13112 class, in both directions ─────────────────────────
    //
    // Every case below emits real declaration files, because the invariant is
    // partly "is it on disk" and a modelled file answers nothing.
    const siblingTypes = { type: 'module', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js', require: './dist/index.cjs' } } };
    writePkg(root, 'sibling', { name: '@t/sibling', version: '0.0.0', ...siblingTypes }, {
      'dist/index.js': 'export const ok = 1;\n', 'dist/index.cjs': 'exports.ok = 1;\n',
      'dist/index.d.ts': 'export declare const ok: number;\n', 'dist/index.d.cts': 'export declare const ok: number;\n',
    });
    // GREEN CONTROL — the SAME sibling-`types` spelling in a CJS-FIRST
    // package, where `dist/index.d.ts` really is the CommonJS declaration.
    // This is the case that keeps the invariant module-KIND rather than the
    // `.d.cts` extension: an extension rule reds this correct package, and 50
    // entries in this repo are spelled exactly this way.
    writePkg(root, 'cjsfirst', { name: '@t/cjsfirst', version: '0.0.0', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs', require: './dist/index.js' } } }, {
      'dist/index.mjs': 'export const ok = 1;\n', 'dist/index.js': 'exports.ok = 1;\n',
      'dist/index.d.ts': 'export declare const ok: number;\n',
    });
    // A require branch that names a declaration nothing emitted.
    writePkg(root, 'notypesfile', { name: '@t/notypesfile', version: '0.0.0', ...dual }, {
      'dist/index.js': 'export const ok = 1;\n', 'dist/index.cjs': 'exports.ok = 1;\n',
      'dist/index.d.ts': 'export declare const ok: number;\n',
    });
    // A require branch that names no declaration at all.
    writePkg(root, 'notypes', { name: '@t/notypes', version: '0.0.0', type: 'module', exports: { '.': { import: './dist/index.js', require: './dist/index.cjs' } } }, {
      'dist/index.js': 'export const ok = 1;\n', 'dist/index.cjs': 'exports.ok = 1;\n',
    });
    // ⛔ An EXPLICITLY empty exemption table: the default is the SHIPPED one,
    // whose rows name real repo packages that do not exist in this fixture
    // tree — passing it here would manufacture two orphans and make the
    // green control below assert the opposite of what it says.
    const rTyped = await scan(root, empty, [], {});
    t('THE #13112 case: a sibling `types` in a "type": "module" package is a TYPED finding',
      rTyped.findings.some((f) => f.startsWith('@t/sibling#.') && f.includes('ESM-flavoured')), rTyped.findings.join(' | '));
    t('…and the finding names TS1479, the error the consumer actually sees',
      rTyped.findings.some((f) => f.startsWith('@t/sibling#.') && f.includes('TS1479')));
    t('…and it prescribes the per-condition shape',
      rTyped.findings.some((f) => f.startsWith('@t/sibling#.') && f.includes('"require": { "types": "./x.d.cts"')));
    t('GREEN CONTROL — the same spelling in a CJS-FIRST package is silent',
      !rTyped.findings.some((f) => f.startsWith('@t/cjsfirst#.')), rTyped.findings.filter((f) => f.includes('cjsfirst')).join(' | '));
    t('GREEN CONTROL — a correctly nested dual package is silent',
      !rTyped.findings.some((f) => f.startsWith('@t/good#.')), rTyped.findings.filter((f) => f.includes('@t/good')).join(' | '));
    t('a require branch naming a declaration that was never emitted is a finding',
      rTyped.findings.some((f) => f.startsWith('@t/notypesfile#.') && f.includes('is NOT emitted')), rTyped.findings.join(' | '));
    t('a require branch that resolves NO types at all is a finding, not a silent pass',
      rTyped.findings.some((f) => f.startsWith('@t/notypes#.') && f.includes('resolves NO')), rTyped.findings.join(' | '));
    // Every live entry is judged exactly once: it is either counted clean or
    // it produced one TYPED finding. A count that drifts from that partition
    // is the vacuity the floor above exists to catch, one layer up.
    const typedFindingCount = rTyped.findings.filter((f) => /resolves NO |is NOT emitted though|ESM-flavoured in a/.test(f)).length;
    t('every live entry is judged exactly once — counted clean OR reported',
      rTyped.typedEntries + typedFindingCount === rTyped.typedJudged
      && rTyped.typedJudged === rTyped.rows.filter((r) => r.exists).length,
      `clean=${rTyped.typedEntries} findings=${typedFindingCount} judged=${rTyped.typedJudged} live=${rTyped.rows.filter((r) => r.exists).length}`);
    t('…and three of the fixtures are the reported ones', typedFindingCount === 3, String(typedFindingCount));

    // ── TYPED_EXEMPTIONS, both directions ───────────────────────────────────
    const exemptSibling = { '@t/sibling#.': { reason: 'self-test: a declared, measured reason long enough to be real' } };
    const rExempt = await scan(root, empty, [], exemptSibling);
    t('an exempted TYPED entry is DECLARED, not a finding',
      !rExempt.findings.some((f) => f.startsWith('@t/sibling#.') && f.includes('ESM-flavoured'))
      && rExempt.typedExempt.some((h) => h.startsWith('@t/sibling#.')), JSON.stringify(rExempt.typedExempt));
    t('…and it is still not COUNTED as clean — an exemption is not a pass',
      rExempt.typedEntries === rTyped.typedEntries, `exempt-run=${rExempt.typedEntries} plain-run=${rTyped.typedEntries}`);
    t('⛔ an exemption never silences a MISSING declaration (a different fact)',
      (await scan(root, empty, [], { '@t/notypesfile#.': { reason: 'self-test: should not help, the file is simply absent' } }))
        .findings.some((f) => f.startsWith('@t/notypesfile#.') && f.includes('is NOT emitted')));
    const rStale = await scan(root, empty, [], { '@t/good#.': { reason: 'self-test: stale, this entry is correctly split already' } });
    t('an exemption on an entry that is now CORRECT is a finding (shrink-only)',
      rStale.staleLedger.some((x) => x.startsWith('@t/good#.') && x.includes('TYPED_EXEMPTIONS')), JSON.stringify(rStale.staleLedger));
    const rOrph = await scan(root, empty, [], { '@t/nowhere#./gone': { reason: 'self-test: names an entry point that does not exist at all' } });
    t('an exemption naming an entry NOT in the population is a finding',
      rOrph.typedOrphans.some((x) => x.startsWith('@t/nowhere#./gone') && x.includes('exempting nothing')), JSON.stringify(rOrph.typedOrphans));
    t('GREEN CONTROL — an empty exemption table produces no orphans and no declarations',
      rTyped.typedOrphans.length === 0 && rTyped.typedExempt.length === 0);

    // The shipped probe table must name entry points that really exist here.
    const realRows = collectEntries(REPO_ROOT);
    t('every shipped behaviour probe names a live require entry point', DUAL_FORMAT_BEHAVIOUR_PROBES.every((p) => realRows.some((r) => r.pkg === p.pkg && r.subpath === p.subpath)), JSON.stringify(DUAL_FORMAT_BEHAVIOUR_PROBES.map((p) => `${p.pkg}#${p.subpath}`)));
    t('every shipped behaviour probe states why it exists', DUAL_FORMAT_BEHAVIOUR_PROBES.every((p) => typeof p.why === 'string' && p.why.length > 20));

    // ── prerequisite, never a silent green ───────────────────────────────────
    const bare = mkdtempSync(join(tmpdir(), 'dual-cjs-bare-'));
    try {
      writePkg(bare, 'unbuilt', { name: '@t/unbuilt', version: '0.0.0', ...dual }, {});
      rmSync(join(bare, SCAN_ROOT, 'unbuilt', 'dist'), { recursive: true, force: true });
      const r4 = await scan(bare, empty, []);
      t('an unbuilt package is PREREQUISITE NOT MET, not a pass and not a finding', r4.prereq.length === 1 && r4.findings.length === 0, JSON.stringify(r4.prereq));
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }

    // ── a built tree missing one declared target IS a finding ────────────────
    const half = mkdtempSync(join(tmpdir(), 'dual-cjs-half-'));
    try {
      writePkg(half, 'half', { name: '@t/half', version: '0.0.0', ...dual }, { 'dist/index.js': 'export const ok = 1;\n' });
      const r5 = await scan(half, empty, []);
      t('a dist that exists but omits the declared require target is a finding', r5.prereq.length === 0 && r5.findings.some((f) => f.includes('NOT emitted')), JSON.stringify(r5));
    } finally {
      rmSync(half, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // ── the vacuity floors, each driven to zero ──────────────────────────────
  //
  // A floor that cannot refuse is the joke this card is about, so every one is
  // driven down individually AND the measured tuple is asserted to clear them
  // all — a floor accidentally set above its own measurement would red every
  // real run, which is the opposite failure and just as invisible in review.
  const full = { entries: MEASURED.entries, packages: MEASURED.packages, cjsFiles: MEASURED.cjsFiles, probes: MEASURED.probes, typedJudged: MEASURED_TYPED.typedJudged };
  t('FLOOR — the values in the records clear every floor', floorProblem(full) === null, JSON.stringify(floorProblem(full)));
  t('FLOOR — a dead manifest walk refuses', floorProblem({ ...full, entries: 0 }) !== null);
  t('FLOOR — entries collapsed onto too few packages refuses', floorProblem({ ...full, packages: 0 }) !== null);
  t('FLOOR — a dead CommonJS collector refuses (PARSES over an empty set)', floorProblem({ ...full, cjsFiles: 0 }) !== null);
  t('FLOOR — an emptied probe table refuses (AGREES satisfied vacuously)', floorProblem({ ...full, probes: 0 }) !== null);
  t('FLOOR — a dead types resolver refuses (TYPED judged nothing)', floorProblem({ ...full, typedJudged: 0 }) !== null);
  t('FLOOR — the TYPED refusal cites the tree ITS number came from, not the older one',
    /\(102 on 196612a313\)/.test(floorProblem({ ...full, typedJudged: 0 }) ?? ''), JSON.stringify(floorProblem({ ...full, typedJudged: 0 })));
  // ⛔ The measured regression the floor must NOT produce: a tree where every
  // one of the 35 defective entries is judged and reported still clears it,
  // because judged does not fall when clean does. With the floor on the clean
  // count this returned a refusal and the 35 findings were never printed.
  t('FLOOR — a tree FULL of TYPED findings still reports them, never refuses',
    floorProblem({ ...full, typedJudged: MEASURED_TYPED.typedJudged }) === null);
  t('FLOOR — a missing count is zero, not "unmeasured but fine"', floorProblem({}) !== null);
  t('FLOOR — the refusal names the count, the floor and the measurement',
    new RegExp(`measured only 0 .* below the floor of \\d+ \\(${MEASURED.cjsFiles} on ${MEASURED.ref}\\)`, 's')
      .test(floorProblem({ ...full, cjsFiles: 0 }) ?? ''),
    JSON.stringify(floorProblem({ ...full, cjsFiles: 0 })));
  t('FLOOR — every floor sits at or below the value it was measured from',
    MIN_ENTRIES <= MEASURED.entries && MIN_PACKAGES <= MEASURED.packages
    && MIN_CJS_FILES <= MEASURED.cjsFiles && MIN_PROBES <= MEASURED.probes
    && MIN_TYPED_JUDGED <= MEASURED_TYPED.typedJudged);
  t('FLOOR — both census records carry the tree they were measured on',
    typeof MEASURED.ref === 'string' && MEASURED.ref.length >= 10
    && typeof MEASURED_TYPED.ref === 'string' && MEASURED_TYPED.ref.length >= 10);
  t('FLOOR — the refusal code is distinct from findings and prerequisite',
    EXIT_REFUSE !== EXIT_FINDINGS && EXIT_REFUSE !== EXIT_PREREQ && EXIT_REFUSE !== EXIT_OK);

  // ── provenance: the record must stay reproducible, and visibly so ────────
  //
  // None of these can red on a tree that legitimately moved — that is the
  // point. They red when the RECORD stops being a self-contained, reproducible
  // claim: a ref that is not a ref, a quotation that restated the ref instead
  // of reading it, or a pass line that stopped showing the reader both numbers.
  t('PROVENANCE — the record carries the ref it was measured on',
    typeof MEASURED.ref === 'string' && /^[0-9a-f]{7,40}$/.test(MEASURED.ref), JSON.stringify(MEASURED.ref));
  t('PROVENANCE — the refusal reads the ref from the record rather than restating it',
    (floorProblem({ ...full, entries: 0 }) ?? '').includes(MEASURED.ref),
    JSON.stringify(floorProblem({ ...full, entries: 0 })));
  const provDrifted = provenanceLine({ entries: 102, packages: 66, cjsFiles: 610, probes: 1 });
  t('PROVENANCE — a passing run shows the census it read AND the census the floors came from',
    provDrifted.includes('102/66/610/1')
    && provDrifted.includes(`${MEASURED.entries}/${MEASURED.packages}/${MEASURED.cjsFiles}/${MEASURED.probes}`)
    && provDrifted.includes(`${MIN_ENTRIES}/${MIN_PACKAGES}/${MIN_CJS_FILES}/${MIN_PROBES}`)
    && provDrifted.includes(MEASURED.ref), provDrifted);
  t('PROVENANCE — drift is reported in BOTH directions, and equality says so',
    provDrifted.includes('-1/-1/-3/=')
    && provenanceLine({ ...full }).includes('=/=/=/=')
    && provenanceLine({ ...full, entries: MEASURED.entries + 15 }).includes('+15/'),
    provDrifted);
  t('PROVENANCE — the PASS path actually prints it (a line nothing calls is the defect above)',
    readFileSync(fileURLToPath(import.meta.url), 'utf8').includes(`console.log(${'provenanceLine'}({`),
    'the pass path in main() no longer calls provenanceLine — the record would stop being reconciled in the log');
  t('PROVENANCE — the delta is marked as information, never as a verdict',
    /not a verdict/i.test(provDrifted) && !/✗|REFUSES/.test(provDrifted), provDrifted);

  // ── the real ledger is well-formed and shrink-only in shape ───────────────
  // The SHIPPED exemption table against the REAL population — the half a
  // fixture tree cannot give, and the one that goes stale silently.
  const realEntries = collectEntries(REPO_ROOT);
  t('every shipped TYPED exemption names a live require entry point',
    Object.keys(TYPED_EXEMPTIONS).every((id) => realEntries.some((r) => r.id === id)),
    JSON.stringify(Object.keys(TYPED_EXEMPTIONS).filter((id) => !realEntries.some((r) => r.id === id))));
  t('every shipped TYPED exemption carries a reason that says what was measured',
    Object.values(TYPED_EXEMPTIONS).every((v) => typeof v?.reason === 'string' && v.reason.length > 80));
  t('every shipped TYPED exemption is an entry that really is ESM-flavoured under require',
    Object.keys(TYPED_EXEMPTIONS).every((id) => {
      const r = realEntries.find((x) => x.id === id);
      return r && r.typesTarget && declarationModuleKind(r.typesTarget, r.isModuleType) !== 'commonjs';
    }), JSON.stringify(Object.keys(TYPED_EXEMPTIONS)));

  const realLedger = readLedger(REPO_ROOT);
  t('every real ledger entry carries a reason', Object.values(realLedger).every((v) => typeof v?.reason === 'string' && v.reason.length > 20));
  t('every real ledger key is `<package>#<subpath>`', Object.keys(realLedger).every((k) => /^[^#]+#(\.|\.\/.+|\(main\))$/.test(k)));
  // The shipped ledger against the REAL population — the shipped half of the
  // orphan direction, and the one a self-test over fixtures cannot give.
  t('every shipped ledger row names a live require entry point',
    orphanLedgerRows(realLedger, collectEntries(REPO_ROOT)).length === 0,
    JSON.stringify(orphanLedgerRows(realLedger, collectEntries(REPO_ROOT))));

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-dual-build-cjs-loads self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`✓ check-dual-build-cjs-loads self-test: ${cases.length} cases pass (real emitted bytes, real spawns; both stale-ledger directions including the orphan one, every vacuity floor driven to zero with its green control, the parse failure the ledger may never silence, the record's ref reproducible, quoted from the record and printed on the pass path, and TYPED in both directions — the #13112 shape red, the identically-spelled CJS-first package green).`);

  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const code = argv.includes('--self-test') ? await selfTest() : await main(argv);
  process.exit(code);
}
