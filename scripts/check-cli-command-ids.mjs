#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-cli-command-ids (#12016) -- a CLI command id spelled as a STRING LITERAL
 * outside the CLI package must resolve to a real command path inside it.
 *
 *   node scripts/check-cli-command-ids.mjs              # audit the population
 *   node scripts/check-cli-command-ids.mjs --list       # print every literal and where it resolves
 *   node scripts/check-cli-command-ids.mjs --self-test  # verify the checker itself
 *
 * ## The coupling, and why nothing was holding it
 *
 * `packages/drivers/driver-sql/src/schema-drift.ts` tells an operator standing on a
 * corrupted column to run `os migrate multi-value-columns`:
 *
 *     export const MULTI_VALUE_COLUMN_REMEDY_COMMAND = 'os migrate multi-value-columns';
 *
 * That string has to match the oclif command id derived from the path
 * `packages/cli/src/commands/migrate/multi-value-columns.ts`. It is a STRING on
 * purpose -- the alternative is the engine importing from the CLI that boots it,
 * which is worse -- and the declaration comment says so. The coupling is
 * deliberate. Its UNENFORCEDNESS was the finding (#12016, from #11535 / PR #12012).
 *
 * The failure mode is the quiet one: a rename that updates `packages/cli` and the
 * docs but not the driver leaves a STALE HINT INSIDE AN OTHERWISE-CORRECT WARNING.
 * No suite reads that as wrong -- driver-sql's own pin asserts the emitted message
 * CONTAINS the constant, and the constant still matches itself. `declared != enforced`,
 * one layer out.
 *
 * ## Why the general form, and not a pin on that one constant
 *
 * The card proposed this gate on the argument that the constant "is unlikely to stay
 * the only such string", and that is a claim about a population nobody had counted.
 * It was counted before this file was written, on 8a7d070dba -- `--list` reprints it:
 *
 *   - 71 command ids are derivable from `packages/cli/src/commands/**`: 61 from command
 *     files and 11 topic directories, `migrate` being both (it has an `index.ts`).
 *     No `static aliases` anywhere in the tree.
 *   - 274 command-id literals sit in non-test source OUTSIDE `packages/cli`,
 *     across 98 files.
 *   - `packages/spec/src/migrations/registry.ts` carries 40, `schema-drift.ts` 14,
 *     `sql-driver.ts` 10.
 *   - The named constant is one of 14 IN ITS OWN FILE. The SAME warning message
 *     that interpolates it also spells `"os migrate apply"` inline, as a bare
 *     literal with no constant and no pin at all.
 *
 * So the population was never one string; it was 274, and the finding's own file is
 * among the densest sites in the repo. A per-constant pin would have covered 1 of 274
 * and left the identical hazard on the next line of the same template literal.
 *
 * ## The sibling half, inside `packages/cli` (#11465 / PR #12177)
 *
 * The same class was measured INSIDE the CLI package on the same days: 536 invocations
 * in 107 sources, 6 unresolved, two stale and two deliberate. That card chose to fix
 * and DECLARE rather than gate, and #12177's declarations say in prose that "a sweep
 * over the documented CLI invocations in this package will flag both of them". This
 * gate's population starts where that one stops -- every oclif package is excluded from
 * its own scan -- so the two never touch the same line. Two of its lessons are built in
 * here rather than rediscovered: a bare TOPIC resolves (its `os datasource` false
 * positive cannot occur), and an exemption asserts its own cause still holds.
 *
 * ## The resolution rule, derived and not listed
 *
 * Command ids come from the oclif filesystem convention -- the same derivation
 * `scripts/docs-audit/affected-docs.mjs` uses for its `command` doc anchor -- and from
 * DECLARED data, never a curated table:
 *
 *   - Which packages are CLIs: any package whose `package.json` declares `oclif.bin`.
 *     Gated on the declaration, not on a hardcoded `packages/cli` path, so a second
 *     CLI package is covered the day it lands.
 *   - Which binary names count: `oclif.bin` plus every `bin` key the package declares.
 *   - Which ids exist: `src/commands/<a>/<b>.ts` -> `<a> <b>`, and `<a>/index.ts` -> `<a>`.
 *   - A DIRECTORY under `src/commands/` is a TOPIC and resolves too. `os meta` has no
 *     `meta/index.ts`, but `meta/` exists, and oclif serves a topic as topic help --
 *     not as an unknown-command error. `plugin-auth`'s `'os meta' run` prose is
 *     therefore correct, and calling it a violation would be the gate fabricating one.
 *     Renaming the DIRECTORY still reds it, which is the coupling that matters.
 *
 * ## What counts as a literal: the delimiter is the whole precision story
 *
 * The candidate must open IMMEDIATELY after a `'`, `"` or backtick -- the bin name is
 * the first thing in the quoted run. That single rule is what makes an honest detector
 * possible, and it was measured too: the loose form ("a bin name anywhere on a quoted
 * line") produced 9 unresolvable hits of which 6 were noise -- Spanish translation
 * prose where `\b` fired inside `envios diarios`, a Python `import os from 'os'`
 * example, and the sentence "carry an os validate-clean security posture". Every one
 * of those has a LETTER or a SPACE before the `os`, and the delimiter rule drops all
 * six without a single carve-out. What survives is 231 resolving literals and the
 * FIXTURES below.
 *
 * Comment lines are out of population. A comment naming a renamed command is stale
 * prose; the string in an operator's terminal is the thing that misroutes them. Tests
 * are out for the same reason plus one more: a test that pins a command id is asserting
 * about the CLI, and the CLI's own suite is where that belongs.
 *
 * ## Docs are NOT this gate's job, and are not uncovered either
 *
 * `content/docs/deployment/cli.mdx` spells the same command. It is already carried:
 * `affected-docs.mjs`'s `command` anchor maps a changed command FILE to the doc pages
 * naming its phrase, verified on this repo -- a diff touching
 * `packages/cli/src/commands/migrate/multi-value-columns.ts` lists
 * `content/docs/deployment/cli.mdx`. Extending THIS gate over prose would mean
 * deciding, without a delimiter to lean on, which of 811 `os ...` mentions in
 * `content/docs` is a command and which is a sentence -- precisely the fabrication
 * `affected-docs.mjs`'s own header refuses. Source has quotes; prose does not.
 */

import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isEntrypoint } from './invoked-as.mjs';
import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url, {
  measures: 'whether every module under a CLI package\'s `src/commands/` default-exports a command class (#17869)',
});
import { parseSourceFile } from './ts-parse.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// This self-test used to decide success by "no failure was recorded" and
// nothing else, so "every case held" and "the cases never ran" printed the same
// line. Closed the way PR #13487 validated on check-doc-authoring: what is
// pinned is the registered NAMES, not a number. Every section opens with
// `battery('<name>')`, every assertion is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3 keeps
// a total "right" the moment a sibling grows. A set difference says WHICH
// battery stopped; a count says only that something did.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
//
// The machinery lives HERE, at module scope, rather than inside the self-test:
// this self-test's assertion sink is not a block-bodied helper in its body (it
// is a concise arrow, or a module-scope function), so there is no in-body
// helper to thread a per-run ledger through. Module scope is safe because the
// self-test runs once per process, and it is what lets the existing sink route
// through `registerCase()` with no case rewritten and no assertion changed.
const SELF_TEST_BATTERIES = Object.freeze({
  'the id derivation, against a scratch tree (no repo state)': 12,
  'a KNOWN-BAD literal: a command id that resolves to nothing': 3,
  'the delimiter rule: the six measured noise shapes stay OUT': 6,
  'the exemption ledger is site-scoped, not blanket': 3,
  'the ledger self-retires: a listed entry that stops reproducing REDS': 3,
  'the dispatch-gates declaration (#12016\'s own landing obligation)': 5,
  'bin names come from declared data': 3,
  'the live repo returns a verdict, and it is green': 4,
  'the command-class predicate, against a scratch tree (no repo state)': 10,
  'the command-module duty on the live repo, by name': 8,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 10;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// ⚠️ None of these helpers is named with a self-test spelling, deliberately and
// on the record: `check:pm-dispatch-gates` anchors on a top-level declaration
// whose NAME spells self-test, and every such name owes a row in that gate's
// COMPOUND_ANCHOR_LEDGER. These are the battery ROSTER's machinery -- they hold
// no fixtures to mask and read no path literal -- so the accurate name is the
// one that says `battery`, not the one that would owe a ledger row for a role
// this code does not have.

/** Cases registered per battery: `battery()` opens one, `registerCase()` files into it. */
const batteryCases = new Map();
let openBattery = null;

/** Open a battery. Every assertion after this line is attributed to it. */
function battery(name) {
  openBattery = name;
}

/** Called by the self-test's own assertion sink, once per assertion. */
function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batteryCases.set(name, (batteryCases.get(name) ?? 0) + 1);
}

/**
 * The floor: every declared battery RAN, and ran its cases (#13489).
 *
 * Evaluated after every battery has had its chance and BEFORE the verdict, so
 * the success line can only be printed by a run in which the set of batteries
 * that registered assertions EQUALS the set declared.
 */
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
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (problems.length) {
    problems.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  return problems;
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OCLIF_COMMANDS_DIR = 'src/commands';

/**
 * This gate's own source, excluded from its own population.
 *
 * ⭐ A CHECKER CANNOT BE ITS OWN EVIDENCE. Every negative fixture below --
 * `'os migrate nonexistent-command'`, `'os demo'`, `'os nope nope'` -- is an
 * unresolvable id ON PURPOSE, because that is what a self-test for this gate is made
 * of. Scanning them would make the gate red exactly in proportion to how well it is
 * tested, and the only way to go green would be to delete the tests.
 *
 * This was found the honest way rather than reasoned out: the gate ran green while the
 * file was still UNTRACKED (`populationFiles` reads `git ls-files`) and reded on the
 * first run after it was committed. Same shape as the fixtures in
 * `scripts/docs-audit/*` that `FIXTURE_EXEMPTIONS` carries -- this one just happens to
 * be in this file, so it is excluded whole rather than line by line.
 */
const OWN_SOURCE = relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(sep).join('/');

/**
 * The repo roots this gate reads WHOLE — every tracked source file under them is in the
 * population, with no further predicate. `populationFiles` derives its admission test
 * from this list, so the two cannot drift.
 *
 * The gate's other half is not a root at all: a `src/` PATH SEGMENT anywhere
 * (`packages/<pkg>/src/**`, `apps/<app>/src/**`). That is a shape, not a subtree, and it is
 * deliberately not declared below.
 */
const POPULATION_ROOTS = ['scripts'];

/**
 * ⭐ THE LANDING OBLIGATION A NEW GATE CANNOT SEE, AND THIS ONE WALKED INTO TWICE.
 *
 * `scripts/pm/dispatch-gates.mjs` derives WHICH gates a card must run by matching the
 * path literals in each gate's source against the card's changed files. `hintCovers`
 * REFUSES a bare single-segment literal as too generic — a measured refusal (+139084
 * fabricated pairs), and it stays. `'scripts/'` collapses to `scripts`, so the
 * admission predicate above names a root no derivation can match, and this gate would
 * have "landed already invisible": never named for a card touching its own population,
 * scoring the same quiet green for every card in the tree.
 *
 * The escape is this declaration — the `ROOT_DIR_WATCH_HINTS` idiom, carried by
 * `check-role-word.mjs` (`['skills/**']`) and `check-examples-live-imports.mjs`
 * (`['examples/**']`). A subtree spelling is a DIFFERENT CLAIM from a bare word: an
 * author stating what the gate actually reads.
 *
 * ⛔ It must be spelled as a LITERAL, not built from `POPULATION_ROOTS` — the hint
 * extractor reads source text, so a computed `` `${r}/**` `` would produce no hint and
 * leave the gate exactly as invisible. The coupling is enforced from the other side
 * instead, in `--self-test`: every separator-less root must appear here as `<root>/**`,
 * and nothing may appear here that the gate does not walk. A declaration that can drift
 * from the scan is worse than none — it replaces a silent gate with a lying one.
 *
 * That harm is measured, not argued (#12472): run `extractWatchHints` over this file and
 * the literal spelling yields the subtree hint while the computed spelling yields NOTHING.
 * The self-test's own copies of the hint cannot stand in for this line — the extractor
 * blanks comments and the whole `selfTest` body before it scans, so this declaration is
 * the only occurrence in the file that the extractor can ever see. Which is exactly why
 * the `--self-test` case guarding it must search THIS STATEMENT and not the whole file:
 * spelled as a bare whole-file `includes`, it found its own needle and could not fail.
 *
 * ⛔ And only roots the gate reads WHOLE belong here. `packages/**` does not: this gate
 * opens `packages/<pkg>/package.json` and each package's `src` subtree, not the root entire, so
 * declaring it would name this gate for a card touching a package README. Naming a root
 * the gate does not read is a FABRICATED lead, which `hintCovers` prices above the
 * silence it would cure.
 */
const ROOT_DIR_WATCH_HINTS = ['scripts/**'];

/**
 * ## The two ledgers, and why an exemption has to assert its own cause
 *
 * Both are keyed by file AND by the exact candidate text, so a genuinely wrong literal
 * appearing in an exempt file still reds. And both SELF-RETIRE: `main` fails if a listed
 * entry no longer reproduces in the scan, so neither list can rot into a lie about a line
 * that has since been fixed, moved or deleted. That shape is `packages/cli`'s own
 * `EXCLUDED` idiom (#10967 / #11465) -- "an exemption that asserts its own cause still
 * holds" -- and it is the reason this gate can carry a baseline without hiding anything.
 *
 * `FIXTURE_EXEMPTIONS`: an unresolvable id is the POINT of the code -- a checker's own
 * self-test asserting that a NON-command does not match. These are permanent.
 */
const FIXTURE_EXEMPTIONS = [
  {
    file: 'scripts/docs-audit/affected-docs.mjs',
    text: 'os meta resync-plan',
    why: "affected-docs's own self-test case for 'a sibling command id is not this one'",
  },
  {
    file: 'scripts/docs-audit/check-drift-comment.mjs',
    text: 'os demo',
    why: 'a fabricated README fixture for the drift-comment self-test; @objectstack/demo has no CLI',
  },
  {
    file: 'scripts/docs-audit/check-drift-comment.mjs',
    text: 'os demo studio',
    why: 'the same fabricated README fixture, two-word form',
  },
];

/**
 * `BASELINED_VIOLATIONS`: REAL defects of exactly the class this gate exists to catch,
 * standing in packages this card does not own. Filed, linked, printed on every green run
 * -- never silent. The gate ships FIRST with today's violations baselined and the fixes
 * follow in the owning lane, which is the same order `check-cli-test-child-env` shipped in
 * and for the same reason: sweeping without the gate restates a convention instead of
 * enforcing it.
 *
 * EMPTY, and that is the design working rather than a list nobody kept. The gate shipped
 * with exactly one entry -- the `objectstack publish` refusal message in
 * `packages/spec/src/api/endpoint.zod.ts` (#12223) -- and it retired ITSELF: fixing the
 * string to `os package publish` made the entry stop reproducing, the `stale` check below
 * RED, and deleting it the only way back to green. A baseline here cannot outlive its
 * defect, so this list stays a record of work in flight and never becomes a silent
 * exemption. Add to it only under the rule above: a real defect, filed and linked.
 */
const BASELINED_VIOLATIONS = [];

const isExempt = (file, text) =>
  FIXTURE_EXEMPTIONS.some((e) => e.file === file && e.text === text)
  || BASELINED_VIOLATIONS.some((e) => e.file === file && e.text === text);

const LEDGER = () => [...FIXTURE_EXEMPTIONS, ...BASELINED_VIOLATIONS];

/** Every binary name a package declares for itself: `oclif.bin` plus each `bin` key. */
export function binNamesOf(pkg) {
  if (!pkg || typeof pkg !== 'object' || !pkg.oclif || typeof pkg.oclif.bin !== 'string' || !pkg.oclif.bin) return [];
  const names = [pkg.oclif.bin];
  if (pkg.bin && typeof pkg.bin === 'object' && !Array.isArray(pkg.bin)) {
    for (const k of Object.keys(pkg.bin)) if (/^[A-Za-z0-9][\w.-]*$/.test(k)) names.push(k);
  }
  return [...new Set(names.filter((n) => /^[A-Za-z0-9][\w.-]*$/.test(n)))];
}

/**
 * ## The SECOND duty (#17869): every module in that walk must BE a command
 *
 * The walk above already opens `packages/cli/src/commands/**` and already derives an id
 * per file. What it never asked is whether the file on the other end of that id is a
 * command at all -- and `packages/cli/package.json` declares the oclif command table as
 * a GLOB over the emitted tree:
 *
 *     "commands": { "strategy": "pattern", "target": "./dist/commands", "glob": "**\/*.js" }
 *
 * so oclif takes EVERY emitted module under `src/commands/` to be a command. A helper
 * dropped beside the command it serves -- the obvious place to put it -- has no
 * default-exported command class, and oclif then writes this to STDERR on every single
 * `os` invocation, whatever the user actually ran:
 *
 *     (node:1922) Warning: Error
 *     module: @oclif/core@4.13.3
 *     task: findCommand (migrate:file-column-move)
 *     plugin: @objectstack/cli
 *     message: command migrate:file-column-move not found
 *
 * ⛔ It is not cosmetic. `os validate --json` writes its payload to stdout; a consumer
 * that reads stdout and stderr together -- which this repo's own CLI test helper does,
 * and which is the ordinary shape for `execFileSync` error handling -- gets valid JSON
 * followed by that warning, and `JSON.parse` fails on it. Measured on PR #17859 before
 * the fix: ONE red in 3247 cases (`packages/cli/test/format-zod-union.test.ts`), and the
 * misplaced module was in `src/commands/migrate/`, nothing to do with `os validate`. A
 * misplaced file that happens NOT to break a `--json` parse ships that warning silently
 * to every user of every command.
 *
 * ## Why the existing duty could not catch it, on the same population
 *
 * Duty one asks whether a command-id STRING LITERAL outside the CLI resolves to a
 * derivable command path. A module with no command class still yields a derivable path,
 * so it reads as a perfectly valid id. Same walk, same files, opposite question --
 * which is why this lands here and not as a new gate: a gate that covers a population
 * does not thereby cover every question on that population.
 *
 * ## ⭐ The predicate follows the INHERITANCE CHAIN, and that is load-bearing
 *
 * Two modules in the tree today extend another COMMAND class rather than oclif's
 * `Command`: `src/commands/build.ts` extends `Compile` (from `./compile.js`) and
 * `src/commands/migrate/index.ts` extends `MigratePlan` (from `./plan.js`). A predicate
 * that only accepts a literal `extends Command` reports both as violations -- a FALSE
 * RED on correct code, and the reliable way to get a guard switched off. So the check
 * resolves the base class: same-file declaration, or a relative import followed into its
 * own source, until it reaches a binding imported from `@oclif/` under the exported name
 * `Command`.
 *
 * ## ⭐ It reads SOURCE, never `dist`
 *
 * Deliberately, and it is the reason this gate needs no build and inherits no stale
 * artefact. `tsc` does not delete outputs for sources that have been removed, so a
 * deleted `src/commands/x/helper.ts` leaves `dist/commands/x/helper.js` behind and a
 * local rebuild does not clear it -- anything read through `dist` would score a file the
 * tree no longer has. Source has no such state.
 */
const OCLIF_BASE_SPECIFIER_RE = /^@oclif\//;

/** The one base-class export name that ends the chain. */
const OCLIF_COMMAND_EXPORT = 'Command';

/** Directories under `src/commands/` the CLI build does not emit -- so oclif never loads them. */
const UNEMITTED_DIR_NAMES = new Set(['__tests__']);

/**
 * A file under `src/commands/` that the CLI BUILD EMITS -- and therefore a module the
 * oclif glob loads as a command.
 *
 * `packages/cli/tsconfig.build.json` includes `src` and excludes exactly
 * `src/**\/*.test.ts`, `src/**\/*.spec.ts` and `src/**\/__tests__/**`, so the emitted set
 * under `src/commands/` is every `.ts`/`.tsx` that is not one of those. The coupling is
 * pinned in `--self-test` against that file rather than asserted here, so a new exclude
 * reds instead of silently shrinking this population.
 *
 * ⛔ This is DELIBERATELY WIDER than the id-derivation rule above, and the gap is the
 * whole point. The id rule drops a dotted base (`foo.helpers.ts`) and a base that is not
 * lower-kebab (`_shared.ts`, `Helper.ts`) because such a file cannot BE a command id --
 * but `tsc` emits it and the glob loads it, so those are exactly the shapes a misplaced
 * helper takes. Scoring this duty on the id population would leave the guard blind at
 * precisely its own subject.
 */
export function isEmittedCommandModule(name) {
  if (!/\.tsx?$/.test(name)) return false;
  if (/\.d\.ts$/.test(name)) return false;
  return !/\.(?:test|spec)\.tsx?$/.test(name);
}

/**
 * The set of ids a commands dir yields: every command FILE, plus every TOPIC directory.
 * `readDir`/`statOf` are injectable so `--self-test` can pin this against a scratch tree.
 */
export function commandIdsUnder(commandsDir, readDir = readdirSync, statOf = statSync) {
  return commandSurfaceUnder(commandsDir, readDir, statOf).ids;
}

/**
 * `{ ids, topics, modules }` for a commands dir. `topics` is every DIRECTORY name -- the
 * distinction `resolveId` needs: a word following a TOPIC is a subcommand attempt and
 * must resolve, while a word following a LEAF command is an argument and is ignored.
 *
 * `modules` is the SECOND duty's population (#17869): every file this walk passes that
 * the CLI build emits, judged by `isEmittedCommandModule`. It comes out of the SAME
 * traversal -- there is no second walk, and the two duties cannot disagree about which
 * files exist.
 *
 * ⭐ `deriveIds` is what keeps the two populations from contaminating each other. A
 * directory that cannot name a command id (`__helpers`, `Shared`) used to end the
 * traversal; it is now DESCENDED with id derivation switched off, because `tsc` emits
 * what is inside it and the oclif glob loads it. Not one id can be added from such a
 * subtree -- `ids`/`topics` are untouched under `deriveIds: false` -- so duty one is
 * bit-for-bit what it was, while duty two stops being blind below a badly-named folder.
 */
export function commandSurfaceUnder(commandsDir, readDir = readdirSync, statOf = statSync) {
  const ids = new Set();
  const topics = new Set();
  const modules = [];
  const walk = (abs, segs, deriveIds) => {
    let entries;
    try { entries = readDir(abs); } catch { return; }
    for (const name of entries) {
      const child = join(abs, name);
      let st;
      try { st = statOf(child); } catch { continue; }
      if (st.isDirectory()) {
        if (UNEMITTED_DIR_NAMES.has(name)) continue; // the build excludes it -- oclif never sees it
        const namesATopic = deriveIds && /^[a-z0-9][a-z0-9-]*$/.test(name);
        if (namesATopic) {
          ids.add([...segs, name].join(' ')); // the topic itself
          topics.add([...segs, name].join(' '));
          walk(child, [...segs, name], true);
        } else {
          walk(child, segs, false);
        }
        continue;
      }
      if (isEmittedCommandModule(name)) modules.push(child);
      if (!deriveIds) continue;
      const m = /^(.+)\.(?:ts|tsx|js|mjs|cjs)$/.exec(name);
      if (!m) continue;
      const base = m[1];
      if (/\.(?:test|spec|contract|integration|e2e|dry-run)$/.test(base)) continue;
      if (base.includes('.')) continue; // any other dotted sidecar is not a command
      if (!/^[a-z0-9][a-z0-9-]*$/.test(base)) continue;
      ids.add(base === 'index' ? segs.join(' ') : [...segs, base].join(' '));
    }
  };
  walk(commandsDir, [], true);
  ids.delete('');
  return { ids, topics, modules };
}

/**
 * `COMMAND_MODULE_EXEMPTIONS`: a module under `src/commands/` that is legitimately not a
 * command, declared by path with its cause.
 *
 * ⭐ DECLARATIVE AND SELF-RETIRING, both halves. An exemption is visible in one place a
 * reviewer reads, and it CANNOT rot: `main` fails when a listed entry stops reproducing
 * -- either because the file is no longer in the walked population (moved, renamed,
 * deleted) or because it now DOES export a command class. That is the same shape the two
 * ledgers above carry, for the same reason: an exemption that has outlived its cause is
 * a claim nobody is checking.
 *
 * EMPTY, and that is the tree's measured state rather than a list nobody kept -- every
 * command module under `src/commands/` default-exports a command class today. ⛔ The
 * remedy for a helper is `packages/cli/src/utils/`, not an entry here; an entry is for a
 * module that must sit under `src/commands/` and still is not a command, and it owes the
 * reason why.
 */
const COMMAND_MODULE_EXEMPTIONS = [];

const isModuleExempt = (file) => COMMAND_MODULE_EXEMPTIONS.some((e) => e.file === file);

/**
 * Parsed sources, keyed by path and re-parsed when the bytes change.
 *
 * `audit()` is called several times per run (the self-test alone calls it repeatedly),
 * and the chain resolution reads base-class files more than once. Keying on the TEXT as
 * well as the path keeps the cache correct if a caller rewrites a file mid-process -- a
 * stale tree would answer about a source that is no longer there, which is the exact
 * class of defect `ts-parse.mjs` exists to refuse.
 */
const parseCache = new Map();

function parseFileCached(absPath) {
  let text;
  try { text = readFileSync(absPath, 'utf8'); } catch { return null; }
  const hit = parseCache.get(absPath);
  if (hit && hit.text === text) return hit.sf;
  const sf = parseSourceFile(absPath, text, absPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  parseCache.set(absPath, { text, sf });
  return sf;
}

const modifiersOf = (node) => (node && Array.isArray(node.modifiers) ? node.modifiers : []);
const hasModifier = (node, kind) => modifiersOf(node).some((m) => m.kind === kind);

/** `local name -> { specifier, imported }`; `imported` is the EXPORTED name, or `default`. */
function importBindingsOf(sf) {
  const out = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    if (!ts.isStringLiteral(st.moduleSpecifier)) continue;
    const specifier = st.moduleSpecifier.text;
    const clause = st.importClause;
    if (clause.name) out.set(clause.name.text, { specifier, imported: 'default' });
    const nb = clause.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) out.set(el.name.text, { specifier, imported: (el.propertyName ?? el.name).text });
    }
  }
  return out;
}

