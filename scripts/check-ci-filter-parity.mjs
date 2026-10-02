#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-ci-filter-parity (#10379) -- LAYER C of the cross-package test-input
 * mechanism: every glob a package declares must be reachable by the job that
 * acts on the declaration.
 *
 *   node scripts/check-ci-filter-parity.mjs              # judge the checked-in ci.yml
 *   node scripts/check-ci-filter-parity.mjs --list       # every declared glob and how it is covered
 *   node scripts/check-ci-filter-parity.mjs --self-test  # prove the battery can go red
 *
 * ## The gap this closes
 *
 * `CROSS_PACKAGE_TEST_INPUTS` in `scripts/check-cross-package-test-inputs.mjs`
 * declares, per package, the repo-relative globs its tests read outside their
 * own directory. Three layers act on that declaration, and until this gate only
 * two of them were checked:
 *
 *   Layer A  `--union-into` adds the declaring package to the shard's package
 *            set when the diff touches its globs. That step lives INSIDE ci.yml's
 *            `test` job.
 *   Layer B  `--verify` requires turbo.json to carry a matching `$TURBO_ROOT$/...`
 *            input, so the task hash moves with the declared path.
 *   Layer C  the SCHEDULER has to start the job Layer A's step lives in. ci.yml's
 *            `filter` job decides that, and it decides it from a hand-kept list.
 *
 * `crosspkg:` in that filter is a SECOND RECOGNIZER of the same declarations --
 * the top-level roots `CROSS_PACKAGE_TEST_INPUTS` names that `core:` does not
 * already match. Nothing held the two in step. Add a declaration in a root no
 * entry covers -- `docker/`, `paseo.json`, a second `skills/*` bundle, another
 * `docs/...` file -- and `check:cross-package-test-inputs` stays GREEN, the
 * turbo hash still moves, and the test STILL DOES NOT RUN at PR time: no filter
 * matches, the `test` job never starts, `--union-into` never runs, and the merge
 * queue is the first signal. That is #7802's shape, one layer up, and it is the
 * failure #10015 was filed for after #9829 fixed one root.
 *
 * Measured on `699132f259`, with the four roots #10015 added removed from
 * `crosspkg` (i.e. the pre-#10015 list, `scripts/**` alone): 10 of 71 unique
 * declared globs uncovered -- the exact ten #10015 fixed. With today's list: 0.
 * Nothing but this gate holds that zero.
 *
 * ## The coverage rule is PURE STRING, and that is the design, not a shortcut
 *
 *   a declared glob is covered iff some scheduling list literally contains it,
 *   or contains `<prefix>/**` for a directory prefix of its leading LITERAL
 *   segments.
 *
 * The tempting alternative is to instantiate each declaration to a real tracked
 * file and run it through the filters with a glob matcher. That was rejected,
 * and the reason is the defect this gate is about: `core:` carries the extglob
 * `apps/!(docs)/**`, which the sibling gate's deliberately dependency-free
 * `globToRegExp` does not support, so a file-instantiating rule would need a
 * picomatch-compatible matcher -- a THIRD recognizer of the same declarations,
 * with its own divergence risk. A pure-string rule needs no matcher at all.
 *
 * ## Its error direction, stated because it decides whether the rule is safe
 *
 * The rule is SOUND and deliberately INCOMPLETE.
 *
 *   Sound: if a scheduling list contains the glob verbatim, every file matching
 *   the declaration matches that entry. If it contains `<prefix>/**` for a
 *   literal prefix of the declaration, every file matching the declaration lies
 *   under `<prefix>/` and so matches that entry too. Neither limb can report
 *   covered for a declaration the scheduler would miss.
 *
 *   Incomplete: an entry carrying a wildcard of its own -- `apps/!(docs)/**` is
 *   the only one today -- covers nothing by this rule. A declaration under
 *   `apps/` would be reported uncovered even though picomatch would schedule it.
 *   The cost of that error is one line of YAML; the cost of the other direction
 *   is a silent scheduling gap, which is the whole subject of this file.
 *
 * Cross-checked once against the real matcher rather than argued: on
 * `699132f259`, instantiating all 71 unique declared globs to the tracked files
 * they match (5 for the narrowest, thousands for `packages/**`) and running each
 * through `core` + `crosspkg` with picomatch 4.0.5 -- the matcher
 * `dorny/paths-filter@v4` uses -- the pure-string rule and picomatch agree on
 * all 71 rows, with no glob matching zero tracked files. That measurement is
 * EVIDENCE, deliberately not machinery: reproducing it in this gate is the third
 * recognizer the paragraph above refuses.
 *
 * ## What is a "scheduling list", and why the `if:` is read too
 *
 * `SCHEDULING_FILTERS` is `core` + `crosspkg` because ci.yml's `test` job ORs
 * exactly those two. That is not remembered here -- the gate READS the job's
 * `if:` and refuses if either name has left it. Without that limb, deleting
 * `crosspkg` from the OR would reopen the entire hole while this gate went on
 * reporting parity against a list that no longer schedules anything.
 *
 * ## Refusals -- what this gate does instead of reporting a clean zero
 *
 * A parity gate that cannot find the filters compares two empty sets and passes.
 * Every state in which the subject was not actually read is exit 1 naming what
 * could not be read, never a quiet pass (#4690): ci.yml unreadable or
 * unparseable, no `dorny/paths-filter` step in the `filter` job, a `filters:`
 * input that is not a string or does not parse to lists of strings, a scheduling
 * filter absent from it, a scheduling filter gone from the `test` job's `if:`,
 * and a declaration table that arrived empty.
 *
 * ## Why it reads the table instead of holding a copy
 *
 * `CROSS_PACKAGE_TEST_INPUTS` is imported from `scripts/cross-package-test-inputs.mjs`,
 * the plain module that declares it. A copy here would be a second list of the
 * declarations kept in step by hand -- exactly the defect this gate exists to
 * close, one file further out.
 *
 * That module is a plain module and not the sibling GATE, which is a difference
 * this gate is the beneficiary of (#11511). The table used to live inside
 * `check-cross-package-test-inputs.mjs`, and `scripts/pm/dispatch-gates.mjs`
 * follows a gate's first-party imports one level but never into a file that is
 * itself a discovered gate -- so the dispatch derivation named this gate for
 * NOTHING the table declares, though the table is precisely this gate's
 * population. Measured on 589758d22: 1 (gate, file) pair before, 3253 after.
 *
 * ## The second subject: the `console` selection and the dist key it must move (#20765)
 *
 * The same filter job schedules `Console Pin Gate` from a second hand-kept list,
 * `console:`, and that job restores its console dist from a cache keyed on
 * `hashFiles(...)`. The two lists answer different questions and each has a hole
 * the other one cannot see:
 *
 *   - A path the KEY hashes but the FILTER does not name moves the key without
 *     starting the job, so the first build under the new key is the merge
 *     queue's, where a check outside the required set cannot stop a merge.
 *   - A path the FILTER names but the KEY does not hash starts the job, and the
 *     job then restores the dist built before the change and skips the build
 *     step, which is where the build-time assertion
 *     (`scripts/assert-console-spec-injection.mjs`) lives. The run is green
 *     without judging the change. That is only right for a GUARD: code every run
 *     executes, hit or miss. `CONSOLE_GUARDS` declares those, each with the step
 *     that runs it.
 *
 * Measured on the #20695 shape (the migration registries moved to a new spec
 * entry): its queue build missed the cache, rebuilt, and went red with "Neither
 * spec appears in the built console"; a fixture replay of the same head on the
 * cache-hit path (the restored pre-move dist, its stamp, the post-move tree)
 * exits 0. So the job judges an entry-layout change only when the key moves too.
 *
 * So `judgeConsole` holds five things of the checked-in ci.yml: every `console`
 * entry is a literal path (with no pattern in the list, a path selects the job
 * exactly when the list names it, which is what lets the self-test pin the
 * selection, and a pattern under `packages/spec` would widen the job to every
 * spec change); every key spelling in the job is one string; every hashed path
 * is a `console` entry; every `console` entry is hashed or a declared guard; and
 * every declared guard is still in the list and not hashed. Pure string again,
 * for the reason above: no matcher, so no third recognizer.
 *
 * ## The third subject: Build Core and the build inputs turbo.json declares (#21202)
 *
 * `core:` schedules Build Core, and Build Core runs `pnpm build`. turbo.json
 * declares which files outside the packages move a build's hash: itself, its
 * `globalDependencies` (inputs of every task, builds included), and each
 * `$TURBO_ROOT$/...` input of a `build` / `<package>#build` task. A diff
 * confined to one of those moves the hashes it reaches; if no `core` entry
 * matches it, Build Core does not start, and the merge queue is the first
 * place that build runs. PR #21199 showed it on itself: a turbo.json-only diff,
 * Build Core skipped.
 *
 * `judgeBuildInputs` DERIVES the required set rather than holding a copy of
 * it, so this file is not a second list of the declarations either: the
 * build-task inputs and `globalDependencies` come out of turbo.json, and the
 * builds Build Core does not run come out of the root manifest's `build`
 * script (`--filter=!<package>`), which is what the job's `run: pnpm build`
 * expands to. Every misreading of that script can only drop an exclusion,
 * which REQUIRES more of `core` -- a loud red, never a silent gap. The only
 * constant is turbo.json itself, which is the config being read.
 *
 * Findings: a declared build input no `core` entry covers (same pure-string
 * rule as above), and the reverse direction where the declarations alone can
 * decide it: a literal `core` entry in a directory that holds a declared
 * literal build input, covering none of them, is a leftover from an input
 * turbo.json dropped, and it starts the core pipeline on a diff no build reads.
 * Root-level files and pattern entries are not judged that way -- nothing here
 * says why `package.json` or `packages/**` is in `core`. Refusals: no `build-core` job, its `if:` no longer naming
 * `core`, no `run: pnpm build` step, turbo.json or the root manifest unreadable
 * or not JSON, no `tasks` map, no build task, and a `build` script that is not
 * `turbo run build ...`.
 *
 * Known bounds: a package-level turbo.json (none is tracked today) would add
 * build inputs this subject does not read; and a leftover in a directory where
 * turbo.json no longer declares ANY build input is not reported (the cheap
 * direction: it over-schedules, it never under-schedules).
 *
 * ## Wiring
 *
 * Invoked from `.github/workflows/lint.yml` as `node scripts/...` directly, both
 * legs, rather than through a `pnpm check:*` alias: see the GATE INVOCATION
 * IDIOM note at the top of that file, which states the reasons once. It is NOT
 * because root `package.json` is off limits -- that reading of the #9465 fence
 * is false, and the note carries the fence's verbatim scope so this docblock
 * does not have to: restating it is how the wrong reading spread (#10894).
 * The self-test asserts that wiring against the workflow text -- a gate that
 * exists and is not scheduled is the same dormant shape from the other side.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { requireDependency } from './import-prerequisite.mjs';
const { parse } = await requireDependency('yaml', () => import('yaml'), import.meta.url);

import { CROSS_PACKAGE_TEST_INPUTS } from './cross-package-test-inputs.mjs';
import { isEntrypoint } from './invoked-as.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. Every section opens with `battery('<name>')`,
// every assertion is attributed to the battery most recently opened, and the
// floor requires the OPENED set to equal the DECLARED set with each battery at
// or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  '(1) the coverage rule, both limbs and both directions': 7,
  '(2) THE SAME-ROOT-DIFFERENT-FILE CASE': 3,
  '(3) the three coverage outcomes, end to end through `judge`': 7,
  '(4) the reverse direction: a `crosspkg` entry covering nothing': 3,
  '(5) refusals: never a clean zero over a subject that was not read': 10,
  '(6) the real tree': 10,
  '(7) WIRING: the gate and its self-test really run in CI': 2,
  '(8) the `console` selection and the dist key it must move': 20,
  '(9) Build Core and the build inputs turbo.json declares': 33,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 9;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(HERE, '..');

/** The workflow that owns the scheduling decision. */
export const CI_WORKFLOW = '.github/workflows/ci.yml';
/** The job whose `if:` the declarations depend on, by job id. */
export const SCHEDULED_JOB = 'test';
/**
 * The filter outputs that job ORs, and therefore the lists a declared glob may
 * be covered by. Read back out of the `if:` rather than trusted -- see the
 * header.
 */
export const SCHEDULING_FILTERS = ['core', 'crosspkg'];
/** Where an uncovered declaration should be added. */
export const REMEDY_FILTER = 'crosspkg';

/** Anything picomatch would read as a pattern rather than a literal segment. */
const WILDCARD = /[*?[\]{}!()+@]/;

/**
 * The directory prefixes of a glob's LEADING LITERAL segments, shallowest
 * first. `content/docs/api/error-catalog.mdx` yields `content`,
 * `content/docs`, `content/docs/api`, `content/docs/api/error-catalog.mdx`;
 * `packages/**\/*.object.ts` yields `packages` and stops at the wildcard.
 *
 * The final element is the whole literal path, which is a directory prefix only
 * when the declaration names a directory. That costs nothing: it is used only to
 * ask whether `<prefix>/**` is a scheduling entry, and `<a-file>/**` is not a
 * pattern anyone writes.
 */
export function literalPrefixes(glob) {
  const segments = String(glob).split('/');
  const prefixes = [];
  for (let i = 0; i < segments.length; i++) {
    if (WILDCARD.test(segments[i])) break;
    prefixes.push(segments.slice(0, i + 1).join('/'));
  }
  return prefixes;
}

/**
 * Is this declared glob reachable by the scheduling lists? Returns the ENTRY
 * that covers it, so a report can say how rather than only whether.
 */
export function coverageVerdict(glob, entries) {
  const set = new Set(entries);
  if (set.has(glob)) return { covered: true, via: glob, kind: 'literal' };
  for (const prefix of literalPrefixes(glob)) {
    const subtree = `${prefix}/**`;
    if (set.has(subtree)) return { covered: true, via: subtree, kind: 'subtree' };
  }
  return { covered: false, via: null, kind: null };
}

/** Every (package, glob) pair the table declares, flattened. */
export function declarationsOf(table) {
  const rows = [];
  for (const [pkg, entry] of Object.entries(table ?? {})) {
    for (const glob of entry?.globs ?? []) rows.push({ pkg, glob });
  }
  return rows;
}

/**
 * Read the scheduling lists out of a ci.yml SOURCE STRING. Returns
 * `{ refusal }` for every state in which the subject was not read, so the
 * caller never compares two empty sets and calls it parity.
 *
 * `dorny/paths-filter` takes its `filters` input as a STRING and parses that
 * string as YAML itself, so this is two parses, in the same order the action
 * does them.
 */
export function readSchedulingFilters(source) {
  const read = readFilterLists(source);
  if (read.refusal) return read;
  const { jobs, filters } = read;
  for (const name of SCHEDULING_FILTERS) {
    if (!(name in filters)) {
      return { refusal: `${CI_WORKFLOW}'s \`filters:\` input declares no \`${name}:\` filter.` };
    }
  }

  const job = jobs[SCHEDULED_JOB];
  if (!job) return { refusal: `${CI_WORKFLOW} has no \`${SCHEDULED_JOB}\` job -- Layer A's \`--union-into\` step has moved.` };
  const condition = typeof job.if === 'string' ? job.if : '';
  const absent = SCHEDULING_FILTERS.filter((n) => !condition.includes(`needs.filter.outputs.${n}`));
  if (absent.length > 0) {
    return {
      refusal:
        `${CI_WORKFLOW}'s \`${SCHEDULED_JOB}\` job no longer names ${absent.map((n) => `\`${n}\``).join(', ')} in its \`if:\`, ` +
        `so that filter does not schedule it any more and parity against it means nothing.\n` +
        `    if: ${condition || '(absent)'}`,
    };
  }

  return { filters, condition, entries: SCHEDULING_FILTERS.flatMap((n) => filters[n]) };
}

/**
 * The shared half of both readers: ci.yml's `jobs` map and the `filter` job's
 * path lists, or `{ refusal }` naming what could not be read. Both subjects of
 * this gate read the lists through here, so they cannot disagree about what
 * the lists are.
 */
function readFilterLists(source) {
  let doc;
  try {
    doc = parse(source);
  } catch (err) {
    return { refusal: `${CI_WORKFLOW} could not be read as YAML: ${err?.message ?? err}` };
  }
  const jobs = doc?.jobs;
  if (!jobs || typeof jobs !== 'object') return { refusal: `${CI_WORKFLOW} declares no \`jobs:\` map.` };

  const filterJob = jobs.filter;
  if (!filterJob) return { refusal: `${CI_WORKFLOW} has no \`filter\` job -- the scheduling decision has moved.` };
  const steps = Array.isArray(filterJob.steps) ? filterJob.steps : [];
  const pathsFilterSteps = steps.filter((s) => String(s?.uses ?? '').startsWith('dorny/paths-filter'));
  if (pathsFilterSteps.length !== 1) {
    return {
      refusal:
        `${CI_WORKFLOW}'s \`filter\` job has ${pathsFilterSteps.length} \`dorny/paths-filter\` step(s); ` +
        `this gate reads exactly one. The scheduling decision has moved or been split.`,
    };
  }
  const raw = pathsFilterSteps[0]?.with?.filters;
  if (typeof raw !== 'string') {
    return { refusal: `${CI_WORKFLOW}'s \`dorny/paths-filter\` step carries no \`with.filters\` STRING to parse.` };
  }

  let filters;
  try {
    filters = parse(raw);
  } catch (err) {
    return { refusal: `${CI_WORKFLOW}'s \`filters:\` input is not parseable YAML: ${err?.message ?? err}` };
  }
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    return { refusal: `${CI_WORKFLOW}'s \`filters:\` input did not parse to a map of filter names.` };
  }
  for (const [name, list] of Object.entries(filters)) {
    if (!Array.isArray(list) || list.some((e) => typeof e !== 'string')) {
      return { refusal: `${CI_WORKFLOW}'s \`${name}:\` filter is not a list of path strings.` };
    }
  }
  return { jobs, filters };
}

/**
 * The verdict: which declared globs no scheduling entry covers, and which
 * `crosspkg` entries cover no declaration any more. Pure -- the caller supplies
 * both sides, which is what lets the self-test drive real failures.
 */
export function judge(source, table) {
  const read = readSchedulingFilters(source);
  if (read.refusal) return read;

  const declarations = declarationsOf(table);
  if (declarations.length === 0) {
    return { refusal: 'CROSS_PACKAGE_TEST_INPUTS declared nothing -- a parity check over an empty table is not a pass.' };
  }

  const covered = [];
  const uncovered = [];
  for (const row of declarations) {
    const verdict = coverageVerdict(row.glob, read.entries);
    (verdict.covered ? covered : uncovered).push({ ...row, ...verdict });
  }

  // The other direction. An entry in the hand-kept list that covers no
  // declaration is dead weight that makes the list LOOK maintained -- the
  // sibling gate checks its own staleness in the same pass for the same reason.
  const stale = read.filters[REMEDY_FILTER].filter(
    (entry) => !declarations.some(({ glob }) => coverageVerdict(glob, [entry]).covered),
  );

  return { filters: read.filters, condition: read.condition, declarations, covered, uncovered, stale };
}

// ── The second subject: the `console` selection and its dist key (#20765) ────

/** The filter list that schedules the console job, and that job, by id. */
export const CONSOLE_FILTER = 'console';
export const CONSOLE_JOB = 'console-pin';
/** Every spelling of the console dist-cache key carries this. */
const CONSOLE_KEY_MARKER = '-console-dist-';

/**
 * The `console` entries that are GUARDS rather than build inputs: code every
 * run of the job executes, cache hit or miss, so a change to one is judged even
 * when the dist is restored. Every other entry must move the dist key. A new
 * entry lands in neither place by default: it reds as unclassified until
 * someone decides which it is.
 */
export const CONSOLE_GUARDS = Object.freeze({
  '.github/workflows/ci.yml': 'the job definition itself: its steps run on a hit and on a miss',
  'scripts/check-console-sha.mjs': 'run by `pnpm check:console-sha` on every run, hit or miss',
  'scripts/check-console-injection.mjs': 'run by `pnpm check:console-injection --require-stamp` on every run, hit or miss',
});

/** The quoted arguments of the ONE `hashFiles(...)` a key spells, or null. */
export function hashFilesInputs(key) {
  const calls = [...String(key).matchAll(/hashFiles\(([^)]*)\)/g)];
  if (calls.length !== 1) return null;
  const args = calls[0][1].split(',').map((a) => a.trim());
  if (args.length === 0 || args.some((a) => !/^'[^']+'$/.test(a))) return null;
  return args.map((a) => a.slice(1, -1));
}

/**
 * Does a path select the console job? Only answerable when every entry is a
 * literal path, which `judgeConsole` requires; `null` otherwise, so a caller
 * can never read a pattern list as a membership test.
 */
export function consoleSelects(path, entries) {
  if (entries.some((e) => WILDCARD.test(e))) return null;
  return entries.includes(path);
}