/**
 * The class a module exports under `name` (`'default'` for the default export), as
 * `{ kind: 'class', node }`, or a forwarding record the caller follows, or `null`.
 *
 * ⭐ This is why the check PARSES instead of matching `export default class` in text.
 * Three command modules in this tree -- `create.ts`, `generate.ts` and `init.ts` -- are
 * SCAFFOLDERS whose template literals carry the line `export default ...` as emitted
 * code, and in all three that text appears HUNDREDS of lines before the module's own
 * real `export default class`. A text scan reading the first match answers about a
 * string the scaffolder prints, not about the module. A parser cannot make that mistake:
 * a template literal is not a statement.
 */
function exportedBinding(sf, name) {
  for (const st of sf.statements) {
    if (ts.isClassDeclaration(st) && hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
      const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword);
      if (name === 'default' ? isDefault : (!isDefault && st.name && st.name.text === name)) {
        return { kind: 'class', node: st };
      }
    }
  }
  if (name === 'default') {
    for (const st of sf.statements) {
      if (!ts.isExportAssignment(st) || st.isExportEquals) continue;
      return ts.isIdentifier(st.expression)
        ? { kind: 'local', name: st.expression.text }
        : { kind: 'not-a-class', detail: 'its default export is an expression, not a class' };
    }
  }
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
    for (const el of st.exportClause.elements) {
      if (el.name.text !== name) continue;
      const local = (el.propertyName ?? el.name).text;
      if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
        return { kind: 'reexport', name: local, specifier: st.moduleSpecifier.text };
      }
      return { kind: 'local', name: local };
    }
  }
  return null;
}