/**
 * The verdict on the console selection and the key it must move. `{ refusal }`
 * for every state in which the subject was not read; otherwise the findings,
 * each list empty on a clean tree.
 */
export function judgeConsole(source) {
  const read = readFilterLists(source);
  if (read.refusal) return read;
  const { jobs, filters } = read;

  const entries = filters[CONSOLE_FILTER];
  if (!entries) return { refusal: `${CI_WORKFLOW}'s \`filters:\` input declares no \`${CONSOLE_FILTER}:\` filter.` };
  if (entries.length === 0) return { refusal: `${CI_WORKFLOW}'s \`${CONSOLE_FILTER}:\` filter is empty.` };

  const job = jobs[CONSOLE_JOB];
  if (!job) return { refusal: `${CI_WORKFLOW} has no \`${CONSOLE_JOB}\` job -- the console gate has moved.` };
  const condition = typeof job.if === 'string' ? job.if : '';
  if (!condition.includes(`needs.filter.outputs.${CONSOLE_FILTER}`)) {
    return {
      refusal:
        `${CI_WORKFLOW}'s \`${CONSOLE_JOB}\` job no longer names \`${CONSOLE_FILTER}\` in its \`if:\`, so that ` +
        `filter does not schedule it any more and parity against it means nothing.\n    if: ${condition || '(absent)'}`,
    };
  }

  // Every place the job spells the key: the restore and save steps' `with.key`,
  // and any env value that carries it (the remedy text the injection check prints).
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const spellings = [];
  for (const step of steps) {
    const uses = String(step?.uses ?? '');
    const key = step?.with?.key;
    if (typeof key === 'string' && key.includes(CONSOLE_KEY_MARKER)) spellings.push({ where: `${uses || step?.name} key`, key, uses });
    for (const [name, value] of Object.entries(step?.env ?? {})) {
      if (typeof value === 'string' && value.includes(CONSOLE_KEY_MARKER)) spellings.push({ where: `env ${name}`, key: value, uses: '' });
    }
  }
  const restores = spellings.filter((s) => s.uses.startsWith('actions/cache/restore'));
  const saves = spellings.filter((s) => s.uses.startsWith('actions/cache/save'));
  if (restores.length !== 1 || saves.length !== 1) {
    return {
      refusal:
        `${CI_WORKFLOW}'s \`${CONSOLE_JOB}\` job spells the console dist key in ${restores.length} restore and ` +
        `${saves.length} save step(s); this gate reads exactly one of each. The cache has moved or been split.`,
    };
  }
  const keyInputs = hashFilesInputs(restores[0].key);
  if (!keyInputs) {
    return {
      refusal:
        `${CI_WORKFLOW}'s console dist key does not spell exactly one \`hashFiles(...)\` of quoted paths:\n    ${restores[0].key}`,
    };
  }

  const mismatched = spellings.filter((s) => s.key !== restores[0].key).map((s) => s.where);
  const patterns = entries.filter((e) => WILDCARD.test(e));
  const unselected = keyInputs.filter((p) => !entries.includes(p));
  const unclassified = entries.filter((e) => !keyInputs.includes(e) && !Object.hasOwn(CONSOLE_GUARDS, e));
  const staleGuards = Object.keys(CONSOLE_GUARDS).filter((g) => !entries.includes(g));
  const hashedGuards = Object.keys(CONSOLE_GUARDS).filter((g) => keyInputs.includes(g));

  return { entries, keyInputs, spellings: spellings.length, mismatched, patterns, unselected, unclassified, staleGuards, hashedGuards };
}

function reportConsole(verdict) {
  if (verdict.refusal) {
    console.error(`FAIL: check-ci-filter-parity could not judge the console selection.\n\n  - ${verdict.refusal}\n`);
    return 1;
  }
  const problems = [];
  const lines = (xs) => xs.map((x) => `      ${x}`).join('\n');
  if (verdict.patterns.length > 0) {
    problems.push(
      `the \`${CONSOLE_FILTER}:\` filter carries pattern entr(ies):\n${lines(verdict.patterns)}\n` +
        '    Name files. A pattern under packages/spec widens the console gate to every spec change, and a\n' +
        '    list of literal paths is what lets this gate say which paths select the job.',
    );
  }
  if (verdict.mismatched.length > 0) {
    problems.push(
      `the \`${CONSOLE_JOB}\` job spells the console dist key differently at: ${verdict.mismatched.join(', ')}\n` +
        '    The restore, the save and the remedy text must name ONE key, or a run saves an entry no run restores.',
    );
  }
  if (verdict.unselected.length > 0) {
    problems.push(
      `the console dist key hashes path(s) the \`${CONSOLE_FILTER}:\` filter does not name:\n${lines(verdict.unselected)}\n` +
        '    A change to one moves the key without starting the job, so its first build is the merge queue\'s,\n' +
        `    where a check outside the required set cannot stop a merge. Add each to \`${CONSOLE_FILTER}:\`.`,
    );
  }
  if (verdict.unclassified.length > 0) {
    problems.push(
      `the \`${CONSOLE_FILTER}:\` filter names path(s) the dist key does not hash and CONSOLE_GUARDS does not declare:\n` +
        `${lines(verdict.unclassified)}\n` +
        '    A head that moves one starts the job, restores the dist built before the change and skips the build\n' +
        '    step, so the run is green without judging it. A BUILD INPUT goes into the key\'s hashFiles (all of its\n' +
        '    spellings); a GUARD that every run executes goes into CONSOLE_GUARDS in this file, with the step.',
    );
  }
  if (verdict.staleGuards.length > 0) {
    problems.push(
      `CONSOLE_GUARDS declares path(s) the \`${CONSOLE_FILTER}:\` filter no longer names:\n${lines(verdict.staleGuards)}\n` +
        '    Delete the declaration, or restore the entry if the guard still runs.',
    );
  }
  if (verdict.hashedGuards.length > 0) {
    problems.push(
      `CONSOLE_GUARDS declares path(s) the dist key also hashes:\n${lines(verdict.hashedGuards)}\n` +
        '    A guard runs on a cache hit, so hashing it only buys a rebuild per change. Pick one kind.',
    );
  }
  if (problems.length > 0) {
    console.error('FAIL: ci.yml\'s `console` filter and the console dist key are out of step.\n');
    for (const p of problems) console.error(`  - ${p}\n`);
    return 1;
  }
  console.log(
    `OK: all ${verdict.entries.length} \`${CONSOLE_FILTER}\` entr(ies) are literal paths; ` +
      `${verdict.keyInputs.length} are build inputs the console dist key hashes and ` +
      `${verdict.entries.length - verdict.keyInputs.length} are declared guards; the key is spelled one way ` +
      `in all ${verdict.spellings} place(s) the \`${CONSOLE_JOB}\` job uses it.`,
  );
  return 0;
}

// ── The third subject: Build Core and the build inputs turbo.json declares (#21202) ──

/** The job every build input must schedule, by id, and the filter its `if:` reads. */
export const BUILD_JOB = 'build-core';
export const BUILD_FILTER = 'core';
/** The turbo config whose declarations are the population. */
export const TURBO_CONFIG = 'turbo.json';
/** The root manifest whose `build` script is what Build Core's `pnpm build` runs. */
export const ROOT_MANIFEST = 'package.json';
/** The step Build Core runs, verbatim; the manifest's `build` script is what it expands to. */
const BUILD_COMMAND = 'pnpm build';
/** The prefix turbo.json spells a repo-root-relative input with. */
const TURBO_ROOT = '$TURBO_ROOT$/';