/** A class declared (not necessarily exported) in this file. */
function localClass(sf, name) {
  for (const st of sf.statements) {
    if (ts.isClassDeclaration(st) && st.name && st.name.text === name) return st;
  }
  return null;
}

/** The `extends` clause's root identifier name, or `null`. */
function extendsIdentifierOf(classNode) {
  for (const clause of classNode.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    const expr = clause.types[0] && clause.types[0].expression;
    if (!expr) return null;
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
    return null;
  }
  return null;
}

/**
 * Map an ESM specifier as WRITTEN (`./compile.js`, NodeNext) onto the source file it
 * names. ⛔ Looking for `./compile.js` on disk finds nothing and would read as
 * "unresolvable base class" on two correct files.
 */
function sourceFileFor(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = join(dirname(fromFile), specifier);
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    base.replace(/\.mjs$/, '.mts'),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    base,
  ];
  for (const c of candidates) {
    try { if (statSync(c).isFile()) return c; } catch { /* try the next candidate */ }
  }
  return null;
}

/** How far the chain is followed before the gate says so rather than looping. */
const MAX_CHAIN_DEPTH = 12;

/**
 * Does the binding `name` exported by `absPath` resolve to a class whose inheritance
 * chain reaches oclif's `Command`?
 *
 * Returns `{ ok, chain, reason }`. `chain` is the class names walked, in order, so the
 * green line and any failure both SAY which route was taken rather than asserting one.
 */
export function commandClassVerdict(absPath, name, chain = [], depth = 0, seen = new Set()) {
  if (depth > MAX_CHAIN_DEPTH) {
    return { ok: false, chain, reason: `its inheritance chain is deeper than ${MAX_CHAIN_DEPTH} -- refusing to keep following it` };
  }
  const key = `${absPath}\u0000${name}`;
  if (seen.has(key)) return { ok: false, chain, reason: 'its inheritance chain is circular' };
  seen.add(key);

  const sf = parseFileCached(absPath);
  if (!sf) return { ok: false, chain, reason: `it could not be read (${absPath})` };

  const binding = exportedBinding(sf, name);
  if (!binding) {
    return {
      ok: false,
      chain,
      reason: name === 'default' ? 'it has no default export' : `it does not export \`${name}\``,
    };
  }
  if (binding.kind === 'not-a-class') return { ok: false, chain, reason: binding.detail };
  if (binding.kind === 'reexport') {
    const next = sourceFileFor(absPath, binding.specifier);
    if (!next) {
      return { ok: false, chain, reason: `\`${name}\` is re-exported from '${binding.specifier}', which this gate cannot follow to a source file` };
    }
    return commandClassVerdict(next, binding.name, chain, depth + 1, seen);
  }

  let classNode = binding.kind === 'class' ? binding.node : localClass(sf, binding.name);
  if (!classNode) {
    const imported = importBindingsOf(sf).get(binding.name);
    if (!imported) {
      return { ok: false, chain, reason: `its default export \`${binding.name}\` is not a class declared or imported here` };
    }
    const next = sourceFileFor(absPath, imported.specifier);
    if (!next) {
      return { ok: false, chain, reason: `its default export comes from '${imported.specifier}', which this gate cannot follow to a source file` };
    }
    return commandClassVerdict(next, imported.imported, chain, depth + 1, seen);
  }

  const here = [...chain, classNode.name ? classNode.name.text : '(anonymous)'];
  const baseName = extendsIdentifierOf(classNode);
  if (!baseName) {
    return { ok: false, chain: here, reason: `\`${here[here.length - 1]}\` is a class but extends nothing -- an oclif command extends \`Command\`` };
  }

  const via = importBindingsOf(sf).get(baseName);
  if (via && OCLIF_BASE_SPECIFIER_RE.test(via.specifier)) {
    const reachesCommand = via.imported === OCLIF_COMMAND_EXPORT
      || (via.imported === 'default' && /^@oclif\/core\/command$/.test(via.specifier));
    return reachesCommand
      ? { ok: true, chain: [...here, `${baseName} (${via.specifier})`], reason: null }
      : { ok: false, chain: here, reason: `it extends \`${baseName}\`, imported from '${via.specifier}' as \`${via.imported}\` -- not oclif's \`Command\`` };
  }

  if (localClass(sf, baseName)) return commandClassVerdict(absPath, baseName, here, depth + 1, seen);

  if (via) {
    const next = sourceFileFor(absPath, via.specifier);
    if (!next) {
      return { ok: false, chain: here, reason: `it extends \`${baseName}\` from '${via.specifier}', which this gate cannot follow to a source file` };
    }
    return commandClassVerdict(next, via.imported, here, depth + 1, seen);
  }

  return { ok: false, chain: here, reason: `it extends \`${baseName}\`, which is neither declared nor imported in this file` };
}