/** The directory part of a repo-relative path; '' for a root-level file. */
function dirOf(path) {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** Is this turbo.json task key a build task? `build`, or `<package>#build`. */
function isBuildTask(task) {
  return task === 'build' || task.endsWith('#build');
}

/**
 * The packages the root manifest's `build` script excludes with
 * `--filter=!<name>` (or `--filter !<name>`), or `{ refusal }`. Any spelling
 * this misreads can only yield FEWER exclusions, which REQUIRES more inputs of
 * `core` -- a loud red, never a silent gap.
 */
export function buildExclusions(script) {
  if (typeof script !== 'string' || !/^\s*turbo run build(\s|$)/.test(script)) {
    return {
      refusal:
        `${ROOT_MANIFEST}'s \`build\` script is not \`turbo run build ...\` (${JSON.stringify(script ?? null)}), so it ` +
        `no longer says which build tasks Build Core's \`${BUILD_COMMAND}\` runs.`,
    };
  }
  const tokens = script.trim().split(/\s+/);
  const excluded = new Set();
  for (let i = 0; i < tokens.length; i++) {
    let value = null;
    if (tokens[i].startsWith('--filter=')) value = tokens[i].slice('--filter='.length);
    else if (tokens[i] === '--filter' || tokens[i] === '-F') value = tokens[i + 1] ?? '';
    if (value === null) continue;
    value = value.replace(/^['"]|['"]$/g, '');
    if (value.startsWith('!')) excluded.add(value.slice(1));
  }
  return { excluded };
}

/**
 * Every repo-root-relative path turbo.json makes a build input: turbo.json
 * itself, each `globalDependencies` entry (an input of every task, builds
 * included), and each `$TURBO_ROOT$/...` input of a build task Build Core runs.
 * Negated inputs are skipped -- a negation can only narrow a hash. Returns the
 * rows, each with the declarations that named it, plus the build tasks left
 * out because the build script excludes their package; or `{ refusal }`.
 */
export function buildInputsOf(turbo, excluded) {
  if (!turbo || typeof turbo !== 'object' || Array.isArray(turbo)) {
    return { refusal: `${TURBO_CONFIG} did not parse to an object.` };
  }
  const tasks = turbo.tasks;
  if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) {
    return { refusal: `${TURBO_CONFIG} declares no \`tasks\` map.` };
  }
  const buildTasks = Object.keys(tasks).filter(isBuildTask);
  if (buildTasks.length === 0) {
    return { refusal: `${TURBO_CONFIG} declares no \`build\` task -- there is no build whose inputs Build Core could run on.` };
  }

  const byPath = new Map();
  const add = (path, from) => byPath.set(path, [...(byPath.get(path) ?? []), from]);
  add(TURBO_CONFIG, 'the turbo config itself');
  for (const dep of Array.isArray(turbo.globalDependencies) ? turbo.globalDependencies : []) {
    if (typeof dep !== 'string' || dep.startsWith('!')) continue;
    add(dep.startsWith(TURBO_ROOT) ? dep.slice(TURBO_ROOT.length) : dep, 'globalDependencies');
  }
  const excludedTasks = [];
  for (const task of buildTasks) {
    const pkg = task.includes('#') ? task.slice(0, task.lastIndexOf('#')) : null;
    if (pkg !== null && excluded.has(pkg)) {
      excludedTasks.push(task);
      continue;
    }
    const inputs = Array.isArray(tasks[task]?.inputs) ? tasks[task].inputs : [];
    for (const input of inputs) {
      if (typeof input === 'string' && input.startsWith(TURBO_ROOT)) add(input.slice(TURBO_ROOT.length), task);
    }
  }
  return { rows: [...byPath].map(([path, from]) => ({ path, from })), excludedTasks };
}

/**
 * The verdict on Build Core's scheduling against the build inputs turbo.json
 * declares. Takes the three SOURCE STRINGS (null for one that could not be
 * read), so the self-test can drive every failure. `{ refusal }` for every
 * state in which the subject was not read; otherwise the findings, each list
 * empty on a clean tree.
 */
export function judgeBuildInputs(source, turboSource, manifestSource) {
  const read = readFilterLists(source);
  if (read.refusal) return read;
  const { jobs, filters } = read;

  const entries = filters[BUILD_FILTER];
  if (!entries) return { refusal: `${CI_WORKFLOW}'s \`filters:\` input declares no \`${BUILD_FILTER}:\` filter.` };

  const job = jobs[BUILD_JOB];
  if (!job) return { refusal: `${CI_WORKFLOW} has no \`${BUILD_JOB}\` job -- Build Core has moved.` };
  const condition = typeof job.if === 'string' ? job.if : '';
  if (!condition.includes(`needs.filter.outputs.${BUILD_FILTER}`)) {
    return {
      refusal:
        `${CI_WORKFLOW}'s \`${BUILD_JOB}\` job no longer names \`${BUILD_FILTER}\` in its \`if:\`, so that filter ` +
        `does not schedule it any more and parity against it means nothing.\n    if: ${condition || '(absent)'}`,
    };
  }
  const steps = Array.isArray(job.steps) ? job.steps : [];
  if (!steps.some((s) => typeof s?.run === 'string' && s.run.trim() === BUILD_COMMAND)) {
    return {
      refusal:
        `${CI_WORKFLOW}'s \`${BUILD_JOB}\` job has no \`run: ${BUILD_COMMAND}\` step, so ${ROOT_MANIFEST}'s \`build\` ` +
        'script no longer says which build tasks it runs.',
    };
  }

  if (typeof turboSource !== 'string') return { refusal: `${TURBO_CONFIG} could not be read.` };
  let turbo;
  try {
    turbo = JSON.parse(turboSource);
  } catch (err) {
    return { refusal: `${TURBO_CONFIG} could not be read as JSON: ${err?.message ?? err}` };
  }
  if (typeof manifestSource !== 'string') return { refusal: `${ROOT_MANIFEST} could not be read.` };
  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch (err) {
    return { refusal: `${ROOT_MANIFEST} could not be read as JSON: ${err?.message ?? err}` };
  }

  const exclusions = buildExclusions(manifest?.scripts?.build);
  if (exclusions.refusal) return exclusions;
  const declared = buildInputsOf(turbo, exclusions.excluded);
  if (declared.refusal) return declared;

  const covered = [];
  const uncovered = [];
  for (const row of declared.rows) {
    const verdict = coverageVerdict(row.path, entries);
    (verdict.covered ? covered : uncovered).push({ ...row, ...verdict });
  }
  // The reverse direction, judged only where it is decidable from the
  // declarations alone: a LITERAL entry in a directory that holds a declared
  // literal build input is there for the same reason those are, so one that
  // covers none of them is a leftover. Root-level files and pattern entries are
  // not this subject's to judge -- nothing here says why they are in `core`.
  const inputDirs = new Set(declared.rows.filter(({ path }) => !WILDCARD.test(path)).map(({ path }) => dirOf(path)).filter(Boolean));
  const stale = entries.filter(
    (entry) =>
      !WILDCARD.test(entry) &&
      inputDirs.has(dirOf(entry)) &&
      !declared.rows.some(({ path }) => coverageVerdict(path, [entry]).covered),
  );

  return { entries, condition, inputs: declared.rows, covered, uncovered, stale, excludedTasks: declared.excludedTasks };
}

function reportBuildInputs(verdict) {
  if (verdict.refusal) {
    console.error(`FAIL: check-ci-filter-parity could not judge Build Core's build inputs.\n\n  - ${verdict.refusal}\n`);
    return 1;
  }
  const problems = [];
  if (verdict.uncovered.length > 0) {
    problems.push(
      `${verdict.uncovered.length} build input(s) ${TURBO_CONFIG} declares are covered by no \`${BUILD_FILTER}:\` entry in ` +
        `${CI_WORKFLOW}. A diff confined to one moves the build hashes it reaches and starts no Build Core, so the\n` +
        `    merge queue is the first place that build runs:\n` +
        verdict.uncovered.map((r) => `      ${r.path}   (${r.from.join(', ')})`).join('\n') +
        `\n    Add each one VERBATIM to the \`${BUILD_FILTER}:\` filter in ${CI_WORKFLOW}. Not the subtree it sits in: over a\n` +
        '    tooling directory that starts the whole core pipeline on every tooling diff, and the declaration is the\n' +
        '    narrower list.',
    );
  }
  if (verdict.stale.length > 0) {
    problems.push(
      `${CI_WORKFLOW}'s \`${BUILD_FILTER}:\` filter carries literal entr(ies) beside declared build inputs that cover none of them -- ` +
        `left over from an input ${TURBO_CONFIG} no longer declares:\n` +
        verdict.stale.map((e) => `      ${e}`).join('\n') +
        `\n    Delete them. Each one starts the whole core pipeline on a diff no build reads.`,
    );
  }
  if (problems.length > 0) {
    console.error(`FAIL: ci.yml's \`${BUILD_FILTER}\` filter and the build inputs ${TURBO_CONFIG} declares are out of step.\n`);
    for (const p of problems) console.error(`  - ${p}\n`);
    return 1;
  }
  const fromGlobal = verdict.inputs.filter((r) => r.from.includes('globalDependencies')).length;
  console.log(
    `OK: all ${verdict.inputs.length} build input(s) ${TURBO_CONFIG} declares outside the packages (itself, ` +
      `${fromGlobal} globalDependencies, and every \`$TURBO_ROOT$\` input of a build Build Core runs) are covered by ` +
      `\`${BUILD_FILTER}\`, which the \`${BUILD_JOB}\` job's \`if:\` reads; no literal \`${BUILD_FILTER}\` entry beside ` +
      `them is a leftover. Left out because \`${BUILD_COMMAND}\` excludes their package: ` +
      `${verdict.excludedTasks.length > 0 ? verdict.excludedTasks.join(', ') : 'none'}.`,
  );
  return 0;
}

function report(verdict) {
  if (verdict.refusal) {
    console.error(`FAIL: check-ci-filter-parity could not judge the scheduling filters.\n\n  - ${verdict.refusal}\n`);
    return 1;
  }

  const problems = [];
  if (verdict.uncovered.length > 0) {
    const byGlob = new Map();
    for (const row of verdict.uncovered) byGlob.set(row.glob, [...(byGlob.get(row.glob) ?? []), row.pkg]);
    problems.push(
      `${byGlob.size} declared glob(s) are covered by NEITHER ${SCHEDULING_FILTERS.map((n) => `\`${n}\``).join(' nor ')} in ` +
        `${CI_WORKFLOW}, so a diff touching them starts no \`${SCHEDULED_JOB}\` job, runs no \`--union-into\`, and the\n` +
        `    declaring package's suite does not run at PR time:\n` +
        [...byGlob]
          .map(([glob, pkgs]) => `      ${glob}   (declared by ${[...new Set(pkgs)].join(', ')})`)
          .join('\n') +
        `\n    Add each one VERBATIM to the \`${REMEDY_FILTER}:\` filter in ${CI_WORKFLOW} -- an identical entry is\n` +
        `    exactly as narrow as the declaration. Where a root gains several declarations, one\n` +
        `    \`<prefix>/**\` entry covering them all is the alternative; nothing narrower than the\n` +
        `    declaration itself is ever required.`,
    );
  }
  if (verdict.stale.length > 0) {
    problems.push(
      `${CI_WORKFLOW}'s \`${REMEDY_FILTER}:\` filter carries entr(ies) that cover no declared glob any more:\n` +
        verdict.stale.map((e) => `      ${e}`).join('\n') +
        `\n    Delete them. An entry covering nothing schedules the \`${SCHEDULED_JOB}\` job for a radius no\n` +
        `    package declares, and it makes a hand-kept list look maintained while it is not.`,
    );
  }

  if (problems.length > 0) {
    console.error('FAIL: ci.yml\'s scheduling filters are out of step with CROSS_PACKAGE_TEST_INPUTS.\n');
    for (const p of problems) console.error(`  - ${p}\n`);
    console.error(
      'Why this gate exists: the declaration mechanism has THREE layers, and `check:cross-package-\n' +
        'test-inputs` verifies two of them. It finds the escaping tests itself, and `--verify` makes\n' +
        'turbo.json hash the declared globs. Neither can see the third: the SCHEDULER has to start\n' +
        'the job the `--union-into` step lives in, and it decides that from the hand-kept list above\n' +
        '(#10379, the #7802 shape one layer up).\n',
    );
    return 1;
  }

  console.log(
    `OK: all ${verdict.declarations.length} declared cross-package glob(s) ` +
      `(${new Set(verdict.declarations.map((d) => d.glob)).size} unique) are covered by ` +
      `${SCHEDULING_FILTERS.map((n) => `\`${n}\``).join(' or ')}, every \`${REMEDY_FILTER}\` entry still covers one, ` +
      `and the \`${SCHEDULED_JOB}\` job's \`if:\` still names both filters.`,
  );
  return 0;
}

export function main(root = REPO_ROOT, table = CROSS_PACKAGE_TEST_INPUTS) {
  let source;
  try {
    source = readFileSync(join(root, CI_WORKFLOW), 'utf8');
  } catch (err) {
    console.error(`FAIL: cannot read ${CI_WORKFLOW}: ${err?.code ?? err?.message ?? err}`);
    return 1;
  }
  // Every subject is judged and every one reports, so one red never hides another.
  const crosspkg = report(judge(source, table));
  const consoleCode = reportConsole(judgeConsole(source));
  const buildCode = reportBuildInputs(judgeBuildInputs(source, readOrNull(root, TURBO_CONFIG), readOrNull(root, ROOT_MANIFEST)));
  return crosspkg === 0 && consoleCode === 0 && buildCode === 0 ? 0 : 1;
}