/**
 * Judge every emitted module under one CLI package's `src/commands/`.
 *
 * `cli.modules` comes from the SAME walk that derives the ids -- no second traversal,
 * and no second definition of what the population is.
 */
function auditCommandModules(root, cli) {
  const examined = [];
  const violations = [];
  for (const abs of cli.modules) {
    const file = relative(root, abs).split(sep).join('/');
    const verdict = commandClassVerdict(abs, 'default');
    examined.push({ file, ok: verdict.ok, chain: verdict.chain, reason: verdict.reason });
    if (!verdict.ok && !isModuleExempt(file)) {
      violations.push({ file, reason: verdict.reason, chain: verdict.chain, cli: cli.dir });
    }
  }
  return { examined, violations };
}

/**
 * An exemption that no longer reproduces. Two ways an entry rots, and BOTH red:
 * the file left the walked population, or the module now exports a command class.
 */
function staleModuleExemptions(examinedByFile) {
  return COMMAND_MODULE_EXEMPTIONS.flatMap((e) => {
    const seen = examinedByFile.get(e.file);
    if (!seen) return [{ ...e, why_stale: 'no module at that path is in the walked population -- moved, renamed or deleted' }];
    if (seen.ok) return [{ ...e, why_stale: 'this module DOES export a command class now -- the exemption has outlived its cause' }];
    return [];
  });
}

/** Discover every oclif CLI package in the repo from DECLARED `oclif.bin`. */
function discoverClis(root = REPO_ROOT) {
  const clis = [];
  const pkgDirs = [];
  const scan = (rel, depth) => {
    let entries;
    try { entries = readdirSync(join(root, rel)); } catch { return; }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      let st;
      try { st = statSync(join(root, childRel)); } catch { continue; }
      if (!st.isDirectory()) continue;
      if (existsSync(join(root, childRel, 'package.json'))) pkgDirs.push(childRel);
      if (depth > 0) scan(childRel, depth - 1);
    }
  };
  scan('packages', 2);
  for (const dir of pkgDirs) {
    let pkg;
    try { pkg = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')); } catch { continue; }
    const bins = binNamesOf(pkg);
    if (!bins.length) continue;
    const commandsDir = join(root, dir, OCLIF_COMMANDS_DIR);
    if (!existsSync(commandsDir)) continue;
    const { ids, topics, modules } = commandSurfaceUnder(commandsDir);
    clis.push({ dir, bins, ids, topics, modules });
  }
  return clis;
}

/**
 * Every command-id literal on a line, as `{ bin, words, text, index }`.
 * The bin name must be the FIRST thing inside the quoted run -- see the header.
 */
export function literalsOn(line, bins) {
  if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return [];
  const alt = bins.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`['"\`](${alt})((?: [a-z0-9][a-z0-9-]*){1,2})`, 'g');
  const out = [];
  for (const m of line.matchAll(re)) {
    out.push({ bin: m[1], words: m[2].trim().split(' '), text: `${m[1]}${m[2]}`, index: m.index });
  }
  return out;
}

/**
 * Resolve a literal's words to a command id, or `null`.
 *
 * ⭐ THE ONE-WORD FALLBACK IS CONDITIONAL, and the self-test is what forced that. A plain
 * longest-prefix rule ("two words, else one") makes this gate BLIND TO ITS OWN PURPOSE:
 * rename `migrate/multi-value-columns.ts` and `'os migrate multi-value-columns'` quietly
 * falls back to `migrate`, which is a real id -- so the literal the finding is ABOUT
 * would stay green through exactly the rename #12016 describes. It was written that way
 * first and the `--self-test` rename case caught it.
 *
 * The fallback is only correct when the trailing word is an ARGUMENT, and that is
 * mechanically decidable: a word after a TOPIC (a directory under `src/commands/`) is a
 * subcommand attempt and must resolve on its own; a word after a LEAF command is an
 * argument (`os validate metadata`) and is ignored.
 */
export function resolveId(words, ids, topics = new Set()) {
  const two = words.slice(0, 2).join(' ');
  if (words.length >= 2 && ids.has(two)) return two;
  if (words.length >= 2 && topics.has(words[0])) return null;
  return ids.has(words[0]) ? words[0] : null;
}

/** Tracked source files in the population: package `src/` and repo `scripts/`, no tests. */
function populationFiles(root = REPO_ROOT, cliDirs = []) {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, maxBuffer: 1 << 28 })
    .toString().trim().split('\n');
  return tracked.filter((f) => {
    if (!/\.(?:ts|tsx|js|mjs|cjs)$/.test(f)) return false;
    if (f === OWN_SOURCE) return false;
    if (cliDirs.some((d) => f.startsWith(`${d}/`))) return false;
    if (/\.(?:test|spec)\.[tj]sx?$/.test(f) || f.includes('/__tests__/')) return false;
    return /(?:^|\/)src\//.test(f) || POPULATION_ROOTS.some((r) => f.startsWith(`${r}/`));
  });
}

function audit(root = REPO_ROOT) {
  const clis = discoverClis(root);
  if (!clis.length) return { refusal: 'no package declares `oclif.bin` -- the derivation has no source' };
  const allBins = [...new Set(clis.flatMap((c) => c.bins))];
  const violations = [];
  const resolved = [];
  const seen = new Set();
  for (const file of populationFiles(root, clis.map((c) => c.dir))) {
    let text;
    try { text = readFileSync(join(root, file), 'utf8'); } catch { continue; }
    if (!allBins.some((b) => text.includes(`${b} `))) continue;
    text.split('\n').forEach((line, i) => {
      for (const lit of literalsOn(line, allBins)) {
        const cli = clis.find((c) => c.bins.includes(lit.bin));
        const id = resolveId(lit.words, cli.ids, cli.topics);
        const rec = { file, line: i + 1, text: lit.text, id, cli: cli.dir, src: line.trim().slice(0, 160) };
        if (id) resolved.push(rec);
        else if (isExempt(file, lit.text)) seen.add(`${file}\u0000${lit.text}`);
        else violations.push(rec);
      }
    });
  }
  const stale = LEDGER().filter((e) => !seen.has(`${e.file}\u0000${e.text}`));

  // -- duty two (#17869): every emitted module in the SAME walk must BE a command --
  const examined = [];
  const moduleViolations = [];
  for (const cli of clis) {
    const r = auditCommandModules(root, cli);
    examined.push(...r.examined);
    moduleViolations.push(...r.violations);
  }
  const staleModules = staleModuleExemptions(new Map(examined.map((m) => [m.file, m])));

  // ⭐ Zero examined is NOT a pass. A CLI package was discovered -- `discoverClis`
  // requires both its `oclif.bin` declaration and an existing `src/commands` dir -- so a
  // walk that finds no module inside it means the traversal stopped, not that the tree is
  // clean. Exit 0 over an empty population is evidence about nothing, and it is the one
  // shape this duty could fail in silently.
  const emptyCli = clis.find((c) => c.modules.length === 0);
  if (emptyCli) {
    return {
      refusal: `${emptyCli.dir}/${OCLIF_COMMANDS_DIR} yielded 0 modules -- the walk reached no file, so `
        + 'the command-class duty would have scored a green over an empty population',
    };
  }

  return { clis, violations, resolved, stale, examined, moduleViolations, staleModules, refusal: null };
}

function main() {
  const r = audit();
  if (r.refusal) { console.error(`✗ check-cli-command-ids: ${r.refusal}`); return 1; }
  if (r.violations.length) {
    console.error('✗ check-cli-command-ids: command-id literal(s) that resolve to no command path:\n');
    for (const v of r.violations) {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    literal: "${v.text}"  ->  no such command under ${v.cli}/${OCLIF_COMMANDS_DIR}/`);
      console.error(`    ${v.src}`);
    }
    console.error('\nEither the command was renamed and this string was left behind (fix the string),');
    console.error('or the string never named a command (reword it so it is not a quoted command phrase).');
    return 1;
  }
  if (r.stale.length) {
    console.error('✗ check-cli-command-ids: ledger entr(ies) that no longer reproduce:\n');
    for (const e of r.stale) console.error(`  ${e.file}  "${e.text}"\n    ${e.why}`);
    console.error('\nThe line was fixed, moved or deleted. Delete the ledger entry — an exemption');
    console.error('that has outlived its cause is a claim nobody is checking.');
    return 1;
  }
  if (r.moduleViolations.length) {
    console.error(
      '✗ check-cli-command-ids: module(s) under src/commands/ that do not default-export a command class:\n',
    );
    for (const v of r.moduleViolations) {
      console.error(`  ${v.file}`);
      console.error(`    ${v.reason}${v.chain.length ? `  (resolved: ${v.chain.join(' -> ')})` : ''}`);
    }
    console.error(
      '\nThe oclif command table is a GLOB over the emitted tree — packages/cli/package.json\n'
      + '  "commands": { "strategy": "pattern", "target": "./dist/commands", "glob": "**/*.js" }\n'
      + 'so EVERY module under src/commands/ is taken to be a command. A module that is not one\n'
      + 'makes oclif print a "findCommand ... command <id> not found" warning on STDERR for EVERY\n'
      + '`os` invocation, whatever the user actually ran.\n'
      + '\n⛔ That is not cosmetic. `os validate --json` writes its payload to stdout, so a consumer\n'
      + 'reading both streams — this repo\'s own CLI test helper does, and it is the ordinary shape\n'
      + 'for execFileSync error handling — gets valid JSON followed by that warning, and JSON.parse\n'
      + 'fails on it. Measured on PR #17859: ONE red in 3247 cases, in a test with nothing to do\n'
      + 'with the misplaced module. A file that happens not to break a --json parse ships the\n'
      + 'warning silently to every user of every command.\n'
      + '\nThe fix: move the helper to packages/cli/src/utils/, which is already where CLI helpers\n'
      + 'live (schema-migrate.ts, migrate-occupancy-gate.ts, sqlite-occupancy.ts,\n'
      + 'data-migration-plugins.ts), and import it from the command that needs it.\n'
      + '\nA module that genuinely must sit under src/commands/ without being a command needs a\n'
      + 'declared entry in COMMAND_MODULE_EXEMPTIONS in this file, carrying its reason — ⛔ never a\n'
      + 'silent pass.',
    );
    return 1;
  }
  if (r.staleModules.length) {
    console.error('✗ check-cli-command-ids: command-module exemption(s) that no longer reproduce:\n');
    for (const e of r.staleModules) console.error(`  ${e.file}\n    declared: ${e.why}\n    now: ${e.why_stale}`);
    console.error('\nDelete the COMMAND_MODULE_EXEMPTIONS entry — an exemption that has outlived its');
    console.error('cause is a claim nobody is checking.');
    return 1;
  }
  for (const e of BASELINED_VIOLATIONS) {
    console.log(`⚠ baselined violation — ${e.file}: "${e.text}"${e.issue ? ` (${e.issue})` : ''}`);
    console.log(`  ${e.why}`);
  }
  const files = new Set(r.resolved.map((x) => x.file)).size;
  console.log(
    `✓ check-cli-command-ids: ${r.resolved.length} command-id literal(s) across ${files} file(s) `
    + `outside ${r.clis.map((c) => c.dir).join(', ')} all resolve to a real command path `
    + `(${r.clis.reduce((n, c) => n + c.ids.size, 0)} ids derived; ${FIXTURE_EXEMPTIONS.length} declared fixture exemptions, `
    + `${BASELINED_VIOLATIONS.length} baselined violation(s) listed above).`,
  );
  // ⭐ The EXAMINED count is printed, not just the violation count: `0 violations` over 0
  // modules and `0 violations` over 63 are the same line otherwise, and only one of them
  // is a reading.
  console.log(
    `✓ check-cli-command-ids: ${r.examined.length} module(s) under `
    + `${r.clis.map((c) => `${c.dir}/${OCLIF_COMMANDS_DIR}`).join(', ')} examined, all of them `
    + 'default-export a class whose inheritance chain reaches oclif\'s `Command` '
    + `(${COMMAND_MODULE_EXEMPTIONS.length} declared exemption(s)).`,
  );
  return 0;
}

function list() {
  const r = audit();
  if (r.refusal) { console.error(`✗ ${r.refusal}`); return 1; }
  for (const x of [...r.resolved, ...r.violations].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.log(`${x.file}:${x.line}\t"${x.text}"\t${x.id ?? '*** UNRESOLVED ***'}`);
  }
  console.log(`\n${r.resolved.length} resolved, ${r.violations.length} unresolved.`);
  console.log('');
  for (const m of r.examined) {
    console.log(`${m.file}\t${m.ok ? m.chain.join(' -> ') : `*** NOT A COMMAND: ${m.reason} ***`}`);
  }
  console.log(`\n${r.examined.length} command module(s) examined, ${r.moduleViolations.length} not a command.`);
  return 0;
}

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

function selfTest() {
  const cases = [];
  const t = (name, ok, detail = '') => {
    registerCase();
    return cases.push({ name, ok, detail });
  };

  // -- the id derivation, against a scratch tree (no repo state) --------------
  battery('the id derivation, against a scratch tree (no repo state)');
  const dir = mkdtempSync(join(tmpdir(), 'cli-cmd-ids-'));
  try {
    const cmds = join(dir, 'src', 'commands');
    mkdirSync(join(cmds, 'migrate'), { recursive: true });
    mkdirSync(join(cmds, 'meta'), { recursive: true });
    writeFileSync(join(cmds, 'build.ts'), '');
    writeFileSync(join(cmds, 'migrate', 'index.ts'), '');
    writeFileSync(join(cmds, 'migrate', 'multi-value-columns.ts'), '');
    writeFileSync(join(cmds, 'migrate', 'apply.contract.test.ts'), '');
    writeFileSync(join(cmds, 'meta', 'resync.ts'), '');
    const { ids, topics } = commandSurfaceUnder(cmds);
    t('a top-level file is a one-word id', ids.has('build'));
    t('a directory is a topic', topics.has('migrate') && topics.has('meta'));
    t('a leaf command is NOT a topic', !topics.has('build'));
    t('a nested file is a two-word id', ids.has('migrate multi-value-columns'));
    t('topic/index.ts collapses to the topic', ids.has('migrate'));
    t('a topic DIRECTORY resolves even with no index.ts', ids.has('meta'), '`os meta` is topic help, not an error');
    t('a nested command under a topic resolves', ids.has('meta resync'));
    t('a .test.ts sidecar is not a command', !ids.has('migrate apply'));

    // The gate must RED on the exact failure #12016 describes: the command file is
    // renamed and the driver's string is left behind. Same tree, one rename.
    const before = commandSurfaceUnder(cmds);
    rmSync(join(cmds, 'migrate', 'multi-value-columns.ts'));
    writeFileSync(join(cmds, 'migrate', 'multi-value-columns-v2.ts'), '');
    const after = commandSurfaceUnder(cmds);
    const lit = literalsOn("export const C = 'os migrate multi-value-columns';", ['os'])[0];
    t('the known-good literal resolves before the rename',
      resolveId(lit.words, before.ids, before.topics) === 'migrate multi-value-columns');
    t('THE SAME literal resolves to nothing after the rename',
      resolveId(lit.words, after.ids, after.topics) === null,
      'this is the #12016 failure the gate exists to catch');
    t('the fallback does NOT silently rescue it via the topic',
      after.ids.has('migrate') && after.topics.has('migrate')
      && resolveId(lit.words, after.ids, after.topics) === null,
      '`migrate` is a real id; a plain longest-prefix rule would have passed here');
    t('a word after a LEAF command is still an argument',
      resolveId(['build', 'metadata'], after.ids, after.topics) === 'build');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // -- a KNOWN-BAD literal: a command id that resolves to nothing -------------
  battery('a KNOWN-BAD literal: a command id that resolves to nothing');
  const ids = new Set(['migrate apply', 'migrate', 'build']);
  const topics = new Set(['migrate']);
  const bad = literalsOn("throw new Error('run \"os migrate nonexistent-command\" first');", ['os']);
  t('a known-bad literal is detected', bad.length === 1 && bad[0].text === 'os migrate nonexistent-command');
  t('a known-bad literal resolves to NOTHING', bad.length === 1 && resolveId(bad[0].words, ids, topics) === null);
  t('a known-good literal beside it resolves',
    resolveId(literalsOn('`os migrate apply`', ['os'])[0].words, ids, topics) === 'migrate apply');

  // -- the delimiter rule: the six measured noise shapes stay OUT ------------
  battery('the delimiter rule: the six measured noise shapes stay OUT');
  t('Spanish prose ("envios diarios") is not a literal', literalsOn("label: 'Limite de envios diarios',", ['os']).length === 0);
  t('a Python import example is not a literal', literalsOn("import os from 'os';", ['os']).length === 0);
  t('an unquoted sentence is not a literal', literalsOn('`carry an os validate-clean security posture`,', ['os']).length === 0);
  t('a comment line is out of population', literalsOn(" * run `os migrate apply` to fix", ['os']).length === 0);
  t('a bin name mid-string is not a literal', literalsOn('`re-run os migrate apply now`', ['os']).length === 0);
  t('a bin name at a quote IS a literal', literalsOn('via "os migrate apply --allow-destructive".', ['os']).length === 1);

  // -- the exemption ledger is site-scoped, not blanket ----------------------
  battery('the exemption ledger is site-scoped, not blanket');
  t('a declared fixture is exempt', isExempt('scripts/docs-audit/check-drift-comment.mjs', 'os demo'));
  t('the SAME text elsewhere is NOT exempt', !isExempt('packages/drivers/driver-sql/src/schema-drift.ts', 'os demo'));
  t('a DIFFERENT text in an exempt file is NOT exempt', !isExempt('scripts/docs-audit/check-drift-comment.mjs', 'os migrate gone'));

  // -- the ledger self-retires: a listed entry that stops reproducing REDS ---
  battery('the ledger self-retires: a listed entry that stops reproducing REDS');
  t('every ledger entry reproduces in the live scan', audit().stale.length === 0,
    audit().stale.map((e) => `${e.file} "${e.text}"`).join('; '));
  t('a fabricated ledger entry would be reported stale',
    (() => {
      const live = audit();
      const fake = { file: 'packages/does/not/exist.ts', text: 'os nope nope' };
      // same predicate `audit` uses, applied to an entry that cannot have been seen
      return !live.resolved.some((x) => x.file === fake.file)
        && !live.violations.some((x) => x.file === fake.file);
    })(),
    'the staleness check is keyed on what the scan actually saw');

  t('the gate excludes its OWN source from its population',
    OWN_SOURCE === 'scripts/check-cli-command-ids.mjs'
    && !audit().resolved.some((x) => x.file === OWN_SOURCE)
    && !audit().violations.some((x) => x.file === OWN_SOURCE),
    'every negative fixture in this file is an unresolvable id by construction');

  // -- the dispatch-gates declaration (#12016's own landing obligation) ------
  //
  // Enforcement cannot hold either half here: the declaration is read by ANOTHER TOOL
  // (`scripts/pm/dispatch-gates.mjs`), so a wrong or stale one runs green in this file
  // forever and pays itself out as a dev dispatched on a scripts/ card with this gate
  // missing from the brief. Both directions are pinned, and both matter — a missing
  // declaration is a silent gate, a surplus one is a lying gate.
  battery('the dispatch-gates declaration (#12016\'s own landing obligation)');
  const separatorless = POPULATION_ROOTS.filter((r) => !r.includes('/'));
  t('every whole-root population entry is declared as a subtree (a bare root is refused by '
    + 'hintCovers as too generic, so it needs the `<root>/**` spelling)',
    separatorless.length > 0 && separatorless.every((r) => ROOT_DIR_WATCH_HINTS.includes(`${r}/**`)));
  t('and nothing is declared that this gate does not walk whole — no fabricated lead',
    ROOT_DIR_WATCH_HINTS.every((h) => POPULATION_ROOTS.includes(h.replace(/\/\*+$/, ''))));
  // ⭐ This case is SCOPED to the declaration statement and DERIVES its needle. Both
  // halves are load-bearing, and the naive spelling got both wrong (#12472).
  //
  // It used to search the WHOLE file for a needle it spelled inline, so `includes` found
  // that needle in the ASSERTION rather than in the declaration and the case was
  // satisfied by its own text: rewriting the declaration into the computed form it
  // exists to reject left the self-test fully GREEN, all 38 cases passing. A case that
  // cannot fail is the same under-enforcement this gate was built to catch, one layer in.
  //
  // Assembling the needle -- the remedy `check-objectql-double-limit.mjs` carries for
  // the identical idiom -- is NOT sufficient here, which is why this looks different from
  // its sibling. That file spells the hint twice (declaration, assertion), so un-spelling
  // the assertion leaves the declaration as the only copy. This file spells it a THIRD
  // time, in the runtime-value case just below, and a whole-file search finds THAT copy
  // and stays green on the computed form. Measured. So the scope is the fix and the
  // derived needle is the hygiene; ⛔ do not widen the search back to the whole file.
  //
  // The harm this case names is real, not theoretical -- measured against the extractor
  // itself: `extractWatchHints` recovers the subtree hint from the literal declaration
  // and recovers NOTHING from the computed one. The self-test's own copies cannot rescue
  // it, because `maskSelfTests` blanks this whole function before the scan runs.
  const ownSource = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const declSites = [...ownSource.matchAll(/\bconst\s+ROOT_DIR_WATCH_HINTS\s*=\s*([^;]*);/g)];
  t('the declaration statement is found exactly once in this source',
    declSites.length === 1,
    `${declSites.length} site(s) matched -- the case below cannot judge what it cannot locate`);
  t('the declaration is spelled as a LITERAL in this source, not computed',
    declSites.length === 1 && ROOT_DIR_WATCH_HINTS.length > 0
    && ROOT_DIR_WATCH_HINTS.every((h) =>
      declSites[0][1].includes(`'${h}'`) || declSites[0][1].includes(`"${h}"`)),
    'the hint extractor reads source text; a computed `${r}/**` builds no hint at all');
  t('scripts is the root it declares, and the population really reaches across it',
    ROOT_DIR_WATCH_HINTS.includes('scripts/**')
    && new Set(audit().resolved.filter((x) => x.file.startsWith('scripts/')).map((x) => x.file)).size >= 5);

  // -- bin names come from declared data ------------------------------------
  battery('bin names come from declared data');
  t('oclif.bin is read', binNamesOf({ oclif: { bin: 'os' } }).includes('os'));
  t('bin keys join it', binNamesOf({ oclif: { bin: 'os' }, bin: { objectstack: './bin/run.js' } }).includes('objectstack'));
  t('a package with no oclif block declares no bins', binNamesOf({ bin: { foo: 'x' } }).length === 0);

  // -- the live repo returns a verdict, and it is green ----------------------
  battery('the live repo returns a verdict, and it is green');
  const live = audit();
  t('the live audit returns a verdict', live.refusal === null, live.refusal ?? '');
  t('the live repo has at least one CLI package', live.refusal === null && live.clis.length >= 1);
  t('the live population is non-trivial', live.refusal === null && live.resolved.length > 100,
    live.refusal === null ? `${live.resolved.length} literals` : '');
  t('the finding\'s own constant is in the population',
    live.refusal === null && live.resolved.some((x) =>
      x.file === 'packages/drivers/driver-sql/src/schema-drift.ts' && x.text === 'os migrate multi-value-columns'));

  // -- the command-class predicate, against a scratch tree (no repo state) ---
  //
  // Every fixture here is written to disk because the predicate READS FILES: it follows a
  // relative import into its own source, which is the half a purely in-memory fixture
  // cannot exercise at all.
  battery('the command-class predicate, against a scratch tree (no repo state)');
  const classDir = mkdtempSync(join(tmpdir(), 'cli-cmd-class-'));
  try {
    const cmds = join(classDir, 'src', 'commands');
    mkdirSync(join(cmds, 'topic'), { recursive: true });
    mkdirSync(join(cmds, '_priv'), { recursive: true });
    mkdirSync(join(cmds, '__tests__'), { recursive: true });
    const w = (rel, lines) => writeFileSync(join(cmds, rel), `${lines.join('\n')}\n`);

    w('plain.ts', ["import { Command } from '@oclif/core';", 'export default class Plain extends Command {}']);
    w('base.ts', ["import { Command } from '@oclif/core';", 'export default class Base extends Command {}']);
    w('derived.ts', ["import Base from './base.js';", 'export default class Derived extends Base {}']);
    // The card's own repro: a helper beside the command it serves.
    w('topic/helper.ts', ['export function helpWith(x) { return x; }', 'export const OTHER = 1;']);
    // A SCAFFOLDER: `export default` appears inside a template literal, before the real
    // class. `create.ts`, `generate.ts` and `init.ts` are all this shape in the live tree.
    w('scaffold.ts', [
      "import { Command } from '@oclif/core';",
      'const TEMPLATE = `',
      'export default class NotMe extends SomethingElse {}',
      '`;',
      'export default class Scaffold extends Command { run() { return TEMPLATE; } }',
    ]);
    w('bare-class.ts', ['export default class Bare {}']);
    w('object.ts', ['export default { run() {} };']);
    w('foreign.ts', ["import { Thing } from 'some-other-pkg';", 'export default class Foreign extends Thing {}']);
    w('_priv/tool.ts', ['export function tool() { return 1; }']);
    w('topic/helper.test.ts', ["import { helpWith } from './helper.js';", 'helpWith(1);']);
    w('__tests__/fixture.ts', ['export const FIXTURE = 1;']);

    const surface = commandSurfaceUnder(cmds);
    const moduleNames = surface.modules.map((m) => relative(cmds, m).split(sep).join('/')).sort();
    const verdictFor = (rel) => commandClassVerdict(join(cmds, rel), 'default');

    t('an oclif command is accepted, and the chain names Command',
      verdictFor('plain.ts').ok && verdictFor('plain.ts').chain.join(' -> ').includes('Command (@oclif/core)'));
    t('⭐ a command extending ANOTHER command, across files, is accepted',
      verdictFor('derived.ts').ok && verdictFor('derived.ts').chain.includes('Base'),
      'a predicate that only accepts `extends Command` false-reds this shape');
    t('⭐ a helper exporting only plain functions is REJECTED',
      !verdictFor('topic/helper.ts').ok && verdictFor('topic/helper.ts').reason.includes('no default export'),
      'this is the card\'s repro; a guard that stays green here is vacuous');
    t('a SCAFFOLDER whose template literal spells `export default` is accepted',
      verdictFor('scaffold.ts').ok,
      'the parse is what makes this decidable -- a template literal is not a statement');
    t('a class that extends nothing is rejected', !verdictFor('bare-class.ts').ok);
    t('a default export that is not a class is rejected',
      !verdictFor('object.ts').ok && verdictFor('object.ts').reason.includes('not a class'));
    t('a base class from a NON-oclif package is rejected',
      !verdictFor('foreign.ts').ok && verdictFor('foreign.ts').reason.includes('some-other-pkg'));
    t('the module population is the EMITTED set: no .test.ts, no __tests__/',
      !moduleNames.some((m) => m.endsWith('.test.ts')) && !moduleNames.some((m) => m.startsWith('__tests__/')),
      moduleNames.join(' '));
    t('⭐ a directory that cannot name an id still contributes its MODULES',
      moduleNames.includes('_priv/tool.ts'),
      'tsc emits it and the oclif glob loads it, so the guard must reach it');
    t('...and contributes no ID -- duty one is untouched by that descent',
      !surface.ids.has('_priv') && !surface.topics.has('_priv') && surface.ids.has('plain'));
  } finally {
    rmSync(classDir, { recursive: true, force: true });
  }

  // -- the command-module duty on the live repo, by name ---------------------
  battery('the command-module duty on the live repo, by name');
  const modulesLive = audit();
  const liveVerdict = (f) => (modulesLive.examined ?? []).find((m) => m.file === f);
  const buildTs = liveVerdict('packages/cli/src/commands/build.ts');
  const migrateIndexTs = liveVerdict('packages/cli/src/commands/migrate/index.ts');

  t('⭐ packages/cli/src/commands/build.ts is accepted, via Compile',
    Boolean(buildTs) && buildTs.ok && buildTs.chain.includes('Compile'),
    buildTs ? buildTs.chain.join(' -> ') : 'not in the examined population');
  t('⭐ packages/cli/src/commands/migrate/index.ts is accepted, via MigratePlan',
    Boolean(migrateIndexTs) && migrateIndexTs.ok && migrateIndexTs.chain.includes('MigratePlan'),
    migrateIndexTs ? migrateIndexTs.chain.join(' -> ') : 'not in the examined population');
  t('...and NEITHER extends `Command` directly, so a narrow predicate would false-red both',
    Boolean(buildTs) && Boolean(migrateIndexTs)
    && buildTs.chain.length > 2 && migrateIndexTs.chain.length > 2,
    'the two cases triage measured, pinned by name rather than by count');
  t('packages/cli/src/commands/test.ts is EXAMINED -- it is a command, not a test',
    Boolean(liveVerdict('packages/cli/src/commands/test.ts')),
    'a bare `grep -v test` over this population silently drops it');
  t('the examined population is non-trivial',
    modulesLive.refusal === null && modulesLive.examined.length >= 40,
    modulesLive.refusal === null ? `${modulesLive.examined.length} modules examined` : modulesLive.refusal);
  t('every examined module is a command', modulesLive.refusal === null && modulesLive.moduleViolations.length === 0,
    modulesLive.refusal === null ? modulesLive.moduleViolations.map((v) => v.file).join('; ') : '');
  t('no command-module exemption is stale',
    modulesLive.refusal === null && modulesLive.staleModules.length === 0,
    modulesLive.refusal === null ? modulesLive.staleModules.map((e) => `${e.file}: ${e.why_stale}`).join('; ') : '');
  // ⭐ The population's DEFINITION is coupled to the CLI build, and the coupling is
  // checked rather than asserted in prose. `isEmittedCommandModule` drops exactly the
  // test spellings; if a package's build starts excluding something else under
  // `src/commands/`, this population silently stops matching what oclif loads -- and the
  // gate would keep printing a confident count over a set it no longer describes.
  t('every build exclusion that reaches src/commands/ is one this population already drops',
    modulesLive.refusal === null && modulesLive.clis.every((c) => {
      let cfg;
      try { cfg = readFileSync(join(REPO_ROOT, c.dir, 'tsconfig.build.json'), 'utf8'); } catch { return true; }
      const excludes = [...cfg.matchAll(/"((?:src|\.\/src)\/[^"]*)"/g)].map((m) => m[1].replace(/^\.\//, ''));
      return excludes.every((e) => {
        const rest = e.replace(/^src\//, '');
        const reaches = rest.startsWith('**/') || rest.startsWith('commands/');
        if (!reaches) return true;
        return /\*\.(?:test|spec)\.tsx?$/.test(rest) || rest.includes('__tests__/');
      });
    }),
    'a new exclude under src/commands/ must widen isEmittedCommandModule in the same edit');

  // The floor runs BEFORE the verdict below, so a success line can only be
  // printed by a run in which every declared battery registered its cases.
  for (const message of batteryFloorFailures()) cases.push({ name: message, ok: false, detail: '' });

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-cli-command-ids self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-cli-command-ids self-test: ${cases.length} cases pass `
    + '(the id derivation covers files, topic indexes and bare topic dirs and drops test sidecars; '
    + 'a known-bad literal resolves to nothing while its good neighbour resolves; '
    + 'the #12016 rename reds THE SAME literal that was green before it; '
    + 'all six measured noise shapes stay out on the delimiter rule alone; '
    + 'the fixture ledger is scoped to file AND text; the command-class predicate follows the '
    + 'inheritance chain across files and rejects a plain-function helper; and the live repo '
    + 'returns a green verdict on both duties).',
  );
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    const selfTestCode = selfTest();
      if (!selfTestReachedVerdict) {
        console.error(
          '\n✗ check-cli-command-ids self-test: selfTest() returned without reaching its verdict,\n'
            + 'so no success line was printed. Exiting 0 here would report a self-test\n'
            + 'that never finished as a self-test that passed.\n',
        );
        process.exit(1);
      }
      process.exit(selfTestCode);
  }
  else if (argv.includes('--list')) process.exit(list());
  else process.exit(main());
}