/** A root file's text, or null when it cannot be read -- the judge refuses on null by name. */
function readOrNull(root, rel) {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

function list(root = REPO_ROOT, table = CROSS_PACKAGE_TEST_INPUTS) {
  const verdict = judge(readFileSync(join(root, CI_WORKFLOW), 'utf8'), table);
  if (verdict.refusal) {
    console.error(`FAIL: ${verdict.refusal}`);
    return 1;
  }
  for (const name of SCHEDULING_FILTERS) console.log(`${name}: ${JSON.stringify(verdict.filters[name])}`);
  console.log('');
  const seen = new Set();
  for (const row of [...verdict.covered, ...verdict.uncovered].sort((a, b) => a.glob.localeCompare(b.glob))) {
    if (seen.has(row.glob)) continue;
    seen.add(row.glob);
    console.log(`${row.covered ? 'ok  ' : 'FAIL'} ${row.glob}${row.covered ? `   via ${row.kind} ${row.via}` : ''}`);
  }
  console.log(`\n${seen.size} unique glob(s), ${verdict.uncovered.length} uncovered declaration(s).`);

  const con = judgeConsole(readFileSync(join(root, CI_WORKFLOW), 'utf8'));
  if (con.refusal) {
    console.error(`FAIL: ${con.refusal}`);
    return 1;
  }
  console.log(`\n${CONSOLE_FILTER}: ${JSON.stringify(con.entries)}`);
  for (const entry of con.entries) {
    const kind = con.keyInputs.includes(entry) ? 'build input (hashed into the dist key)' : Object.hasOwn(CONSOLE_GUARDS, entry) ? `guard: ${CONSOLE_GUARDS[entry]}` : 'UNCLASSIFIED';
    console.log(`${kind === 'UNCLASSIFIED' ? 'FAIL' : 'ok  '} ${entry}   ${kind}`);
  }

  const build = judgeBuildInputs(readFileSync(join(root, CI_WORKFLOW), 'utf8'), readOrNull(root, TURBO_CONFIG), readOrNull(root, ROOT_MANIFEST));
  if (build.refusal) {
    console.error(`FAIL: ${build.refusal}`);
    return 1;
  }
  console.log(`\nbuild inputs ${TURBO_CONFIG} declares, against ${BUILD_FILTER} (${BUILD_JOB}):`);
  for (const row of [...build.covered, ...build.uncovered].sort((a, b) => a.path.localeCompare(b.path))) {
    console.log(`${row.covered ? 'ok  ' : 'FAIL'} ${row.path}${row.covered ? `   via ${row.kind} ${row.via}` : ''}   (${row.from.join(', ')})`);
  }
  for (const entry of build.stale) console.log(`FAIL ${entry}   stale: covers no declared build input`);
  console.log(`left out (excluded by \`${BUILD_COMMAND}\`): ${build.excludedTasks.join(', ') || 'none'}`);
  return verdict.uncovered.length > 0 || con.unclassified.length > 0 || build.uncovered.length > 0 || build.stale.length > 0 ? 1 : 0;
}

// ── self-test ────────────────────────────────────────────────────────────────
//
// Both directions, on fixtures this file builds, plus the real tree. The cases
// that matter most are the two a cheaper rule gets wrong: a declaration whose
// ROOT is present in a scheduling list through a DIFFERENT FILE
// (`.github/workflows/ci.yml` is in `core`; `.github/workflows/scaffold-e2e.yml`
// is a different file and must be named), and a declaration under a root that
// appears nowhere at all.

// ⛔ The fixture builders below live INSIDE `selfTest()` and must stay there
// (#10841). `scripts/pm/dispatch-gates.mjs` scans a gate's MODULE BODY for the
// path literals it reads -- blanking comments and self-test BODIES first -- and
// prints the gate as a local gate for every card those literals cover. A fixture
// helper hoisted to module scope escapes that blanking, and its fixture globs are
// then read as this gate's declared population.
//
// Measured on `3637731e2` before the move: this gate's hint set was
// `.github/workflows/ci.yml` (real) plus the two subtree globs the `core`/
// `crosspkg` defaults spell and the fixture table's package name (all three
// fabricated), and the pair census put it in the MATCHED column for 5328 of 6511
// tracked files. Its real population is ci.yml and its own source: 2. A
// fabricated lead is pasted into a dispatch prompt and cannot be told apart from
// an earned one, so the cost was paid by every card under two of the largest
// directories in the tree.
//
// A fixture that must be module-scope for some other reason can still be spelled
// safely -- assemble it from unslashed halves the way `DEFAULT_BASE_REF` does in
// dispatch-gates.mjs, so only the joined value is pathy and it exists at runtime
// alone.

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

export async function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };

  /** A ci.yml source carrying the two scheduling lists, in the real shape. */
  const REAL_TEST_IF =
    "${{ !cancelled() && (needs.filter.outputs.core != 'false' || needs.filter.outputs.crosspkg != 'false') }}";

  function fixtureWorkflow({ core, crosspkg, condition = REAL_TEST_IF } = {}) {
    const list = (entries) => entries.map((e) => `              - '${e}'`).join('\n');
    return [
      'name: CI',
      'jobs:',
      '  filter:',
      '    steps:',
      '      - uses: dorny/paths-filter@v4',
      '        id: changes',
      '        with:',
      '          filters: |',
      '            core:',
      list(core ?? ['packages/**', '.github/workflows/ci.yml']),
      `            ${REMEDY_FILTER}:`,
      list(crosspkg ?? ['scripts/**']),
      '  test:',
      `    if: ${JSON.stringify(condition)}`,
      '    steps:',
      '      - run: echo test',
    ].join('\n');
  }

  const table = (globs) => ({ '@objectstack/probe': { globs } });

  const failures = [];
  let checked = 0;
  const assert = (cond, label) => {
    registerCase();
    checked += 1;
    if (!cond) failures.push(label);
  };
  const uncoveredGlobs = (verdict) => (verdict.uncovered ?? []).map((r) => r.glob);
  // A gate's failure text scrolling past inside a PASSING self-test is how a
  // green run gets read as a red one, so the cases that drive `main()` to its
  // failure path are run with its output muted.
  const quietly = (fn) => {
    const { log, error } = console;
    console.log = () => {};
    console.error = () => {};
    try {
      return fn();
    } finally {
      console.log = log;
      console.error = error;
    }
  };

  // ── (1) the coverage rule, both limbs and both directions ───────────────
  battery('(1) the coverage rule, both limbs and both directions');
  assert(coverageVerdict('scripts/**', ['scripts/**']).covered, 'a glob a list contains VERBATIM is covered');
  assert(
    coverageVerdict('content/docs/api/error-catalog.mdx', ['content/**']).kind === 'subtree',
    'a file under a declared subtree entry is covered BY that subtree',
  );
  assert(
    coverageVerdict('packages/**/*.object.ts', ['packages/**']).covered,
    'a wildcard declaration is covered by the subtree entry of its literal prefix',
  );
  assert(
    !coverageVerdict('docker/**', ['packages/**', 'scripts/**', 'content/**']).covered,
    'a glob under a root no entry names is UNCOVERED',
  );
  assert(literalPrefixes('packages/**/*.object.ts').join(',') === 'packages', 'prefixes stop at the first wildcard segment');
  assert(
    literalPrefixes('content/docs/api/x.mdx').join(',') === 'content,content/docs,content/docs/api,content/docs/api/x.mdx',
    'a fully literal path yields every one of its prefixes, shallowest first',
  );

  // The incompleteness this gate accepts, pinned so it is a known bound rather
  // than a surprise: an entry with a wildcard of its own covers nothing here.
  assert(
    !coverageVerdict('apps/web/**', ['apps/!(docs)/**']).covered,
    'an extglob entry covers nothing by this rule -- the deliberate false-RED direction',
  );

  // ── (2) THE SAME-ROOT-DIFFERENT-FILE CASE ───────────────────────────────
  // `core` names `.github/workflows/ci.yml`. A rule that asked "is this glob's
  // ROOT mentioned anywhere?" would answer covered for a DIFFERENT file under
  // that root, and the ten declarations #10015 fixed included exactly this one.
  battery('(2) THE SAME-ROOT-DIFFERENT-FILE CASE');
  const sameRoot = judge(
    fixtureWorkflow({ core: ['packages/**', '.github/workflows/ci.yml'], crosspkg: ['scripts/**'] }),
    table(['.github/workflows/scaffold-e2e.yml']),
  );
  assert(
    uncoveredGlobs(sameRoot).includes('.github/workflows/scaffold-e2e.yml'),
    'a SIBLING FILE under a root some entry mentions is uncovered -- the case a root-level rule false-greens',
  );
  assert(
    !coverageVerdict('.github/workflows/scaffold-e2e.yml', ['.github/workflows/ci.yml']).covered,
    '-- and the rule itself says so, with no subtree entry anywhere near it',
  );
  const sameRootFixed = judge(
    fixtureWorkflow({ crosspkg: ['scripts/**', '.github/workflows/scaffold-e2e.yml'] }),
    table(['.github/workflows/scaffold-e2e.yml']),
  );
  assert(uncoveredGlobs(sameRootFixed).length === 0, '-- and naming the file itself in `crosspkg` covers it');

  // ── (3) the three coverage outcomes, end to end through `judge` ──────────
  battery('(3) the three coverage outcomes, end to end through `judge`');
  const viaCore = judge(fixtureWorkflow(), table(['packages/lint/src/**']));
  assert(uncoveredGlobs(viaCore).length === 0, 'a glob covered by `core` PASSES');
  assert(viaCore.covered[0].via === 'packages/**', '-- and the verdict names the entry that covered it');

  const viaCrosspkg = judge(fixtureWorkflow({ crosspkg: ['scripts/**', 'content/**'] }), table(['content/docs/x.mdx']));
  assert(uncoveredGlobs(viaCrosspkg).length === 0, 'a glob covered ONLY by `crosspkg` PASSES');
  assert(viaCrosspkg.covered[0].via === 'content/**', '-- via the crosspkg subtree entry, not core');

  const viaNeither = judge(fixtureWorkflow(), table(['docker/**']));
  assert(uncoveredGlobs(viaNeither).join(',') === 'docker/**', 'a glob covered by NEITHER list FAILS, naming the glob');
  // Optional-chained on purpose: an assertion that THROWS when the row is
  // missing aborts the battery instead of reporting, and the row being missing
  // is exactly what a broken coverage rule produces.
  assert(viaNeither.uncovered[0]?.pkg === '@objectstack/probe', '-- and naming the package that declared it');

  // A gate that only ever reported "uncovered" would satisfy the case above as
  // well, so the mixed fixture pins that it separates them within one table.
  const mixed = judge(fixtureWorkflow({ crosspkg: ['scripts/**', 'content/**'] }), table(['packages/a/**', 'content/b.mdx', 'docker/c']));
  assert(
    mixed.covered.length === 2 && uncoveredGlobs(mixed).join(',') === 'docker/c',
    'a mixed table separates covered from uncovered rather than judging the table as one',
  );

  // ── (4) the reverse direction: a `crosspkg` entry covering nothing ───────
  battery('(4) the reverse direction: a `crosspkg` entry covering nothing');
  const stale = judge(fixtureWorkflow({ crosspkg: ['scripts/**', 'tools/**'] }), table(['scripts/x.mjs']));
  assert(stale.stale.join(',') === 'tools/**', 'a `crosspkg` entry that covers no declaration is reported stale');
  assert(uncoveredGlobs(stale).length === 0, '-- while the declaration it does cover stays covered');
  const notStale = judge(fixtureWorkflow({ crosspkg: ['content/**'] }), table(['content/docs/x.mdx']));
  assert(notStale.stale.length === 0, 'an entry covering a declaration through the SUBTREE limb is not stale');

  // ── (5) refusals: never a clean zero over a subject that was not read ────
  battery('(5) refusals: never a clean zero over a subject that was not read');
  const refusal = (source, tbl = table(['packages/a/**'])) => judge(source, tbl).refusal;
  assert(
    /could not be read as YAML/.test(refusal('jobs:\n  filter:\n  \tbad: [') ?? ''),
    'a ci.yml that is not YAML at all ⇒ REFUSAL naming the parse error',
  );
  assert(/no \`jobs:\` map/.test(refusal('name: CI\n') ?? ''), 'a ci.yml with no jobs map ⇒ REFUSAL');
  assert(
    /no \`filter\` job/.test(refusal('name: CI\njobs:\n  build: {}\n') ?? ''),
    'a ci.yml with no `filter` job ⇒ REFUSAL',
  );
  assert(
    /dorny\/paths-filter/.test(refusal('name: CI\njobs:\n  filter:\n    steps:\n      - run: echo hi\n') ?? ''),
    'a `filter` job with no paths-filter step ⇒ REFUSAL',
  );
  assert(
    /declares no \`crosspkg:\` filter/.test(
      refusal(fixtureWorkflow().replace(/            crosspkg:\n(              - '[^']*'\n?)+/, '')) ?? '',
    ),
    'a filters input missing a scheduling filter ⇒ REFUSAL naming it',
  );
  assert(
    /no longer names \`crosspkg\`/.test(
      refusal(fixtureWorkflow({ condition: "${{ !cancelled() && needs.filter.outputs.core != 'false' }}" })) ?? '',
    ),
    'the `test` job dropping a filter from its `if:` ⇒ REFUSAL -- parity against a list that schedules nothing is not parity',
  );
  assert(/declared nothing/.test(judge(fixtureWorkflow(), {}).refusal ?? ''), 'an empty declaration table ⇒ REFUSAL, not a pass');
  assert(
    quietly(() => main('/nonexistent-root-for-self-test')) === 1,
    'main() returns 1 rather than throwing when ci.yml cannot be read',
  );
  assert(
    quietly(() => main(REPO_ROOT, table(['docker/**']))) === 1,
    'main() returns 1 over the real ci.yml when a declaration is uncovered -- the report path, not only `judge`',
  );
  assert(
    quietly(() => main(REPO_ROOT)) === 0,
    '-- and 0 over the checked-in table, so the case above is not satisfied by a gate that always fails',
  );

  // ── (6) the real tree ───────────────────────────────────────────────────
  battery('(6) the real tree');
  const real = judge(readFileSync(join(REPO_ROOT, CI_WORKFLOW), 'utf8'), CROSS_PACKAGE_TEST_INPUTS);
  assert(!real.refusal, `the checked-in ci.yml is readable by this gate -- ${real.refusal ?? ''}`);
  assert((real.declarations ?? []).length > 0, 'the checked-in table declares something to judge');
  assert(
    (real.filters?.[REMEDY_FILTER] ?? []).includes('.github/workflows/scaffold-e2e.yml'),
    'the checked-in `crosspkg` still names the same-root-different-file entry #10015 added',
  );
  // The pre-#10015 list, as the measurement that motivated this gate: with the
  // four roots removed, the ten declarations #10015 fixed go uncovered here —
  // plus, since #10848, the one post-#10015 declaration none of those roots
  // ever covered (the retirement skill's SKILL.md, a `.claude/` literal) —
  // plus, since #10178, the two @objectstack/rest declarations it added: the
  // state-machine doc page, covered only through the `content/**` root #10015
  // added, and the automation skill file, covered only through its own
  // single-file `crosspkg` entry the way #10848's SKILL.md is. Plus, since
  // #12201, the one declaration under the `skills/**` root that card added
  // (the export-list corpus gate reads the published catalog from inside
  // @objectstack/spec). Plus, since #12924, the one repo-root declaration that
  // card added (the checked-in SDUI manifest artefact @objectstack/lint's
  // production-witness suite reads from the workspace root), covered only
  // through its own single-file `crosspkg` entry the way #10848's SKILL.md is.
  // Plus, since #14561, the one NEW root that card opened: @objectstack/rest's
  // meta-state doc-spelling test discovers its population instead of listing
  // it, so it declares the three authored-prose roots it reads, and `docs/**`
  // is the one of the three no earlier declaration had reached. Its two
  // siblings move nothing here -- `content/**` and `skills/**` were already
  // unique members of this set from #10015 and #12201.
  // Plus, since #14824, the three doc pages that card declared for
  // @objectstack/cli: `os create`'s emitted plugin shape is stated nowhere but
  // its documentation, so the pin holding the template to it reads all three
  // pages, each covered only through the `content/**` root #10015 added.
  // Plus, since #15818, the two doc pages THAT card declared for the same
  // package: the TypeScript floor both scaffolders emit was chosen because those
  // two pages already promise it, so the pin holding the emitted range to that
  // promise reads both -- and each is covered only through the same `content/**`
  // root, exactly like #14824's three.
  // Plus, since #18650, the one QA-checklist glob that card declared for
  // @objectstack/plugin-auth: its pin holds the platform checklist's statements
  // about the anonymous `/get-session` answer equal to that package's own
  // refusal envelope, so it reads `docs/qa/platform-checklist/areas/*.json`.
  // ⛔ It is NOT covered by the `docs/**` root #14561 opened -- coverage is
  // judged per DECLARED glob, and these are two declarations, so both sit in
  // this set separately. That card's OTHER new declaration,
  // `scripts/cross-package-test-inputs.mjs`, moves nothing here: the rollback
  // keeps `scripts/**`, which covers it. Measured, not inferred from the diff.
  // Ten plus one plus two plus one plus one plus one plus three plus two plus
  // one: the rollback now uncovers twenty-two. This pin is judged over the LIVE
  // declaration table on purpose: a declaration added under a root the rollback
  // keeps leaves the count alone, one under a new root moves it and is recorded
  // here by name.
  const preFix = judge(fixtureWorkflow({ core: real.filters?.core, crosspkg: ['scripts/**'] }), CROSS_PACKAGE_TEST_INPUTS);
  assert(
    new Set(uncoveredGlobs(preFix)).size === 22,
    `rolling \`crosspkg\` back to its pre-#10015 list uncovers the ten it fixed plus #10848's one plus #10178's two plus #12201's one plus #12924's one plus #14561's one plus #14824's three plus #15818's two plus #18650's one -- got ${new Set(uncoveredGlobs(preFix)).size}`,
  );
  assert(
    uncoveredGlobs(preFix).includes('skills/**'),
    `-- and #12201 added the published-catalog root the export-list corpus gate reads, by name`,
  );
  assert(
    uncoveredGlobs(preFix).includes('.claude/skills/spec-property-retirement/SKILL.md'),
    `-- and one post-#10015 member is #10848's declaration, by name`,
  );
  assert(
    uncoveredGlobs(preFix).includes('content/docs/protocol/objectql/state-machine.mdx'),
    `-- and #10178 added the meta-state route doc page, by name`,
  );
  assert(
    uncoveredGlobs(preFix).includes('skills/objectstack-automation/SKILL.md'),
    `-- and #10178 added the automation skill file, by name`,
  );
  assert(
    uncoveredGlobs(preFix).includes('sdui.manifest.json'),
    `-- and #12924 added the repo-root SDUI manifest artefact, by name`,
  );
  assert(
    uncoveredGlobs(preFix).includes('docs/**'),
    `-- and #14561 added the authored-prose root the discovered teaching-site population reads, by name`,
  );
  for (const page of [
    'content/docs/plugins/index.mdx',
    'content/docs/protocol/kernel/index.mdx',
    'content/docs/protocol/kernel/plugin-spec.mdx',
  ]) {
    assert(
      uncoveredGlobs(preFix).includes(page),
      `-- and #14824 added the \`os create plugin\` scaffold-listing page ${page}, by name`,
    );
  }
  for (const page of [
    'content/docs/deployment/troubleshooting.mdx',
    'content/docs/getting-started/index.mdx',
  ]) {
    assert(
      uncoveredGlobs(preFix).includes(page),
      `-- and #15818 added the TypeScript-floor page ${page}, by name`,
    );
  }
  assert(
    uncoveredGlobs(preFix).includes('docs/qa/platform-checklist/areas/*.json'),
    `-- and #18650 added the QA-checklist area glob its refusal-envelope pin reads, by name`,
  );

  // ── (7) WIRING: the gate and its self-test really run in CI ──────────────
  battery('(7) WIRING: the gate and its self-test really run in CI');
  const SELF = 'scripts/check-ci-filter-parity.mjs';
  let lint = null;
  try {
    lint = readFileSync(join(REPO_ROOT, '.github/workflows/lint.yml'), 'utf8');
  } catch (err) {
    failures.push(`cannot read .github/workflows/lint.yml to verify wiring: ${err?.code ?? err?.message}`);
  }
  if (lint !== null) {
    assert(lint.includes(`node ${SELF}\n`), `wiring: lint.yml invokes ${SELF} directly (lint.yml's GATE INVOCATION IDIOM note, not a package.json fence)`);
    assert(lint.includes(`node ${SELF} --self-test`), 'wiring: lint.yml runs the --self-test leg too');
  }

  // ── (8) the `console` selection and the dist key it must move (#20765) ───
  battery('(8) the `console` selection and the dist key it must move');
  const realSource = readFileSync(join(REPO_ROOT, CI_WORKFLOW), 'utf8');
  const realConsole = judgeConsole(realSource);
  const findingsOf = (v) =>
    ['mismatched', 'patterns', 'unselected', 'unclassified', 'staleGuards', 'hashedGuards'].flatMap((k) => v[k] ?? ['(no verdict)']);
  assert(!realConsole.refusal, `the checked-in ci.yml's console selection is readable -- ${realConsole.refusal ?? ''}`);
  assert(findingsOf(realConsole).length === 0, `the checked-in console filter and dist key are in step -- ${findingsOf(realConsole).join(', ')}`);
  // Triage's pins, over the real tree: the spec's entry layout selects the job
  // AND moves the key, so the head judges the change instead of replaying a dist
  // built before it; an ordinary spec source file does neither.
  for (const layout of ['packages/spec/package.json', 'packages/spec/tsup.config.ts']) {
    assert(
      consoleSelects(layout, realConsole.entries ?? []) === true && (realConsole.keyInputs ?? []).includes(layout),
      `a head touching only ${layout} selects Console Pin Gate and moves its dist key`,
    );
  }
  const control = 'packages/spec/src/ui/view.zod.ts';
  assert(
    existsSync(join(REPO_ROOT, control)) && consoleSelects(control, realConsole.entries ?? []) === false,
    `the control: a head touching only ${control} (a tracked spec source file) does NOT select Console Pin Gate`,
  );
  assert(
    !(realConsole.entries ?? []).some((e) => e.startsWith('packages/spec/src/')),
    'no console entry reaches into packages/spec/src -- the entry layout selects the job, the spec content does not',
  );

  // Synthetic trees. The default is clean, so every red below is the named drift.
  const guardEntries = Object.keys(CONSOLE_GUARDS);
  const keyOf = (paths) => `\${{ runner.os }}-console-dist-\${{ hashFiles(${paths.map((p) => `'${p}'`).join(', ')}) }}`;
  const consoleFixture = ({ entries, key, saveKey, envKey, condition, withSave = true } = {}) => {
    const k = key ?? keyOf(['.objectui-sha', 'scripts/build-console.sh']);
    const list = (xs) => xs.map((e) => `              - '${e}'`).join('\n');
    return [
      'name: CI',
      'jobs:',
      '  filter:',
      '    steps:',
      '      - uses: dorny/paths-filter@v4',
      '        id: changes',
      '        with:',
      '          filters: |',
      '            core:',
      list(['packages/**']),
      '            console:',
      list(entries ?? ['.objectui-sha', 'scripts/build-console.sh', ...guardEntries]),
      '  console-pin:',
      `    if: ${JSON.stringify(condition ?? "${{ !cancelled() && needs.filter.outputs.console != 'false' }}")}`,
      '    steps:',
      '      - uses: actions/cache/restore@v6',
      '        with:',
      '          path: packages/console/dist',
      `          key: ${k}`,
      '      - run: pnpm check:console-injection --require-stamp',
      '        env:',
      `          CONSOLE_DIST_CACHE_KEY: ${envKey ?? k}`,
      ...(withSave
        ? ['      - uses: actions/cache/save@v6', '        with:', '          path: packages/console/dist', `          key: ${saveKey ?? k}`]
        : []),
    ].join('\n');
  };
  const clean = judgeConsole(consoleFixture());
  assert(!clean.refusal && findingsOf(clean).length === 0, `positive control: the default synthetic tree is clean -- ${clean.refusal ?? findingsOf(clean).join(', ')}`);

  const specInFilterOnly = judgeConsole(
    consoleFixture({ entries: ['.objectui-sha', 'scripts/build-console.sh', 'packages/spec/package.json', ...guardEntries] }),
  );
  assert(
    (specInFilterOnly.unclassified ?? []).join(',') === 'packages/spec/package.json',
    'THE HOLE: a spec path the filter names but the key does not hash is reported -- the head would replay a pre-change dist',
  );
  const keyOnly = judgeConsole(consoleFixture({ key: keyOf(['.objectui-sha', 'scripts/build-console.sh', 'packages/spec/package.json']) }));
  assert(
    (keyOnly.unselected ?? []).join(',') === 'packages/spec/package.json',
    'the other hole: a path the key hashes but the filter does not name is reported -- its first build would be the queue\'s',
  );
  const subtree = judgeConsole(consoleFixture({ entries: ['.objectui-sha', 'scripts/build-console.sh', 'packages/spec/**', ...guardEntries] }));
  assert((subtree.patterns ?? []).join(',') === 'packages/spec/**', 'a pattern entry is reported -- the filter must not become all of spec');
  assert(consoleSelects('packages/spec/src/x.zod.ts', ['packages/spec/**']) === null, '-- and a pattern list is never read as a membership test');
  const splitKey = judgeConsole(consoleFixture({ saveKey: keyOf(['.objectui-sha']) }));
  assert(
    (splitKey.mismatched ?? []).length === 1 && /cache\/save/.test(splitKey.mismatched[0]),
    'a save step spelling a different key than the restore is reported, naming the save',
  );
  const staleGuard = judgeConsole(
    consoleFixture({ entries: ['.objectui-sha', 'scripts/build-console.sh', ...guardEntries.filter((g) => g !== CI_WORKFLOW)] }),
  );
  assert((staleGuard.staleGuards ?? []).join(',') === CI_WORKFLOW, 'a declared guard the filter no longer names is reported stale');
  const hashedGuard = judgeConsole(consoleFixture({ key: keyOf(['.objectui-sha', 'scripts/build-console.sh', CI_WORKFLOW]) }));
  assert((hashedGuard.hashedGuards ?? []).join(',') === CI_WORKFLOW, 'a declared guard the key also hashes is reported');

  assert(
    /declares no \`console:\` filter/.test(judgeConsole(consoleFixture().replace(/            console:\n(              - '[^']*'\n?)+/, '')).refusal ?? ''),
    'a filters input with no `console:` list => REFUSAL, not a clean zero',
  );
  assert(
    /no longer names \`console\`/.test(judgeConsole(consoleFixture({ condition: "${{ !cancelled() }}" })).refusal ?? ''),
    'the console job dropping the filter from its `if:` => REFUSAL',
  );
  assert(/exactly one of each/.test(judgeConsole(consoleFixture({ withSave: false })).refusal ?? ''), 'a job with no save step => REFUSAL');
  assert(
    hashFilesInputs("${{ runner.os }}-x-${{ hashFiles(env.PATHS) }}") === null &&
      /quoted paths/.test(judgeConsole(consoleFixture({ key: "${{ runner.os }}-console-dist-${{ hashFiles(env.PATHS) }}" })).refusal ?? ''),
    'a key whose hashFiles arguments are not quoted paths => REFUSAL: the gate cannot say what it hashes',
  );

  // A scratch root carrying the given ci.yml beside the REAL turbo.json and
  // root manifest, so the only drift `main()` can see is the one injected: a
  // root missing either file would red the build-input subject on its own and
  // satisfy a "returns 1" assertion for the wrong reason.
  const inScratchTree = (ciSource, fn) => {
    const scratch = mkdtempSync(join(tmpdir(), 'ci-filter-parity-'));
    try {
      mkdirSync(join(scratch, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(scratch, CI_WORKFLOW), ciSource);
      for (const rel of [TURBO_CONFIG, ROOT_MANIFEST]) writeFileSync(join(scratch, rel), readFileSync(join(REPO_ROOT, rel), 'utf8'));
      return fn(scratch);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };

  // The report path, over the real ci.yml with one drift injected: the spec's
  // tsup entry list dropped from the filter while the key still hashes it.
  const drifted = realSource.replace("              - 'packages/spec/tsup.config.ts'\n", '');
  assert(drifted !== realSource, 'the report-path fixture found its anchor in the checked-in ci.yml');
  assert(
    inScratchTree(drifted, (root) => quietly(() => main(root))) === 1,
    'main() returns 1 over a ci.yml whose console filter lost a hashed path -- the report path, not only `judgeConsole`',
  );

  // ── (9) Build Core and the build inputs turbo.json declares (#21202) ────
  battery('(9) Build Core and the build inputs turbo.json declares');
  const BUILD_IF = "${{ !cancelled() && needs.filter.outputs.core != 'false' }}";
  const buildWorkflow = ({ core, condition = BUILD_IF, run = 'pnpm build' } = {}) => {
    const list = (xs) => xs.map((e) => `              - '${e}'`).join('\n');
    return [
      'name: CI',
      'jobs:',
      '  filter:',
      '    steps:',
      '      - uses: dorny/paths-filter@v4',
      '        id: changes',
      '        with:',
      '          filters: |',
      '            core:',
      list(core ?? ['packages/**', 'tsconfig.json', 'turbo.json', 'tsup.config.ts', 'scripts/a.mjs', 'scripts/b.mjs']),
      '  build-core:',
      `    if: ${JSON.stringify(condition)}`,
      '    steps:',
      `      - run: ${run}`,
    ].join('\n');
  };
  const turboFixture = ({ globalDependencies = ['tsconfig.json', 'tsup.config.ts'], tasks } = {}) =>
    JSON.stringify({
      globalDependencies,
      tasks: tasks ?? {
        build: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/scripts/a.mjs'] },
        '@objectstack/probe#build': {
          inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/scripts/a.mjs', '$TURBO_ROOT$/scripts/b.mjs', '$TURBO_ROOT$/packages/cli/src/x.ts'],
        },
        '@objectstack/docs#build': { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/content/**'] },
        test: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/docker/**'] },
      },
    });
  const manifestFixture = (build = 'turbo run build --filter=!@objectstack/docs') => JSON.stringify({ scripts: { build } });
  const judgeBuild = ({ workflow, turbo, manifest } = {}) =>
    judgeBuildInputs(workflow ?? buildWorkflow(), turbo === undefined ? turboFixture() : turbo, manifest === undefined ? manifestFixture() : manifest);
  const uncoveredPaths = (v) => (v.uncovered ?? []).map((r) => r.path);
  const findingsOfBuild = (v) => [...(v.uncovered ?? ['(no verdict)']).map((r) => r.path ?? r), ...(v.stale ?? ['(no verdict)'])];

  const buildClean = judgeBuild();
  assert(!buildClean.refusal && findingsOfBuild(buildClean).length === 0, `positive control: the default synthetic tree is clean -- ${buildClean.refusal ?? findingsOfBuild(buildClean).join(', ')}`);
  assert(
    buildClean.covered?.find((r) => r.path === 'packages/cli/src/x.ts')?.via === 'packages/**',
    '-- a root input under a package root is covered by that subtree entry, with no literal of its own',
  );
  assert(
    !(buildClean.inputs ?? []).some((r) => r.path === 'docker/**'),
    '-- a TEST task\'s root input is not a build input: `crosspkg` is that population\'s scheduler, not `core`',
  );
  assert(
    (buildClean.excludedTasks ?? []).join(',') === '@objectstack/docs#build' && !(buildClean.inputs ?? []).some((r) => r.path === 'content/**'),
    '-- a build the root `build` script excludes is left out, and its root input with it',
  );

  // THE HOLE, the one the card reads: a build input `core:` does not cover.
  const droppedInput = judgeBuild({ workflow: buildWorkflow({ core: ['packages/**', 'tsconfig.json', 'turbo.json', 'tsup.config.ts', 'scripts/a.mjs'] }) });
  assert(uncoveredPaths(droppedInput).join(',') === 'scripts/b.mjs', 'THE HOLE: a build input dropped from `core:` is reported uncovered, by path');
  assert(
    (droppedInput.uncovered?.[0]?.from ?? []).join(',') === '@objectstack/probe#build',
    '-- naming the build task that declared it',
  );
  const droppedTurbo = judgeBuild({ workflow: buildWorkflow({ core: ['packages/**', 'tsconfig.json', 'tsup.config.ts', 'scripts/a.mjs', 'scripts/b.mjs'] }) });
  assert(uncoveredPaths(droppedTurbo).join(',') === 'turbo.json', 'turbo.json itself missing from `core:` is reported -- it moves every task hash');
  const droppedGlobal = judgeBuild({ workflow: buildWorkflow({ core: ['packages/**', 'tsconfig.json', 'turbo.json', 'scripts/a.mjs', 'scripts/b.mjs'] }) });
  assert(uncoveredPaths(droppedGlobal).join(',') === 'tsup.config.ts', 'a `globalDependencies` entry missing from `core:` is reported -- the set is derived, not listed here');
  const newInput = judgeBuild({
    turbo: turboFixture({
      tasks: { build: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/scripts/a.mjs', '$TURBO_ROOT$/scripts/b.mjs', '$TURBO_ROOT$/tools/gen.mjs'] } },
    }),
  });
  assert(uncoveredPaths(newInput).join(',') === 'tools/gen.mjs', 'a build input turbo.json gains under a NEW root reds until `core:` covers it');
  const negated = judgeBuild({
    turbo: turboFixture({ tasks: { build: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/scripts/a.mjs', '$TURBO_ROOT$/scripts/b.mjs', '!$TURBO_ROOT$/scripts/c.mjs'] } } }),
  });
  assert(uncoveredPaths(negated).length === 0, 'a NEGATED root input is not required -- a negation can only narrow a hash');
  const docsBuilt = judgeBuild({ manifest: manifestFixture('turbo run build') });
  assert(
    uncoveredPaths(docsBuilt).join(',') === 'content/**',
    'the root `build` script no longer excluding a package puts that build\'s root inputs back in the required set -- the exclusion is read, not declared',
  );
  const staleEntry = judgeBuild({
    workflow: buildWorkflow({
      core: ['packages/**', 'package.json', CI_WORKFLOW, 'tsconfig.json', 'turbo.json', 'tsup.config.ts', 'scripts/a.mjs', 'scripts/b.mjs', 'scripts/old.mjs'],
    }),
  });
  assert((staleEntry.stale ?? []).join(',') === 'scripts/old.mjs', 'a literal `core:` entry beside declared build inputs, covering none of them, is reported stale');
  assert(
    (staleEntry.stale ?? ['(no verdict)']).length === 1,
    '-- while a root-level file, a pattern entry and a literal in a directory holding no declared build input are not judged',
  );
  assert(buildExclusions('turbo run build --filter !@objectstack/docs').excluded?.has('@objectstack/docs'), 'the spaced `--filter !<pkg>` spelling is read as an exclusion too');

  // Refusals: never a clean zero over a subject that was not read.
  const buildRefusal = (opts) => judgeBuild(opts).refusal ?? '';
  assert(/no \`build-core\` job/.test(judgeBuildInputs(fixtureWorkflow(), turboFixture(), manifestFixture()).refusal ?? ''), 'no Build Core job => REFUSAL');
  assert(/no longer names \`core\`/.test(buildRefusal({ workflow: buildWorkflow({ condition: '${{ !cancelled() }}' }) })), 'Build Core dropping `core` from its `if:` => REFUSAL');
  assert(/no \`run: pnpm build\` step/.test(buildRefusal({ workflow: buildWorkflow({ run: 'pnpm turbo run build' }) })), 'Build Core no longer running `pnpm build` => REFUSAL');
  assert(/turbo.json could not be read\./.test(buildRefusal({ turbo: null })), 'an unreadable turbo.json => REFUSAL');
  assert(/could not be read as JSON/.test(buildRefusal({ turbo: '{ tasks: ' })), 'a turbo.json that is not JSON => REFUSAL');
  assert(/no \`tasks\` map/.test(buildRefusal({ turbo: '{}' })), 'a turbo.json with no tasks map => REFUSAL');
  assert(/no \`build\` task/.test(buildRefusal({ turbo: turboFixture({ tasks: { test: { inputs: [] } } }) })), 'a turbo.json with no build task => REFUSAL');
  assert(/package.json could not be read\./.test(buildRefusal({ manifest: null })), 'an unreadable root manifest => REFUSAL');
  assert(/not \`turbo run build/.test(buildRefusal({ manifest: JSON.stringify({ scripts: {} }) })), 'a root manifest with no `build` script => REFUSAL');
  assert(/not \`turbo run build/.test(buildRefusal({ manifest: manifestFixture('tsup') })), 'a root `build` script that is not `turbo run build` => REFUSAL');

  // The real tree.
  const realBuild = judgeBuildInputs(realSource, readFileSync(join(REPO_ROOT, TURBO_CONFIG), 'utf8'), readFileSync(join(REPO_ROOT, ROOT_MANIFEST), 'utf8'));
  assert(!realBuild.refusal && findingsOfBuild(realBuild).length === 0, `the checked-in core filter covers every build input turbo.json declares -- ${realBuild.refusal ?? findingsOfBuild(realBuild).join(', ')}`);
  for (const path of [TURBO_CONFIG, 'tsup.config.ts', 'scripts/tsup-drop-sources-content.mjs']) {
    assert(
      (realBuild.covered ?? []).some((r) => r.path === path && r.kind === 'literal'),
      `a head touching only ${path} schedules Build Core, through its own literal \`core\` entry`,
    );
  }
  const notABuildInput = 'scripts/check-ci-filter-parity.mjs';
  assert(
    existsSync(join(REPO_ROOT, notABuildInput)) &&
      !(realBuild.inputs ?? []).some((r) => r.path === notABuildInput) &&
      !coverageVerdict(notABuildInput, realBuild.entries ?? []).covered,
    `the control: ${notABuildInput}, a tracked script no build declares, does NOT schedule Build Core -- \`core\` names files, not \`scripts/**\``,
  );
  const droppedReal = realSource.replace("              - 'scripts/invoked-as.mjs'\n", '');
  assert(droppedReal !== realSource, 'the real-tree drop found its anchor in the checked-in ci.yml');
  assert(
    uncoveredPaths(judgeBuildInputs(droppedReal, readFileSync(join(REPO_ROOT, TURBO_CONFIG), 'utf8'), readFileSync(join(REPO_ROOT, ROOT_MANIFEST), 'utf8'))).join(',') ===
      'scripts/invoked-as.mjs',
    'the checked-in ci.yml with one build input dropped from `core:` reports exactly that input',
  );
  assert(inScratchTree(realSource, (root) => quietly(() => main(root))) === 0, 'main() returns 0 over the scratch copy of the real tree -- the scratch root is complete');
  assert(inScratchTree(droppedReal, (root) => quietly(() => main(root))) === 1, '-- and 1 with that one build input dropped: the report path, not only `judgeBuildInputs`');

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ───
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => {
    failures.push(message);
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (an early return, a deleted block, a guard that now ' +
        'skips) and restore it.',
    );
  }

  if (failures.length > 0) {
    console.error(`✗ check-ci-filter-parity --self-test — ${failures.length} of ${checked} assertion(s) failed\n`);
    for (const f of failures) console.error(`  • ${f}`);
    return 1;
  }
  console.log(
    `✓ check-ci-filter-parity --self-test: ${checked} assertions — both coverage limbs and the extglob bound, the ` +
      `same-root-different-file case observed failing and then covered by naming the file, a glob covered by ` +
      `\`core\`, one covered only by \`crosspkg\` and one covered by neither judged separately in one table, the ` +
      `stale-entry direction, seven refusals over subjects that could not be read, the checked-in ci.yml, the ` +
      `pre-#10015 rollback uncovering the ten it fixed plus #10848's one plus #10178's two plus #12201's one plus #12924's one plus #14561's one plus #14824's three plus #15818's two plus #18650's one, ` +
      `the CI wiring read out of lint.yml, and the \`console\` selection: the spec's entry layout selecting Console Pin ` +
      `Gate and moving its dist key while a spec source file does neither, each way the filter and the key can drift ` +
      `observed red, and the report path red over the checked-in ci.yml with one hashed path dropped from the filter; ` +
      `and Build Core's build inputs: a build input dropped from \`core\` observed red by path and declaring task, ` +
      `turbo.json itself, a globalDependencies entry and a new-root input each required, test-task and negated inputs ` +
      `and the excluded docs build left out until the build script stops excluding it, a leftover literal entry, ` +
      `ten refusals, and the checked-in tree green with one input dropped observed red through the report path.`,
  );
  selfTestReachedVerdict = true;
  return 0;
}

// The CLI dispatch is guarded so that IMPORTING this module is inert: the
// judging functions are exported so another workflow source can be judged, and
// a module that ran its gate on import would print a verdict about this repo
// into an importer's stdout and hand it this gate's exit status
// (`check:entry-guard`; the sibling gate's header records what that cost).
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const selfTestCode = await selfTest();
      if (!selfTestReachedVerdict) {
        console.error(
          '\n✗ check-ci-filter-parity self-test: selfTest() returned without reaching its verdict,\n'
            + 'so no success line was printed. Exiting 0 here would report a self-test\n'
            + 'that never finished as a self-test that passed.\n',
        );
        process.exit(1);
      }
      process.exit(selfTestCode);
  }
  if (process.argv.includes('--list')) process.exit(list());
  process.exit(main());
}
