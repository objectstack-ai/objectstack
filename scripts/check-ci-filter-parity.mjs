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
 * ## The second subject, retired: the `console` selection and its dist key (#20765)
 *
 * This gate also held the `console:` filter list in step with the dist-cache key
 * of the `console-pin` job (Console Pin Gate). Both left ci.yml with the objectui
 * pin (#25697): the Console is a workspace under `ui/`, built in the same tree as
 * the spec, so there is no vendored dist to key and no second list to hold.
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
 * expands to (followed, at most, by the closed BUILD_COMMAND_FLAGS list:
 * reporting flags that change no task, #25374). Every misreading of that script can only drop an exclusion,
 * which REQUIRES more of `core` -- a loud red, never a silent gap. The only
 * constant is turbo.json itself, which is the config being read.
 *
 * Findings: a declared build input no `core` entry covers (same pure-string
 * rule as above), and the reverse direction where the declarations alone can
 * decide it: a literal `core` entry in a directory that holds a declared
 * literal build input, covering none of them, is a leftover from an input
 * turbo.json dropped, and it starts the core pipeline on a diff no build reads
 * (since #21341 a row covering one of Build Core's guards, the population the
 * next section adds, is not a leftover either).
 * Root-level files and pattern entries are not judged that way -- nothing here
 * says why `package.json` or `packages/**` is in `core`. Refusals: no `build-core` job, its `if:` no longer naming
 * `core`, no `run: pnpm build` step, turbo.json or the root manifest unreadable
 * or not JSON, no `tasks` map, no build task, and a `build` script that is not
 * `turbo run build ...`.
 *
 * Known bounds: a package-level turbo.json (none is tracked today) would add
 * build inputs this subject does not read; and a leftover in a directory where
 * turbo.json no longer declares ANY build input, and no Build Core step runs
 * any script, is not reported (the cheap direction: it over-schedules, it
 * never under-schedules).
 *
 * ## The same subject's second population: the scripts Build Core's steps run (#21341)
 *
 * Build Core does more than build. Its own steps run guards that need a real
 * `dist/` (`pnpm check:dts-closure`, `check:dual-build-cjs-loads`,
 * `check:sourcemap-no-sources-content`, `check:lean-entry-closure`, each a
 * `--self-test` and a real leg), and Build Core is the only job that runs
 * them. A diff confined to one of those scripts moved no build hash and
 * matched no `core` entry, so Build Core skipped and the changed guard ran
 * nowhere before the merge queue: PR #17100 changed only
 * `scripts/check-lean-entry-closure.mjs`, and its Build Core concluded
 * `skipped`. `core:` had no rows applying "a change to the guard runs the
 * guard" to its job, as the retired `console:` list did for its own.
 *
 * This population is DERIVED from the job, the way the build inputs are
 * derived from turbo.json, so no list of guards is kept here: every `run:`
 * step of the `build-core` job is read through `collectInvocations`, the
 * recognizer `check-self-test-wired.mjs` uses for "which repository scripts
 * does this CI command run" (a `scripts/...` path named directly, or reached
 * through a root `package.json` alias chain), and each script it names brings
 * its first-party import closure from `first-party-closure.mjs`, the one
 * answer to which modules a script executes. Each resulting path must be
 * covered by `core`, and it widens the leftover rule above: a literal entry
 * beside the build inputs and the guards that covers neither is reported. So a
 * guard step added to Build Core without a filter row reds, and a filter row
 * left behind by a deleted guard step reds too. The ONE list is the rows in
 * ci.yml; there is no second copy here to fall out of step with it.
 *
 * Known bounds, each the recognizer's and stated rather than guessed at: a
 * script a PACKAGE's own manifest runs (`pnpm --filter <pkg> <script>`) is
 * not followed (today's one such step, the spec's `analyze`, runs a file
 * inside `packages/spec`, which `packages/**` covers); a local composite
 * action a step `uses:` is not followed (today's one is setup-workspace: its
 * own `run:` steps name no repository script, and neither do those of the
 * setup-pnpm it calls in turn; its files and the `.nvmrc` and root
 * `packageManager` it reads are `core:` rows of their own, #27673); `pnpm
 * install`'s lifecycle (`prepare` -> `scripts/setup-git-hooks.mjs`) is not a
 * guard (every job installs, the unfiltered lint.yml jobs included, so a
 * change to it already runs at PR time); a script spelled in an extension
 * the recognizer does not read (`.cjs`, `.ts`) is not seen, exactly as
 * `check:self-test-wired` does not see it; and a DATA file a guard reads (a
 * baseline) is not a script and is not derived. The self-test pins the first
 * two against the real tree.
 *
 * ## The fourth subject: Test Core and the generic test tasks' root inputs (#27961)
 *
 * turbo.json's generic `test` and `test:repo` tasks -- the two Test Core's
 * `turbo run test test:repo` names -- run for every package Test Core tests,
 * so each `$TURBO_ROOT$/...` input of theirs moves every package's test hash.
 * Before this subject nothing held them to the scheduler: `vitest.preset.mts`
 * sat in `core:` by hand, and five ui-tree inputs (`ui/vitest.config.mts`,
 * `ui/vitest.setup.*`, `ui/scripts/test-shard-*` and the Console's two Vite
 * configs) matched no list the `test` job's `if:` reads, so a diff confined to
 * one started Test Core first in the merge queue.
 *
 * `judgeTestInputs` derives the population from turbo.json and judges it with
 * the same pure-string rule against the lists the `test` job ORs, read back
 * out of its `if:` exactly as the first subject reads them. The remedy is a
 * `core:` row, never `crosspkg:`: the first subject holds `crosspkg` to the
 * declarations, and a generic test input is no package's declaration.
 *
 * The population is also a REASON for the third subject's leftover rule. A
 * literal `core:` row in a directory holding a build input is there for a test
 * input just as legitimately: without it, `ui/vitest.config.mts` (beside the
 * build input `ui/tsconfig.json`) read as a leftover the moment it was added.
 *
 * Known bounds: a `<package>#test` task's root inputs are the first subject's
 * population (the declarations `--verify` mirrors into turbo.json) and are not
 * judged a second time here; `globalDependencies` are the third subject's, and
 * `core` covering them starts Test Core too. Refusals: the first subject's
 * reads of ci.yml and the `test` job's `if:`, turbo.json unreadable or not
 * JSON, no `tasks` map, and no generic `test` task. The self-test pins the task
 * pair against the real job's command.
 *
 * ## The fifth subject: Test UI and the files outside ui/ that ui tests read (#37935, #38133)
 *
 * `studioMenuPlacement.test.ts` (Test UI) holds ADR-0084's type-to-group table
 * equal to the Studio menu code, and it reads the ADR from the ROOT
 * `docs/adr/`, outside `ui/`. The `ui:` list named no such file, so a diff
 * confined to the ADR started no ui job on the PR, nor in the merge queue,
 * where the `ui` output reads the queue diff through the same list: the pin
 * first ran on the next ui PR, red on a change that PR did not make. The same
 * holds for every file outside `ui/` a ui test reads -- a root document, a
 * server source whose shape a ui test pins, a root script a ui test imports --
 * so the population is all of them, not the one root that showed it first.
 *
 * `uiRootReadsOf` DERIVES the population from the ui tests themselves: every
 * tracked `ui/**` test file is read by `scanPathExpressions`, the walker
 * `check:cross-package-test-inputs` and the ui test selector already use, and
 * an import is resolved by that gate's own `resolveImportTarget`, so this is
 * not a recognizer of its own and holds no list. Each read must be covered, by
 * the same pure-string rule, by a list the `test-ui` job's `if:` ORs (read
 * back out of it; `ui` must be among them), or be DECLARED a trade-off.
 *
 * Both answers live in one place in ci.yml, the reads group at the end of the
 * `ui:` list: every row below its UI_READS_GROUP_MARKER heading is a file a ui
 * test reads, named verbatim, and a `# ui-read trade-off: PATH -- REASON` line
 * there is a read left unscheduled on purpose, with the reason that names what
 * runs it instead. The remedy is the file verbatim, never a subtree, which
 * would start the ui battery on every edit beside the one file a test reads.
 * The other direction is judged in the group alone: a row below the heading no
 * ui test reads is a leftover, and a trade-off for a read no test makes, or
 * for one a row now covers, is stale. Rows above the heading are the ui jobs'
 * own build and gate inputs, which no test read accounts for, and the sixth
 * subject pins them instead. The group is read from the `filters:` TEXT
 * because YAML drops the comments that carry it; a missing or doubled heading
 * and an unreadable trade-off line are refusals.
 *
 * Known bounds: a ui test whose read the walker cannot resolve (an unread
 * argument, a manifest-name `findUp`, which is judged with no package name) is
 * not in the population, exactly as the walker's other callers do not see it.
 * The walker reads each test file's own text, so a read made inside a module
 * the test IMPORTS is not seen either: a reads-group row whose only reader is
 * such a helper is reported as reader-less, and the leftover direction
 * therefore says check, then delete, never delete.
 *
 * ## The sixth subject: the ui scheduling pin (#38132)
 *
 * The fifth subject holds the reads group to the reads, and nothing else in
 * this gate read the rest of what decides whether a ui job starts: the other
 * inputs of the paths-filter step (`predicate-quantifier`, `base`, `ref` and
 * the rest each change which diff is read or how a row matches it), the
 * `filter` job's output expressions the ui jobs read, the rows above the
 * reads group, and every ui job's own `if:`. An edit to any of them could make
 * a ui job skip on a diff where it ran before, and the gate stayed green.
 *
 * `judgeUiScheduling` holds the real ci.yml to UI_PIN_FILE, the least it may
 * schedule the ui jobs. The step's `with:` keys and the pinned outputs are
 * held EXACTLY, since neither has a direction this gate can read. The rows the
 * pin lists for each filter are a FLOOR: a pinned row gone reds, a row added
 * is free. Every job whose definition reads a ui output (UI_OUTPUT_NAMES) must
 * carry a pinned condition, and each condition is a FLOOR too: the job's `if:`
 * is read as clauses of a conjunction, each the set of its disjuncts
 * (`conditionClauses`), and must be implied clause by clause by its pin
 * (`conditionAtLeast`): dropping a clause or adding a disjunct passes, adding
 * a clause, dropping a disjunct or rewriting an atom reds, naming the clause.
 * The comparison is syntactic, so a rewrite that is in fact wider reds too,
 * which is the safe direction; a condition wider than its pin is reported in
 * the OK line, and raising the pin is how the wider schedule is then held. A
 * deliberate change updates the pin in the same PR, so the change to what runs
 * is read where it is made. The pin is a JSON record beside this script, not a
 * table in it, so no path literal here is read as this gate's population.
 *
 * Known bounds: the rows of `core`, which only `live-e2e-ui` ORs in, are not
 * floored here (the first, third and fourth subjects hold them); a narrowing
 * through another job's output a ui `if:` reads (`borrowed-verdict`,
 * `queue-verdict`, `test-ui-plan`), through `needs:`, or through a step-level
 * `if:` inside a ui job is not judged; and the `ui-tree` step's own script is
 * not read. Refusals: the pin file absent, not JSON, or missing any of its
 * four parts or a ui output, and every refusal of the filter reader.
 *
 * ## Wiring
 *
 * Invoked from `.github/workflows/lint.yml` through its root alias, which runs
 * both legs: see the GATE INVOCATION IDIOM note at the top of that file, which
 * states the rule once. The self-test asserts that wiring against the workflow
 * text and the alias value -- a gate that exists and is not scheduled is the
 * same dormant shape from the other side.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { requireDependency } from './import-prerequisite.mjs';
const { parse } = await requireDependency('yaml', () => import('yaml'), import.meta.url);

import { collectInvocations } from './check-self-test-wired.mjs';
import { resolveImportTarget, scanPathExpressions } from './check-cross-package-test-inputs.mjs';
import { CROSS_PACKAGE_TEST_INPUTS } from './cross-package-test-inputs.mjs';
import { firstPartyModuleClosure } from './first-party-closure.mjs';
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
  // (8), the `console` selection and its dist key, retired with its subject
  // (see the header); the numbers below keep their names.
  '(9) Build Core and the build inputs turbo.json declares': 42,
  '(10) Build Core and the scripts its own steps run': 30,
  '(11) Test Core and the generic test tasks\' root inputs': 18,
  '(12) Test UI and the files outside ui/ that ui tests read': 33,
  '(13) the ui scheduling pin: the paths-filter input, the ui outputs, the ui rows and every ui job condition': 30,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 12;

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
  return { jobs, filters, raw, step: pathsFilterSteps[0] };
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
/**
 * The CLOSED list of words that may follow BUILD_COMMAND in that step. Each
 * changes what turbo REPORTS, never which tasks it runs or how they hash
 * (measured: 83 of 83 hashes identical with and without, `--dry=json`, turbo
 * 2.11.5), and the remote-cache assertion after the step reads both
 * (#25374). ⛔ No pattern over "any flag": a `--filter` or `--affected` here
 * changes the task set the manifest's script says, and must refuse.
 */
const BUILD_COMMAND_FLAGS = Object.freeze([/^--summarize$/, /^--log-file=\S+$/]);

/** Whether a `run:` is BUILD_COMMAND followed only by BUILD_COMMAND_FLAGS. */
export function isBuildCommand(run) {
  if (typeof run !== 'string') return false;
  const words = run.trim().split(/\s+/);
  if (words.slice(0, 2).join(' ') !== BUILD_COMMAND) return false;
  return words.slice(2).every((w) => BUILD_COMMAND_FLAGS.some((re) => re.test(w)));
}
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

/** The first-party closure of a script in the checked-in tree. */
const closureIn = (root) => (rel) => firstPartyModuleClosure(rel, { root });

/**
 * Every repository script Build Core's own steps run (#21341): each script a
 * `run:` step names, directly or through a root `package.json` alias chain
 * (`collectInvocations`, the recognizer `check:self-test-wired` reads CI
 * with), plus each one's first-party import closure (`closureOf`). Returns the
 * rows, each with where it came from: the step that runs it, or the script
 * that imports it. `{ refusal }` when a closure cannot be computed -- a step
 * naming a script that does not resolve is a subject this gate did not read.
 */
export function buildGuardsOf(steps, pkgScripts, closureOf) {
  const byPath = new Map();
  const add = (path, from) => byPath.set(path, [...new Set([...(byPath.get(path) ?? []), from])]);
  for (const [index, step] of (Array.isArray(steps) ? steps : []).entries()) {
    if (typeof step?.run !== 'string') continue;
    const label = typeof step.name === 'string' ? step.name : `step ${index + 1}`;
    const { named } = collectInvocations([{ name: label, text: step.run }], pkgScripts ?? {});
    for (const [script, where] of named) {
      let closure;
      try {
        closure = closureOf(script);
      } catch (err) {
        return {
          refusal:
            `${CI_WORKFLOW}'s \`${BUILD_JOB}\` step "${label}" runs ${script}, whose first-party closure could not be ` +
            `computed: ${String(err?.message ?? err).split('\n')[0]}`,
        };
      }
      for (const member of closure) {
        if (member === script) for (const w of where) add(member, w);
        else add(member, `imported by ${script}`);
      }
    }
  }
  return { rows: [...byPath].map(([path, from]) => ({ path, from })) };
}

/**
 * The verdict on Build Core's scheduling against the build inputs turbo.json
 * declares and the scripts the job's own steps run. Takes the three SOURCE
 * STRINGS (null for one that could not be read) and the closure reader, so
 * the self-test can drive every failure. `{ refusal }` for every state in
 * which the subject was not read; otherwise the findings, each list empty on a
 * clean tree.
 */
export function judgeBuildInputs(source, turboSource, manifestSource, closureOf = closureIn(REPO_ROOT)) {
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
  if (!steps.some((s) => isBuildCommand(s?.run))) {
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

  const guards = buildGuardsOf(steps, manifest?.scripts, closureOf);
  if (guards.refusal) return guards;

  const split = (rows) => {
    const covered = [];
    const uncovered = [];
    for (const row of rows) {
      const verdict = coverageVerdict(row.path, entries);
      (verdict.covered ? covered : uncovered).push({ ...row, ...verdict });
    }
    return { covered, uncovered };
  };
  const { covered, uncovered } = split(declared.rows);
  const { covered: guardsCovered, uncovered: guardsUncovered } = split(guards.rows);
  // The reverse direction, judged only where it is decidable from the
  // populations alone: a LITERAL entry in a directory that holds a declared
  // literal build input or a guard is there for the same reason those are, so
  // one that covers none of them is a leftover -- of an input turbo.json
  // dropped, or of a guard step Build Core dropped. A generic test task's root
  // input is a reason too (the fourth subject, #27961); a turbo.json without
  // one only shrinks the reasons, which reports more, never less. Root-level
  // files and pattern entries are not this subject's to judge -- nothing here
  // says why they are in `core`.
  const reasons = [...declared.rows, ...guards.rows, ...(testInputsOf(turbo).rows ?? [])];
  const reasonDirs = new Set(reasons.filter(({ path }) => !WILDCARD.test(path)).map(({ path }) => dirOf(path)).filter(Boolean));
  const stale = entries.filter(
    (entry) =>
      !WILDCARD.test(entry) &&
      reasonDirs.has(dirOf(entry)) &&
      !reasons.some(({ path }) => coverageVerdict(path, [entry]).covered),
  );

  return {
    entries,
    condition,
    inputs: declared.rows,
    covered,
    uncovered,
    guards: guards.rows,
    guardsCovered,
    guardsUncovered,
    stale,
    excludedTasks: declared.excludedTasks,
  };
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
  if (verdict.guardsUncovered.length > 0) {
    problems.push(
      `${verdict.guardsUncovered.length} script(s) the \`${BUILD_JOB}\` job's own steps run are covered by no ` +
        `\`${BUILD_FILTER}:\` entry in ${CI_WORKFLOW}. Build Core is the only job that runs them, so a diff confined to one\n` +
        `    starts no Build Core and the changed script runs nowhere before the merge queue:\n` +
        verdict.guardsUncovered.map((r) => `      ${r.path}   (${r.from.join('; ')})`).join('\n') +
        `\n    Add each one VERBATIM to the guard rows of the \`${BUILD_FILTER}:\` filter in ${CI_WORKFLOW} -- a change to\n` +
        '    the guard runs the guard. Not the subtree it sits in, for the reason the build inputs give.',
    );
  }
  if (verdict.stale.length > 0) {
    problems.push(
      `${CI_WORKFLOW}'s \`${BUILD_FILTER}:\` filter carries literal entr(ies) beside the build inputs and Build Core's ` +
        `guards that cover none of them, nor any generic test task's root input -- left over from an input ` +
        `${TURBO_CONFIG} no longer declares, or from a script no \`${BUILD_JOB}\` step runs any more:\n` +
        verdict.stale.map((e) => `      ${e}`).join('\n') +
        `\n    Delete them. Each one starts the whole core pipeline on a diff that no build, no test task and no ` +
        'Build Core step reads.',
    );
  }
  if (problems.length > 0) {
    console.error(
      `FAIL: ci.yml's \`${BUILD_FILTER}\` filter is out of step with the build inputs ${TURBO_CONFIG} declares and ` +
        `the scripts Build Core's steps run.\n`,
    );
    for (const p of problems) console.error(`  - ${p}\n`);
    return 1;
  }
  const fromGlobal = verdict.inputs.filter((r) => r.from.includes('globalDependencies')).length;
  const imported = verdict.guards.filter((r) => r.from.every((f) => f.startsWith('imported by '))).length;
  console.log(
    `OK: all ${verdict.inputs.length} build input(s) ${TURBO_CONFIG} declares outside the packages (itself, ` +
      `${fromGlobal} globalDependencies, and every \`$TURBO_ROOT$\` input of a build Build Core runs) and all ` +
      `${verdict.guards.length} script(s) the \`${BUILD_JOB}\` job's own steps run (${verdict.guards.length - imported} ` +
      `named by a step, ${imported} only imported by one) are covered by \`${BUILD_FILTER}\`, which the ` +
      `\`${BUILD_JOB}\` job's \`if:\` reads; no literal \`${BUILD_FILTER}\` entry beside them is a leftover. Left out ` +
      `because \`${BUILD_COMMAND}\` excludes their package: ` +
      `${verdict.excludedTasks.length > 0 ? verdict.excludedTasks.join(', ') : 'none'}.`,
  );
  return 0;
}

// ── The fourth subject: Test Core and the generic test tasks' root inputs (#27961) ──

/**
 * The generic turbo tasks Test Core runs for every package it tests: the step's
 * `turbo run test test:repo`. The self-test pins this pair against the real job.
 */
export const TEST_TASKS = Object.freeze(['test', 'test:repo']);
/** Where an uncovered generic test input belongs -- see the header for why not `crosspkg`. */
export const TEST_REMEDY_FILTER = 'core';

/**
 * Every repo-root-relative `$TURBO_ROOT$/...` input of a TEST_TASKS task, each
 * with the task that names it, or `{ refusal }`. Negated inputs are skipped, as
 * for the build inputs: a negation can only narrow a hash.
 */
export function testInputsOf(turbo) {
  const tasks = turbo?.tasks;
  if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) {
    return { refusal: `${TURBO_CONFIG} declares no \`tasks\` map.` };
  }
  if (!tasks[TEST_TASKS[0]]) {
    return { refusal: `${TURBO_CONFIG} declares no generic \`${TEST_TASKS[0]}\` task -- the test task Test Core runs has moved.` };
  }
  const byPath = new Map();
  for (const task of TEST_TASKS) {
    const inputs = Array.isArray(tasks[task]?.inputs) ? tasks[task].inputs : [];
    for (const input of inputs) {
      if (typeof input !== 'string' || !input.startsWith(TURBO_ROOT)) continue;
      const path = input.slice(TURBO_ROOT.length);
      byPath.set(path, [...(byPath.get(path) ?? []), task]);
    }
  }
  return { rows: [...byPath].map(([path, from]) => ({ path, from })) };
}

/**
 * The verdict on Test Core's scheduling against the generic test tasks' root
 * inputs. Takes the two SOURCE STRINGS (null for one that could not be read);
 * `{ refusal }` for every state in which the subject was not read.
 */
export function judgeTestInputs(source, turboSource) {
  const read = readSchedulingFilters(source);
  if (read.refusal) return read;
  if (typeof turboSource !== 'string') return { refusal: `${TURBO_CONFIG} could not be read.` };
  let turbo;
  try {
    turbo = JSON.parse(turboSource);
  } catch (err) {
    return { refusal: `${TURBO_CONFIG} could not be read as JSON: ${err?.message ?? err}` };
  }
  const declared = testInputsOf(turbo);
  if (declared.refusal) return declared;
  const covered = [];
  const uncovered = [];
  for (const row of declared.rows) {
    const verdict = coverageVerdict(row.path, read.entries);
    (verdict.covered ? covered : uncovered).push({ ...row, ...verdict });
  }
  return { condition: read.condition, inputs: declared.rows, covered, uncovered };
}

function reportTestInputs(verdict) {
  if (verdict.refusal) {
    console.error(`FAIL: check-ci-filter-parity could not judge Test Core's test inputs.\n\n  - ${verdict.refusal}\n`);
    return 1;
  }
  if (verdict.uncovered.length > 0) {
    console.error(
      `FAIL: ci.yml's scheduling filters are out of step with the generic test tasks' root inputs.\n\n` +
        `  - ${verdict.uncovered.length} root input(s) of ${TEST_TASKS.map((t) => `\`${t}\``).join(' / ')} in ${TURBO_CONFIG} are ` +
        `covered by NEITHER ${SCHEDULING_FILTERS.map((n) => `\`${n}\``).join(' nor ')} in ${CI_WORKFLOW}. A diff confined to\n` +
        `    one moves every package's test hash and starts no \`${SCHEDULED_JOB}\` job, so the merge queue is the first place\n` +
        `    Test Core runs on it:\n` +
        verdict.uncovered.map((r) => `      ${r.path}   (${r.from.join(', ')})`).join('\n') +
        `\n    Add each one VERBATIM to the \`${TEST_REMEDY_FILTER}:\` filter in ${CI_WORKFLOW}. Not \`${REMEDY_FILTER}:\`, which is held to\n` +
        '    the cross-package declarations, and not the subtree it sits in.\n',
    );
    return 1;
  }
  console.log(
    `OK: all ${verdict.inputs.length} root input(s) of ${TEST_TASKS.map((t) => `\`${t}\``).join(' / ')} in ${TURBO_CONFIG} are ` +
      `covered by ${SCHEDULING_FILTERS.map((n) => `\`${n}\``).join(' or ')}, which the \`${SCHEDULED_JOB}\` job's \`if:\` reads.`,
  );
  return 0;
}

// ── The fifth subject: Test UI and the files outside ui/ that ui tests read (#37935, #38133) ──

/** The job that runs the ui tree's vitest suites, by id. */
export const UI_TEST_JOB = 'test-ui';
/** The filter outputs its `if:` may OR; `ui` must be among the ones it names. */
export const UI_SCHEDULING_FILTERS = Object.freeze(['ui', 'ui_consumers']);
/** Where an uncovered read belongs, and the list whose reads group is judged for leftovers. */
export const UI_REMEDY_FILTER = 'ui';
/** The tree whose tests are read; every read outside it is this subject's population. */
export const UI_TREE = 'ui';
/**
 * The heading comment that opens the reads group at the end of the `ui:` list.
 * Every row below it must have a reader; rows above it are the ui jobs' own
 * build and gate inputs, which no test read accounts for.
 */
export const UI_READS_GROUP_MARKER = 'UI TEST READS OUTSIDE ui/';
/** A comment line in the reads group declaring a read left unscheduled on purpose: `<marker> <path> -- <reason>`. */
export const UI_TRADE_OFF_MARKER = 'ui-read trade-off:';

const UI_TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

const insideUiTree = (path) => path === UI_TREE || path.startsWith(`${UI_TREE}/`);

/**
 * Every path outside `ui/` that a tracked ui test file reads, each with its
 * readers, or `{ refusal }`. The reads come from `scanPathExpressions`, the
 * walker `check:cross-package-test-inputs` and the ui test selector already use
 * -- not a recognizer of this gate's own. `files` (a bound name) and relative
 * `imports` are file candidates, `dirs` (a listing) directory candidates, and
 * each counts only as what it really is on disk, the filter
 * `check:cross-package-test-inputs` applies to the same walker's answer: the
 * walker puts every BOUND name in `files`, so a directory bound to a name and
 * then listed sits in both sets, and only the disk says it is a directory. An
 * import is resolved by that gate's own `resolveImportTarget` (an
 * extensionless or `.js` specifier names the `.ts` source). A candidate naming
 * nothing on disk is a synthetic fixture path, not a read. A directory read is
 * covered only by its subtree.
 *
 * @param {string} root   the repository root
 * @param {string[] | null} [listed]  repo-relative tracked files (git's answer when absent)
 */
export function uiRootReadsOf(root, listed = null) {
  let tracked = listed;
  if (!tracked) {
    const out = spawnSync('git', ['ls-files', '-z', '--', UI_TREE], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (out.status !== 0) return { refusal: `git could not list the tracked files under \`${UI_TREE}/\`: ${(out.stderr || out.error?.message || '').trim()}` };
    tracked = out.stdout.split('\0').filter(Boolean);
  }
  const tests = tracked.filter((f) => f.startsWith(`${UI_TREE}/`) && UI_TEST_FILE.test(f) && !f.split('/').includes('node_modules'));
  if (tests.length === 0) {
    return { refusal: `no tracked test file under \`${UI_TREE}/\` -- a parity check over ui tests nobody read is not a pass.` };
  }
  const byPath = new Map();
  for (const rel of tests) {
    let source;
    try {
      source = readFileSync(join(root, rel), 'utf8');
    } catch (err) {
      return { refusal: `the tracked ui test ${rel} could not be read: ${err?.code ?? err?.message ?? err}` };
    }
    const segs = rel.split('/');
    const scan = scanPathExpressions(source, segs.length - 1, segs, null);
    const imports = [...scan.imports].map((p) => resolveImportTarget(p, root) ?? p);
    const candidates = [...[...scan.files, ...imports].map((p) => [p, 'file']), ...[...scan.dirs].map((p) => [p, 'dir'])];
    for (const name of new Set(candidates.map(([p]) => p))) {
      if (!name || insideUiTree(name) || name.startsWith('..') || name.startsWith('/') || name.split('/').includes('node_modules')) continue;
      const kind = realKindOf(root, name);
      if (!kind || !candidates.some(([p, k]) => p === name && k === kind)) continue;
      const row = byPath.get(name) ?? { path: name, kind, from: [] };
      if (!row.from.includes(rel)) row.from.push(rel);
      byPath.set(name, row);
    }
  }
  return { tests: tests.length, rows: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}

/** `'file'`, `'dir'`, or null when `rel` names nothing on disk under `root`. */
function realKindOf(root, rel) {
  try {
    const st = statSync(join(root, rel));
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null;
  } catch {
    return null;
  }
}

/** A directory read must be covered by its subtree; a file read, by the file or a subtree above it. */
const uiCoverage = (row, entries) =>
  row.kind === 'dir' ? coverageVerdict(`${row.path}/x`, entries) : coverageVerdict(row.path, entries);

/**
 * The reads group of the `ui:` list, read out of the `filters:` input's TEXT,
 * because YAML drops the comments that carry its heading and its trade-offs.
 * Returns `{ rows, tradeOffs }` -- the list items below the heading and a Map
 * of declared trade-off path to reason -- or `{ refusal }`.
 */
export function uiReadsGroupOf(raw) {
  const lines = String(raw ?? '').split('\n');
  const indentOf = (l) => l.match(/^\s*/)[0].length;
  const keyAt = lines.findIndex((l) => new RegExp(`^\\s*${UI_REMEDY_FILTER}:\\s*$`).test(l));
  if (keyAt < 0) return { refusal: `${CI_WORKFLOW}'s \`filters:\` input has no \`${UI_REMEDY_FILTER}:\` list to read the reads group from.` };
  const keyIndent = indentOf(lines[keyAt]);
  let end = lines.length;
  for (let i = keyAt + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t && indentOf(lines[i]) <= keyIndent && !t.startsWith('#') && !t.startsWith('-')) {
      end = i;
      break;
    }
  }
  // Only lines indented under the key belong to it: a comment at the key's own
  // column introduces the NEXT list.
  const body = lines.slice(keyAt + 1, end).filter((l) => !l.trim() || indentOf(l) > keyIndent);
  const headings = body.map((l, i) => [l, i]).filter(([l]) => l.trim().startsWith('#') && l.includes(UI_READS_GROUP_MARKER));
  if (headings.length !== 1) {
    return {
      refusal:
        `${CI_WORKFLOW}'s \`${UI_REMEDY_FILTER}:\` list carries ${headings.length} \`${UI_READS_GROUP_MARKER}\` heading(s); this gate reads ` +
        `exactly one, above the rows that schedule the ui tests' reads outside ${UI_TREE}/.`,
    };
  }
  const rows = [];
  const tradeOffs = new Map();
  const malformed = [];
  for (const line of body.slice(headings[0][1] + 1)) {
    const t = line.trim();
    const item = /^-\s*(['"]?)(.*)\1\s*$/.exec(t);
    if (item) {
      rows.push(item[2]);
      continue;
    }
    // A trade-off line STARTS with the marker; prose that mentions it does not declare one.
    const comment = /^#\s*(.*)$/.exec(t)?.[1] ?? '';
    if (!comment.startsWith(UI_TRADE_OFF_MARKER)) continue;
    const m = /^(\S+)\s+--\s+(\S.*)$/.exec(comment.slice(UI_TRADE_OFF_MARKER.length).trim());
    if (m) tradeOffs.set(m[1], m[2]);
    else malformed.push(t);
  }
  if (malformed.length > 0) {
    return {
      refusal:
        `${CI_WORKFLOW}'s reads group carries a \`${UI_TRADE_OFF_MARKER}\` line this gate cannot read; spell it ` +
        `\`# ${UI_TRADE_OFF_MARKER} PATH -- REASON\`:\n` + malformed.map((l) => `      ${l}`).join('\n'),
    };
  }
  return { rows, tradeOffs };
}

/**
 * The verdict on Test UI's scheduling against the files outside `ui/` that ui
 * tests read. Takes ci.yml's SOURCE STRING and the reads (`uiRootReadsOf`'s
 * answer); `{ refusal }` for every state in which the subject was not read.
 */
export function judgeUiReads(source, reads) {
  const read = readFilterLists(source);
  if (read.refusal) return read;
  if (!reads || reads.refusal) return { refusal: reads?.refusal ?? 'the ui tests\' reads were not supplied.' };
  const job = read.jobs[UI_TEST_JOB];
  if (!job) return { refusal: `${CI_WORKFLOW} has no \`${UI_TEST_JOB}\` job -- the job that runs the ui tests has moved.` };
  const condition = typeof job.if === 'string' ? job.if : '';
  // `ui` is a prefix of `ui_consumers` and `ui_tree`, so a name is matched whole.
  const named = UI_SCHEDULING_FILTERS.filter((n) => new RegExp(`needs\\.filter\\.outputs\\.${n}(?![\\w])`).test(condition));
  if (!named.includes(UI_REMEDY_FILTER)) {
    return {
      refusal:
        `${CI_WORKFLOW}'s \`${UI_TEST_JOB}\` job no longer names \`${UI_REMEDY_FILTER}\` in its \`if:\`, so that filter does not ` +
        `schedule it any more and parity against it means nothing.\n    if: ${condition || '(absent)'}`,
    };
  }
  for (const name of named) {
    if (!(name in read.filters)) return { refusal: `${CI_WORKFLOW}'s \`filters:\` input declares no \`${name}:\` filter.` };
  }
  const group = uiReadsGroupOf(read.raw);
  if (group.refusal) return group;
  const entries = named.flatMap((n) => read.filters[n]);
  const covered = [];
  const tradedOff = [];
  const uncovered = [];
  for (const row of reads.rows) {
    const verdict = uiCoverage(row, entries);
    if (verdict.covered) covered.push({ ...row, ...verdict });
    else if (group.tradeOffs.has(row.path)) tradedOff.push({ ...row, reason: group.tradeOffs.get(row.path) });
    else uncovered.push({ ...row, ...verdict });
  }
  // The other direction: a reads-group row that no ui test reads any more
  // starts the whole ui battery for nothing, and a trade-off for a read that is
  // gone, or that a row now schedules, declares a gap that is not there.
  const stale = group.rows.filter((entry) => !reads.rows.some((row) => uiCoverage(row, [entry]).covered));
  const staleTradeOffs = [...group.tradeOffs.keys()].filter(
    (path) => !reads.rows.some((row) => row.path === path) || covered.some((row) => row.path === path),
  );
  return { condition, named, tests: reads.tests, rows: reads.rows, covered, tradedOff, uncovered, stale, staleTradeOffs };
}

function reportUiReads(verdict) {
  if (verdict.refusal) {
    console.error(`FAIL: check-ci-filter-parity could not judge Test UI's reads outside ${UI_TREE}/.\n\n  - ${verdict.refusal}\n`);
    return 1;
  }
  const problems = [];
  if (verdict.uncovered.length > 0) {
    problems.push(
      `${verdict.uncovered.length} path(s) outside ${UI_TREE}/ that a ui test reads are covered by none of ` +
        `${verdict.named.map((n) => `\`${n}\``).join(', ')} in ${CI_WORKFLOW} and declared as no trade-off. A diff confined to one\n` +
        `    starts no \`${UI_TEST_JOB}\` job, on the PR or in the merge queue, so the test that reads it first runs on the next ui PR:\n` +
        verdict.uncovered.map((r) => `      ${r.path}${r.kind === 'dir' ? '/**' : ''}   (read by ${r.from.join(', ')})`).join('\n') +
        `\n    Add each one VERBATIM below the \`${UI_READS_GROUP_MARKER}\` heading of the \`${UI_REMEDY_FILTER}:\` filter in ${CI_WORKFLOW}\n` +
        `    (a directory read as \`<dir>/**\`), or change the test so it does not read the file. A read left unscheduled on\n` +
        `    purpose is a \`# ${UI_TRADE_OFF_MARKER} PATH -- REASON\` line in that group, naming what runs it instead.`,
    );
  }
  if (verdict.stale.length > 0) {
    problems.push(
      `${CI_WORKFLOW}'s \`${UI_REMEDY_FILTER}:\` reads group carries row(s) that no ui test reads any more:\n` +
        verdict.stale.map((e) => `      ${e}`).join('\n') +
        `\n    Check each, then delete it: it starts every ui job for an edit no ui test file reads. This gate sees only\n` +
        `    the reads a ui test file spells itself, not one made inside a module the test imports, so first confirm\n` +
        `    no imported helper reads it; a row such a helper needs belongs above the heading, with its reason.`,
    );
  }
  if (verdict.staleTradeOffs.length > 0) {
    problems.push(
      `${CI_WORKFLOW}'s reads group declares trade-off(s) for a read no ui test makes, or one a row already schedules:\n` +
        verdict.staleTradeOffs.map((e) => `      ${e}`).join('\n') +
        `\n    Delete the \`${UI_TRADE_OFF_MARKER}\` line: it declares a scheduling gap that is not there.`,
    );
  }
  if (problems.length > 0) {
    console.error(`FAIL: ci.yml's \`${UI_REMEDY_FILTER}\` filter is out of step with the files outside ${UI_TREE}/ the ui tests read.\n`);
    for (const p of problems) console.error(`  - ${p}\n`);
    return 1;
  }
  console.log(
    `OK: all ${verdict.rows.length} path(s) outside ${UI_TREE}/ read by the ${verdict.tests} tracked ui test file(s) are ` +
      `covered by ${verdict.named.map((n) => `\`${n}\``).join(' or ')}, which the \`${UI_TEST_JOB}\` job's \`if:\` reads` +
      (verdict.tradedOff.length > 0 ? `, or declared as a trade-off (${verdict.tradedOff.map((r) => r.path).join(', ')})` : '') +
      `, and every row and trade-off of the reads group still has a reader.`,
  );
  return 0;
}

// ── The sixth subject: the ui scheduling pin (#38132) ──

/** The pin record: the least ci.yml may schedule the ui jobs. Read, never copied here. */
export const UI_PIN_FILE = 'scripts/ci-filter-parity.ui-pin.json';
/** The `filter` job outputs the ui jobs are scheduled by; a job reading any of them is a ui job. */
export const UI_OUTPUT_NAMES = Object.freeze(['ui', 'ui_consumers', 'ui_tree']);
const UI_OUTPUT_READ = new RegExp(`needs\\.filter\\.outputs\\.(?:${UI_OUTPUT_NAMES.join('|')})(?![\\w])`);

/** An expression without its `${{ }}` wrapper, whitespace collapsed. */
export const normalizeExpression = (expr) =>
  String(expr ?? '')
    .trim()
    .replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1')
    .replace(/\s+/g, ' ')
    .trim();

/** Split `s` on `op` at paren depth 0, outside quoted strings. */
function splitTopLevel(s, op) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (depth === 0 && s.startsWith(op, i)) {
      parts.push(s.slice(start, i));
      start = i + op.length;
      i += op.length - 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim());
}

/** `( x )` → `x`, only when the outer parens enclose the whole expression. */
function stripOuterParens(s) {
  let t = s.trim();
  while (t.startsWith('(') && t.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') depth += 1;
      else if (t[i] === ')') depth -= 1;
      if (depth === 0 && i < t.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

/**
 * A job condition as clauses of a conjunction, each clause the set of its
 * disjuncts: `a && (b || c)` → `[[a], [b, c]]`. An atom is compared as its
 * normalised text, so the comparison is syntactic. An absent `if:` is the one
 * clause `(absent)`, GitHub's implicit `success()`.
 */
export function conditionClauses(expr) {
  const text = normalizeExpression(expr);
  if (!text) return [['(absent)']];
  return splitTopLevel(text, '&&').map((conjunct) => [...new Set(splitTopLevel(stripOuterParens(conjunct), '||'))].sort());
}

/**
 * Does `actual` run at least whenever `pinned` does? Sound and syntactic:
 * every clause of `actual` must contain all the disjuncts of some clause of
 * `pinned`, so each actual clause is implied by a pinned one. Dropping a
 * clause or adding a disjunct passes; adding a clause, dropping a disjunct or
 * changing an atom does not -- the conservative answer on a rewrite that is in
 * fact wider is a red naming the clause, never a silent pass.
 */
export function conditionAtLeast(actual, pinned) {
  const p = conditionClauses(pinned);
  const narrower = conditionClauses(actual).filter((clause) => !p.some((pc) => pc.every((atom) => clause.includes(atom))));
  return { holds: narrower.length === 0, narrower: narrower.map((c) => c.join(' || ')) };
}

/** The pin record's own shape, or the reason it cannot be read. */
function pinRefusal(pin) {
  if (!pin || typeof pin !== 'object' || Array.isArray(pin)) return `${UI_PIN_FILE} is missing or is not a JSON object.`;
  const isStrings = (xs) => Array.isArray(xs) && xs.length > 0 && xs.every((x) => typeof x === 'string');
  const isMap = (m) => m && typeof m === 'object' && !Array.isArray(m) && Object.keys(m).length > 0;
  if (!isStrings(pin.inputs)) return `${UI_PIN_FILE} carries no \`inputs\` list of the paths-filter step's \`with:\` keys.`;
  if (!isMap(pin.outputs) || !Object.values(pin.outputs).every((v) => typeof v === 'string')) return `${UI_PIN_FILE} carries no \`outputs\` map of filter output expressions.`;
  if (!isMap(pin.rows) || !Object.values(pin.rows).every(isStrings)) return `${UI_PIN_FILE} carries no \`rows\` map of filter name to its pinned rows.`;
  if (!isMap(pin.conditions) || !Object.values(pin.conditions).every((v) => typeof v === 'string')) return `${UI_PIN_FILE} carries no \`conditions\` map of ui job to its pinned \`if:\`.`;
  for (const name of UI_OUTPUT_NAMES) if (!(name in pin.outputs)) return `${UI_PIN_FILE} pins no \`${name}\` output.`;
  return null;
}

/**
 * The verdict on ci.yml against the ui scheduling pin: the paths-filter step's
 * whole `with:` input (its keys exactly, and a floor of rows for each filter
 * the pin names), the `filter` job's output expressions the ui jobs read
 * (exactly), and the `if:` of every job that reads a ui output (at least as
 * wide as its pin, and every such job pinned). `{ refusal }` when either side
 * could not be read.
 */
export function judgeUiScheduling(source, pin) {
  const refusal = pinRefusal(pin);
  if (refusal) return { refusal };
  const read = readFilterLists(source);
  if (read.refusal) return read;
  const { jobs, filters, step } = read;

  const withKeys = Object.keys(step.with ?? {});
  const extraInputs = withKeys.filter((k) => !pin.inputs.includes(k));
  const missingInputs = pin.inputs.filter((k) => !withKeys.includes(k));

  const outputs = jobs.filter?.outputs ?? {};
  const changedOutputs = Object.entries(pin.outputs)
    .filter(([name, expr]) => normalizeExpression(outputs[name]) !== normalizeExpression(expr))
    .map(([name, expr]) => ({ name, pinned: normalizeExpression(expr), actual: name in outputs ? normalizeExpression(outputs[name]) : '(absent)' }));

  const missingRows = Object.entries(pin.rows).flatMap(([name, rows]) =>
    rows.filter((row) => !(filters[name] ?? []).includes(row)).map((row) => ({ name, row })),
  );

  const uiJobs = Object.entries(jobs)
    .filter(([id, job]) => id !== 'filter' && UI_OUTPUT_READ.test(JSON.stringify(job ?? {})))
    .map(([id]) => id);
  const unpinnedJobs = uiJobs.filter((id) => !(id in pin.conditions));
  const vanishedJobs = Object.keys(pin.conditions).filter((id) => !(id in jobs));
  const narrowedJobs = [];
  const widenedJobs = [];
  for (const [id, pinned] of Object.entries(pin.conditions)) {
    if (!(id in jobs)) continue;
    const actual = jobs[id]?.if;
    const verdict = conditionAtLeast(actual, pinned);
    if (!verdict.holds) narrowedJobs.push({ id, pinned: normalizeExpression(pinned), actual: normalizeExpression(actual) || '(absent)', clauses: verdict.narrower });
    else if (normalizeExpression(actual) !== normalizeExpression(pinned)) widenedJobs.push(id);
  }
  return { uiJobs, pinnedInputs: pin.inputs, extraInputs, missingInputs, changedOutputs, missingRows, unpinnedJobs, vanishedJobs, narrowedJobs, widenedJobs };
}

function reportUiScheduling(verdict) {
  if (verdict.refusal) {
    console.error(`FAIL: check-ci-filter-parity could not judge the ui scheduling against ${UI_PIN_FILE}.\n\n  - ${verdict.refusal}\n`);
    return 1;
  }
  const problems = [];
  if (verdict.extraInputs.length > 0 || verdict.missingInputs.length > 0) {
    problems.push(
      `the \`dorny/paths-filter\` step's \`with:\` input is pinned to exactly the keys ${JSON.stringify(verdict.pinnedInputs)}` +
        (verdict.extraInputs.length ? `; added: ${verdict.extraInputs.join(', ')}` : '') +
        (verdict.missingInputs.length ? `; removed: ${verdict.missingInputs.join(', ')}` : '') +
        `.\n    Every input of that action decides which diff is read or how a row matches it, so each one is pinned.`,
    );
  }
  for (const o of verdict.changedOutputs) {
    problems.push(
      `the \`filter\` job's \`${o.name}\` output is pinned exactly, and it changed:\n      pinned: ${o.pinned}\n      actual: ${o.actual}`,
    );
  }
  if (verdict.missingRows.length > 0) {
    problems.push(
      `pinned row(s) are gone from the filters the ui jobs read, so a diff they matched no longer starts those jobs:\n` +
        verdict.missingRows.map((r) => `      ${r.name}: ${r.row}`).join('\n'),
    );
  }
  for (const j of verdict.narrowedJobs) {
    problems.push(
      `the \`${j.id}\` job's \`if:\` is not provably at least as wide as its pin; these clauses are new or narrower:\n` +
        j.clauses.map((c) => `      ${c}`).join('\n') +
        `\n      pinned: ${j.pinned}\n      actual: ${j.actual}`,
    );
  }
  if (verdict.unpinnedJobs.length > 0) {
    problems.push(`job(s) that read a ui output carry no pinned condition: ${verdict.unpinnedJobs.join(', ')}.`);
  }
  if (verdict.vanishedJobs.length > 0) {
    problems.push(`pinned ui job(s) are gone from ${CI_WORKFLOW}: ${verdict.vanishedJobs.join(', ')}.`);
  }
  if (problems.length > 0) {
    console.error(`FAIL: ${CI_WORKFLOW} schedules the ui jobs differently from ${UI_PIN_FILE}.\n`);
    for (const p of problems) console.error(`  - ${p}\n`);
    console.error(
      `What is pinned: the paths-filter step's \`with:\` keys and the \`filter\` outputs ${UI_OUTPUT_NAMES.join(', ')} (and any other\n` +
        `output a ui job reads) exactly; the rows the pin lists for each filter as a floor; and every job reading a ui\n` +
        `output, with its \`if:\` as a floor. An edit that schedules the ui jobs LESS is the failure this subject exists\n` +
        `to catch. An edit that is deliberate -- a new ui job, a renamed one, an output or input rewritten -- updates\n` +
        `${UI_PIN_FILE} in the same PR, so the change to what runs is read where it is made.\n`,
    );
    return 1;
  }
  console.log(
    `OK: ${CI_WORKFLOW} schedules the ${verdict.uiJobs.length} ui job(s) at least as ${UI_PIN_FILE} pins: the paths-filter input, ` +
      `the ui outputs, the pinned rows and every ui job's \`if:\`` +
      (verdict.widenedJobs.length > 0 ? ` (wider than the pin, which holds only its floor: ${verdict.widenedJobs.join(', ')})` : '') +
      '.',
  );
  return 0;
}

/** The pin record under `root`, parsed, or null when it cannot be read -- the judge refuses on null by name. */
function readPin(root) {
  const text = readOrNull(root, UI_PIN_FILE);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

export function main(root = REPO_ROOT, table = CROSS_PACKAGE_TEST_INPUTS, uiReads = null, uiPin = undefined) {
  let source;
  try {
    source = readFileSync(join(root, CI_WORKFLOW), 'utf8');
  } catch (err) {
    console.error(`FAIL: cannot read ${CI_WORKFLOW}: ${err?.code ?? err?.message ?? err}`);
    return 1;
  }
  // Every subject is judged and every one reports, so one red never hides another.
  const crosspkg = report(judge(source, table));
  const buildCode = reportBuildInputs(
    judgeBuildInputs(source, readOrNull(root, TURBO_CONFIG), readOrNull(root, ROOT_MANIFEST), closureIn(root)),
  );
  const testCode = reportTestInputs(judgeTestInputs(source, readOrNull(root, TURBO_CONFIG)));
  // `uiReads` is injectable only so the self-test can judge a scratch ci.yml
  // against the real tree's reads; a real run always reads `root`'s ui tests.
  const uiCode = reportUiReads(judgeUiReads(source, uiReads ?? uiRootReadsOf(root)));
  // `uiPin` likewise: injectable for the self-test, read from `root` otherwise.
  const pinCode = reportUiScheduling(judgeUiScheduling(source, uiPin === undefined ? readPin(root) : uiPin));
  return crosspkg === 0 && buildCode === 0 && testCode === 0 && uiCode === 0 && pinCode === 0 ? 0 : 1;
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

  const build = judgeBuildInputs(
    readFileSync(join(root, CI_WORKFLOW), 'utf8'),
    readOrNull(root, TURBO_CONFIG),
    readOrNull(root, ROOT_MANIFEST),
    closureIn(root),
  );
  if (build.refusal) {
    console.error(`FAIL: ${build.refusal}`);
    return 1;
  }
  console.log(`\nbuild inputs ${TURBO_CONFIG} declares, against ${BUILD_FILTER} (${BUILD_JOB}):`);
  for (const row of [...build.covered, ...build.uncovered].sort((a, b) => a.path.localeCompare(b.path))) {
    console.log(`${row.covered ? 'ok  ' : 'FAIL'} ${row.path}${row.covered ? `   via ${row.kind} ${row.via}` : ''}   (${row.from.join(', ')})`);
  }
  console.log(`\nscripts the ${BUILD_JOB} job's own steps run, against ${BUILD_FILTER}:`);
  for (const row of [...build.guardsCovered, ...build.guardsUncovered].sort((a, b) => a.path.localeCompare(b.path))) {
    console.log(`${row.covered ? 'ok  ' : 'FAIL'} ${row.path}${row.covered ? `   via ${row.kind} ${row.via}` : ''}   (${row.from.join('; ')})`);
  }
  for (const entry of build.stale) console.log(`FAIL ${entry}   stale: covers no declared build input and no script a ${BUILD_JOB} step runs`);
  console.log(`left out (excluded by \`${BUILD_COMMAND}\`): ${build.excludedTasks.join(', ') || 'none'}`);

  const test = judgeTestInputs(readFileSync(join(root, CI_WORKFLOW), 'utf8'), readOrNull(root, TURBO_CONFIG));
  if (test.refusal) {
    console.error(`FAIL: ${test.refusal}`);
    return 1;
  }
  console.log(`\nroot inputs of ${TEST_TASKS.join(' / ')} in ${TURBO_CONFIG}, against ${SCHEDULING_FILTERS.join(' + ')} (${SCHEDULED_JOB}):`);
  for (const row of [...test.covered, ...test.uncovered].sort((a, b) => a.path.localeCompare(b.path))) {
    console.log(`${row.covered ? 'ok  ' : 'FAIL'} ${row.path}${row.covered ? `   via ${row.kind} ${row.via}` : ''}   (${row.from.join(', ')})`);
  }
  const ui = judgeUiReads(readFileSync(join(root, CI_WORKFLOW), 'utf8'), uiRootReadsOf(root));
  if (ui.refusal) {
    console.error(`FAIL: ${ui.refusal}`);
    return 1;
  }
  console.log(`\nreads outside ${UI_TREE}/ by the ${ui.tests} ui test file(s), against ${ui.named.join(' + ')} (${UI_TEST_JOB}):`);
  for (const row of [...ui.covered, ...ui.tradedOff, ...ui.uncovered].sort((a, b) => a.path.localeCompare(b.path))) {
    const how = row.covered ? `   via ${row.kind === 'dir' ? 'subtree' : row.kind} ${row.via}` : row.reason ? '   trade-off' : '';
    console.log(`${row.covered || row.reason ? 'ok  ' : 'FAIL'} ${row.path}${how}   (${row.from.join(', ')})`);
  }
  for (const entry of ui.stale) console.log(`FAIL ${entry}   stale: no ui test reads it`);
  for (const entry of ui.staleTradeOffs) console.log(`FAIL ${entry}   stale trade-off: no ui test reads it, or a row covers it`);
  const pin = judgeUiScheduling(readFileSync(join(root, CI_WORKFLOW), 'utf8'), readPin(root));
  if (pin.refusal) {
    console.error(`FAIL: ${pin.refusal}`);
    return 1;
  }
  console.log(`\nui jobs against ${UI_PIN_FILE}: ${pin.uiJobs.join(', ')}`);
  const pinRed = pin.extraInputs.length + pin.missingInputs.length + pin.changedOutputs.length + pin.missingRows.length +
    pin.unpinnedJobs.length + pin.vanishedJobs.length + pin.narrowedJobs.length;
  console.log(pinRed === 0 ? 'ok   the paths-filter input, the ui outputs, the pinned rows and every ui job condition hold' : `FAIL ${pinRed} pin finding(s); run without --list for each`);
  return verdict.uncovered.length > 0 ||
    build.uncovered.length > 0 ||
    build.guardsUncovered.length > 0 ||
    build.stale.length > 0 ||
    test.uncovered.length > 0 ||
    ui.uncovered.length > 0 ||
    ui.stale.length > 0 ||
    ui.staleTradeOffs.length > 0 ||
    pinRed > 0
    ? 1
    : 0;
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
  // one: the rollback uncovered twenty-two. Minus three since `skills/**`
  // became a BUILD INPUT: `@objectstack/skills#build` copies the repository
  // root's catalog into its publish tree, turbo.json declares
  // `$TURBO_ROOT$/skills/**` on that task, and the third subject below
  // requires `core` to carry it -- so the rollback, which keeps the live
  // `core`, no longer uncovers the three declarations rooted there (#12201's
  // `skills/**`, #10178's automation skill file, the formula skill's own
  // `skills/objectstack-formula/**`). Nineteen. This pin is judged over the
  // LIVE declaration table on purpose: a declaration added under a root the
  // rollback keeps leaves the count alone, one under a new root moves it and
  // is recorded here by name -- and a root `core` starts covering moves it the
  // other way, recorded the same way.
  // Plus, since #29972, the one doc page that card declared for
  // @objectstack/cli: the `OS_TRUSTED_APP_SCHEMES` contract test holds the
  // variable's row beside `OS_TRUSTED_ORIGINS` in
  // `deployment/environment-variables.mdx`, covered only through the same
  // `content/**` root, like #14824's three and #15818's two. Twenty.
  // Plus, since #30289, the one scenario-library glob that card declared for
  // @objectstack/scenarios: its suite loads every card under
  // `docs/qa/scenarios/*.json`, covered only through the `docs/**` root in
  // `crosspkg` (judged per declared glob, like #18650's). Its second glob is
  // #18650's own string, already a member, so it moves nothing. Twenty-one.
  // Plus, since #31017, the one `ui/` source file that card declared for
  // @objectstack/mcp: the server's half of the Console SKILL.md mirror pin
  // imports `ui/apps/console/src/pages/developer/objectstack-skill.ts`, covered
  // only through its own single-file `crosspkg` entry, the way #12924's
  // manifest is. Twenty-two.
  // Plus, since #31729, the one ADR file that card declared for
  // @objectstack/scenarios: the bare-name pin reads ADR-0150 D1's table rows,
  // covered only through the `docs/**` root in `crosspkg` (judged per declared
  // glob, like #30289's). Twenty-three.
  // Plus, since #34920, the one verified-builds glob that card declared for
  // @objectstack/scenarios: its suite pins each build under
  // `docs/qa/scenarios/builds/*.json` to its provenance and its card, covered
  // only through the `docs/**` root in `crosspkg` (judged per declared glob,
  // like #30289's). Twenty-four.
  const preFix = judge(fixtureWorkflow({ core: real.filters?.core, crosspkg: ['scripts/**'] }), CROSS_PACKAGE_TEST_INPUTS);
  assert(
    new Set(uncoveredGlobs(preFix)).size === 24,
    `rolling \`crosspkg\` back to its pre-#10015 list uncovers the ten it fixed plus #10848's one plus #10178's two plus #12201's one plus #12924's one plus #14561's one plus #14824's three plus #15818's two plus #18650's one plus #29972's one plus #30289's one plus #31017's one plus #31729's one plus #34920's one, minus the three under the \`skills/**\` build input \`core\` now covers -- got ${new Set(uncoveredGlobs(preFix)).size}`,
  );
  assert(
    !uncoveredGlobs(preFix).includes('skills/**'),
    `-- and #12201's published-catalog root the export-list corpus gate reads stays covered through \`core\`, where it is a build input of @objectstack/skills#build, by name`,
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
    !uncoveredGlobs(preFix).includes('skills/objectstack-automation/SKILL.md'),
    `-- and #10178's automation skill file stays covered through the same \`core\` build input, by name`,
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
  assert(
    uncoveredGlobs(preFix).includes('content/docs/deployment/environment-variables.mdx'),
    `-- and #29972 added the OS_TRUSTED_APP_SCHEMES reference page, by name`,
  );
  assert(
    uncoveredGlobs(preFix).includes('docs/qa/scenarios/*.json'),
    `-- and #30289 added the scenario-library card glob, by name`,
  );
  assert(
    uncoveredGlobs(preFix).includes('ui/apps/console/src/pages/developer/objectstack-skill.ts'),
    `-- and #31017 added the Console SKILL.md mirror the server's half of its drift pin imports, by name`,
  );
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
    // CI runs the root alias (lint.yml's GATE INVOCATION IDIOM note), so the
    // alias is where both legs live: pin the step AND the alias value.
    assert(
      /^\s*run: pnpm check:ci-filter-parity\s*$/m.test(lint),
      `wiring: lint.yml runs ${SELF} through its root alias \`pnpm check:ci-filter-parity\``,
    );
    let alias = null;
    try {
      alias = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts?.['check:ci-filter-parity'] ?? null;
    } catch (err) {
      failures.push(`cannot read root package.json to verify wiring: ${err?.code ?? err?.message}`);
    }
    assert(
      alias === `node ${SELF} --self-test && node ${SELF}`,
      `wiring: root package.json's check:ci-filter-parity runs the --self-test leg, then the gate -- got ${JSON.stringify(alias)}`,
    );
  }

  // The checked-in ci.yml, which the real-tree cases of (9) and (10) read.
  const realSource = readFileSync(join(REPO_ROOT, CI_WORKFLOW), 'utf8');

  // A scratch root carrying the given ci.yml beside the REAL turbo.json and
  // root manifest, so the only drift `main()` can see is the one injected: a
  // root missing either file would red the build-input subject on its own and
  // satisfy a "returns 1" assertion for the wrong reason. The same holds for
  // every script the real Build Core's steps run (#21341): their closures are
  // read from the root being judged, so they are staged too.
  const realGuardPaths = (
    judgeBuildInputs(realSource, readFileSync(join(REPO_ROOT, TURBO_CONFIG), 'utf8'), readFileSync(join(REPO_ROOT, ROOT_MANIFEST), 'utf8')).guards ?? []
  ).map((r) => r.path);
  // The scratch root carries no ui tree, so every `main()` over one judges the
  // fifth subject against the real tree's reads, read once here.
  const realUiReads = uiRootReadsOf(REPO_ROOT);
  const inScratchTree = (ciSource, fn) => {
    const scratch = mkdtempSync(join(tmpdir(), 'ci-filter-parity-'));
    try {
      mkdirSync(join(scratch, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(scratch, CI_WORKFLOW), ciSource);
      for (const rel of [TURBO_CONFIG, ROOT_MANIFEST, UI_PIN_FILE, ...realGuardPaths]) {
        mkdirSync(dirname(join(scratch, rel)), { recursive: true });
        writeFileSync(join(scratch, rel), readFileSync(join(REPO_ROOT, rel), 'utf8'));
      }
      return fn(scratch);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };

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
      // Quoted, so a multi-line `run` stays one YAML scalar.
      `      - run: ${JSON.stringify(run)}`,
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
  // The closed flag list (#25374): reporting flags pass, anything that could
  // change the task set refuses, and so do the same flags on another command.
  assert(!buildRefusal({ workflow: buildWorkflow({ run: 'pnpm build --summarize --log-file=.turbo/remote-cache/build-core.json' }) }), '`pnpm build --summarize --log-file=PATH` is still Build Core running `pnpm build`');
  assert(!buildRefusal({ workflow: buildWorkflow({ run: 'pnpm build --summarize' }) }), '-- and so is `pnpm build --summarize` alone');
  for (const [run, why] of [
    ['pnpm build --summarize --filter=@objectstack/spec', 'a `--filter` beside the allowed flags'],
    ['pnpm build --affected', '`--affected`'],
    ['pnpm build --summarize --force', 'an unknown flag'],
    ['pnpm build --log-file=', 'a `--log-file=` with no path'],
    ['pnpm build -- --summarize', 'a `--` passthrough'],
    ['pnpm test --summarize --log-file=x.json', 'the allowed flags on a different command'],
    ['pnpm build --summarize\nnode scripts/x.mjs', 'a second command after the build'],
  ]) {
    assert(/no \`run: pnpm build\` step/.test(buildRefusal({ workflow: buildWorkflow({ run }) })), `${why} => REFUSAL`);
  }
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
  assert(inScratchTree(realSource, (root) => quietly(() => main(root, undefined, realUiReads))) === 0, 'main() returns 0 over the scratch copy of the real tree -- the scratch root is complete');
  assert(inScratchTree(droppedReal, (root) => quietly(() => main(root, undefined, realUiReads))) === 1, '-- and 1 with that one build input dropped: the report path, not only `judgeBuildInputs`');

  // ── (10) Build Core and the scripts its own steps run (#21341) ──────────
  battery('(10) Build Core and the scripts its own steps run');
  // A Build Core whose steps reach scripts every way the recognizer reads, and
  // two ways it deliberately does not: `pnpm build` (the other population),
  // `pnpm install` (a builtin; the root `prepare` it triggers runs in every
  // job) and a package-scoped `pnpm --filter` script (the stated bound).
  const GUARD_CORE = ['packages/**', 'tsconfig.json', 'turbo.json', 'tsup.config.ts', 'scripts/a.mjs', 'scripts/b.mjs', 'scripts/check-foo.mjs', 'scripts/check-bar.mjs', 'scripts/helper.mjs'];
  const GUARD_STEPS = [
    { name: 'Install', run: 'pnpm install --frozen-lockfile' },
    { name: 'Bar self-test', run: 'node scripts/check-bar.mjs --self-test' },
    { name: 'Build', run: 'pnpm build' },
    { name: 'Foo guard', run: 'pnpm check:foo' },
    { name: 'Analyze', run: 'pnpm --filter @objectstack/spec analyze' },
  ];
  const guardWorkflow = ({ core = GUARD_CORE, steps = GUARD_STEPS } = {}) => {
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
      list(core),
      '  build-core:',
      `    if: ${JSON.stringify(BUILD_IF)}`,
      '    steps:',
      ...steps.flatMap((s) => [`      - name: ${JSON.stringify(s.name)}`, '        run: |', ...s.run.split('\n').map((l) => `          ${l}`)]),
    ].join('\n');
  };
  const guardManifest = (extra = {}) =>
    JSON.stringify({
      scripts: {
        build: 'turbo run build --filter=!@objectstack/docs',
        prepare: 'node scripts/setup.mjs',
        'check:foo': 'node scripts/check-foo.mjs --self-test && node scripts/check-foo.mjs',
        ...extra,
      },
    });
  const GUARD_CLOSURES = {
    'scripts/a.mjs': ['scripts/a.mjs'],
    'scripts/check-foo.mjs': ['scripts/check-foo.mjs', 'scripts/helper.mjs'],
    'scripts/check-bar.mjs': ['scripts/check-bar.mjs'],
    'scripts/check-baz.mjs': ['scripts/check-baz.mjs'],
    'scripts/check-qux.mjs': ['scripts/check-qux.mjs'],
    'ops/scripts/check-z.mjs': ['ops/scripts/check-z.mjs'],
  };
  const fixtureClosure = (rel) => {
    if (!Object.hasOwn(GUARD_CLOSURES, rel)) throw new Error(`firstPartyModuleClosure: ${rel} does not exist under the fixture root.`);
    return GUARD_CLOSURES[rel];
  };
  const judgeGuards = ({ workflow, manifest } = {}) =>
    judgeBuildInputs(workflow ?? guardWorkflow(), turboFixture(), manifest ?? guardManifest(), fixtureClosure);
  const guardPaths = (v) => (v.guards ?? []).map((r) => r.path).sort().join(',');
  const uncoveredGuards = (v) => (v.guardsUncovered ?? ['(no verdict)']).map((r) => r.path ?? r).join(',');
  const guardFrom = (v, path) => (v.guards ?? []).find((r) => r.path === path)?.from ?? [];

  const guardClean = judgeGuards();
  assert(
    !guardClean.refusal && findingsOfBuild(guardClean).length === 0 && uncoveredGuards(guardClean) === '',
    `positive control: the default guard fixture is clean -- ${guardClean.refusal ?? [...findingsOfBuild(guardClean), uncoveredGuards(guardClean)].join(', ')}`,
  );
  assert(
    guardPaths(guardClean) === 'scripts/check-bar.mjs,scripts/check-foo.mjs,scripts/helper.mjs',
    `the population is exactly the scripts the steps run and what they import -- nothing from \`pnpm build\`, \`pnpm install\`'s \`prepare\` or the package-scoped step: ${guardPaths(guardClean)}`,
  );
  assert(guardFrom(guardClean, 'scripts/check-foo.mjs').join(';') === 'Foo guard (pnpm check:foo)', '-- a script reached through a root alias is attributed to its step and the alias');
  assert(guardFrom(guardClean, 'scripts/check-bar.mjs').join(';') === 'Bar self-test', '-- a script a step names directly is attributed to that step');
  assert(guardFrom(guardClean, 'scripts/helper.mjs').join(';') === 'imported by scripts/check-foo.mjs', '-- a closure member is attributed to the script that imports it');

  // THE HOLE, both ways the card reads it.
  const droppedGuard = judgeGuards({ workflow: guardWorkflow({ core: GUARD_CORE.filter((e) => e !== 'scripts/check-foo.mjs') }) });
  assert(uncoveredGuards(droppedGuard) === 'scripts/check-foo.mjs', 'THE HOLE: a guard row dropped from `core:` is reported uncovered, by path');
  assert(
    guardFrom(droppedGuard, 'scripts/check-foo.mjs').join(';') === 'Foo guard (pnpm check:foo)' && (droppedGuard.uncovered ?? ['x']).length === 0,
    '-- naming the step that runs it, and not as a build input',
  );
  const newGuardStep = judgeGuards({
    workflow: guardWorkflow({ steps: [...GUARD_STEPS, { name: 'Baz guard', run: 'pnpm check:baz' }] }),
    manifest: guardManifest({ 'check:baz': 'node scripts/check-baz.mjs --self-test && node scripts/check-baz.mjs' }),
  });
  assert(uncoveredGuards(newGuardStep) === 'scripts/check-baz.mjs', 'THE HOLE, other side: a guard STEP added to Build Core with no filter row reds, by path');
  const newDirectStep = judgeGuards({ workflow: guardWorkflow({ steps: [...GUARD_STEPS, { name: 'Qux self-test', run: 'node scripts/check-qux.mjs --self-test' }] }) });
  assert(uncoveredGuards(newDirectStep) === 'scripts/check-qux.mjs', '-- and so does one that names its script directly rather than through an alias');
  const droppedHelper = judgeGuards({ workflow: guardWorkflow({ core: GUARD_CORE.filter((e) => e !== 'scripts/helper.mjs') }) });
  assert(uncoveredGuards(droppedHelper) === 'scripts/helper.mjs', 'a module a guard IMPORTS, dropped from `core:`, reds too -- the guard executes it');
  const chained = judgeGuards({
    workflow: guardWorkflow({ steps: [{ name: 'Build', run: 'pnpm build' }, { name: 'Chain', run: 'pnpm check:chain' }] }),
    manifest: guardManifest({ 'check:chain': 'pnpm check:foo' }),
  });
  assert(guardPaths(chained) === 'scripts/check-foo.mjs,scripts/helper.mjs', 'an alias that calls another alias is followed to the script at the end of the chain');
  const commented = judgeGuards({
    workflow: guardWorkflow({ steps: [{ name: 'Build', run: 'pnpm build' }, { name: 'Foo guard', run: '# pnpm check:baz\npnpm check:foo' }] }),
    manifest: guardManifest({ 'check:baz': 'node scripts/check-baz.mjs' }),
  });
  assert(guardPaths(commented) === 'scripts/check-foo.mjs,scripts/helper.mjs', 'a commented-out line inside a step runs nothing and requires nothing');
  const sharedRow = judgeGuards({ workflow: guardWorkflow({ steps: [...GUARD_STEPS, { name: 'A self-test', run: 'node scripts/a.mjs --self-test' }] }) });
  assert(
    !sharedRow.refusal && uncoveredGuards(sharedRow) === '' && (sharedRow.uncovered ?? ['x']).length === 0,
    'a guard that is also a declared build input is satisfied by its one literal row -- no duplicate is demanded',
  );

  // The reverse direction: the rows are held to the steps, not only the steps to the rows.
  const leftoverGuard = judgeGuards({ workflow: guardWorkflow({ core: [...GUARD_CORE, 'scripts/check-old.mjs'] }) });
  assert((leftoverGuard.stale ?? []).join(',') === 'scripts/check-old.mjs', 'a guard row whose step is gone is reported as a leftover');
  assert(
    (judgeGuards({ workflow: guardWorkflow({ steps: GUARD_STEPS.filter((s) => s.name !== 'Bar self-test') }) }).stale ?? []).join(',') === 'scripts/check-bar.mjs',
    '-- the same row reds the moment the step that ran it is deleted',
  );
  const guardOnlyDir = judgeGuards({
    workflow: guardWorkflow({
      core: [...GUARD_CORE, 'ops/scripts/check-z.mjs', 'ops/scripts/old.mjs'],
      steps: [...GUARD_STEPS, { name: 'Z guard', run: 'node ops/scripts/check-z.mjs' }],
    }),
  });
  assert(
    (guardOnlyDir.stale ?? []).join(',') === 'ops/scripts/old.mjs',
    '-- and a directory holding only a guard is judged for leftovers too, while the guard row itself is not one',
  );
  assert(
    /step "Ghost" runs scripts\/check-ghost\.mjs/.test(
      judgeGuards({ workflow: guardWorkflow({ steps: [...GUARD_STEPS, { name: 'Ghost', run: 'node scripts/check-ghost.mjs' }] }) }).refusal ?? '',
    ),
    'a step running a script whose closure cannot be computed => REFUSAL naming the step and the script',
  );

  // The real tree. The four guards the card names, and the self-test step
  // #21338 added, each reached from its own step and covered by a literal row.
  assert(
    !realBuild.refusal && uncoveredGuards(realBuild) === '' && (realBuild.guards ?? []).length > 0,
    `the checked-in core filter covers every script Build Core's steps run -- ${realBuild.refusal ?? uncoveredGuards(realBuild)}`,
  );
  for (const guard of [
    'scripts/check-dts-emitted.mjs',
    'scripts/check-dts-closure.mjs',
    'scripts/check-dual-build-cjs-loads.mjs',
    'scripts/check-sourcemap-no-sources-content.mjs',
    'scripts/check-lean-entry-closure.mjs',
  ]) {
    const row = (realBuild.guardsCovered ?? []).find((r) => r.path === guard);
    assert(
      row?.kind === 'literal' && row.from.some((f) => !f.startsWith('imported by ')),
      `a head touching only ${guard} schedules Build Core: a step runs it, and its own literal \`core\` row covers it`,
    );
  }
  assert(
    guardFrom(realBuild, 'scripts/population-floor.mjs').join(';') === 'imported by scripts/check-dual-build-cjs-loads.mjs' &&
      (realBuild.guardsCovered ?? []).some((r) => r.path === 'scripts/population-floor.mjs' && r.kind === 'literal'),
    'the module a guard imports and no build declares is required through the closure, and covered',
  );
  assert(
    !(realBuild.guards ?? []).some((r) => r.path === notABuildInput),
    `the control: ${notABuildInput} is no script a Build Core step runs either -- \`core\` stays a list of files`,
  );
  // The card's own instance (PR #17100): the lean-entry guard's row dropped.
  const droppedGuardReal = realSource.replace("              - 'scripts/check-lean-entry-closure.mjs'\n", '');
  assert(droppedGuardReal !== realSource, 'the real-tree guard drop found its anchor in the checked-in ci.yml');
  const droppedGuardVerdict = judgeBuildInputs(droppedGuardReal, readFileSync(join(REPO_ROOT, TURBO_CONFIG), 'utf8'), readFileSync(join(REPO_ROOT, ROOT_MANIFEST), 'utf8'));
  assert(
    uncoveredGuards(droppedGuardVerdict) === 'scripts/check-lean-entry-closure.mjs' && findingsOfBuild(droppedGuardVerdict).length === 0,
    'the checked-in ci.yml with the lean-entry guard row dropped reports exactly that guard, and nothing else',
  );
  assert(inScratchTree(droppedGuardReal, (root) => quietly(() => main(root, undefined, realUiReads))) === 1, '-- and main() returns 1 over it: the report path, not only `judgeBuildInputs`');

  // The two recognizer bounds the header states, pinned against the real job
  // so a change that makes either one bite reds here rather than going quiet.
  const realBuildJob = parse(realSource)?.jobs?.[BUILD_JOB] ?? {};
  const scopedRuns = (realBuildJob.steps ?? []).filter((s) => typeof s?.run === 'string' && /\bpnpm\s+(--filter|-F)\b/.test(s.run)).map((s) => s.run.trim());
  const specAnalyze = JSON.parse(readFileSync(join(REPO_ROOT, 'packages/spec/package.json'), 'utf8')).scripts?.analyze ?? '';
  assert(
    scopedRuns.join('|') === 'pnpm --filter @objectstack/spec analyze' && specAnalyze !== '' && !specAnalyze.includes('..'),
    `bound 1: Build Core's only package-scoped step is the spec's \`analyze\`, and that script stays inside packages/spec -- got ${JSON.stringify(scopedRuns)} running ${JSON.stringify(specAnalyze)}`,
  );
  const localActions = (realBuildJob.steps ?? []).map((s) => String(s?.uses ?? '')).filter((u) => u.startsWith('./'));
  // Its `run:` steps only, read the way `buildGuardsOf` reads the job's: the
  // action's description prose says "pnpm version", which is a root alias.
  const rootScripts = JSON.parse(readFileSync(join(REPO_ROOT, ROOT_MANIFEST), 'utf8')).scripts ?? {};
  const actionScripts = localActions.flatMap((u) => {
    const runs = (parse(readFileSync(join(REPO_ROOT, u, 'action.yml'), 'utf8'))?.runs?.steps ?? []).filter((s) => typeof s?.run === 'string');
    return runs.length === 0 ? ['(no run: step read)'] : runs.flatMap((s) => [...collectInvocations([{ name: u, text: s.run }], rootScripts).named.keys()]);
  });
  assert(
    localActions.length > 0 && actionScripts.length === 0,
    `bound 2: the local composite action(s) Build Core uses (${localActions.join(', ') || 'none found'}) run no repository script -- got ${actionScripts.join(', ') || 'none'}`,
  );

  // ── (11) Test Core and the generic test tasks' root inputs (#27961) ─────
  battery('(11) Test Core and the generic test tasks\' root inputs');
  const testTurbo = ({ tasks } = {}) =>
    JSON.stringify({
      tasks: tasks ?? {
        build: { inputs: ['$TURBO_DEFAULT$'] },
        test: { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/vitest.preset.mts', '$TURBO_ROOT$/ui/vitest.config.mts', '!$TURBO_ROOT$/ui/skip.mts'] },
        'test:repo': { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/scripts/repo-scan.mjs'] },
        '@objectstack/probe#test': { inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/docker/**'] },
      },
    });
  const testWorkflow = (core = ['packages/**', 'vitest.preset.mts', 'ui/vitest.config.mts'], condition) =>
    fixtureWorkflow({ core, crosspkg: ['scripts/**'], condition });
  const uncoveredTestPaths = (v) => (v.uncovered ?? ['(no verdict)']).map((r) => r.path ?? r);

  const testClean = judgeTestInputs(testWorkflow(), testTurbo());
  assert(!testClean.refusal && uncoveredTestPaths(testClean).length === 0, `positive control: the synthetic tree's test inputs are all covered -- ${testClean.refusal ?? uncoveredTestPaths(testClean).join(', ')}`);
  assert(
    (testClean.inputs ?? []).map((r) => r.path).sort().join(',') === 'scripts/repo-scan.mjs,ui/vitest.config.mts,vitest.preset.mts',
    '-- the population is the `test` and `test:repo` root inputs: a package task\'s input and a negated input are not in it',
  );
  assert(
    testClean.covered?.find((r) => r.path === 'scripts/repo-scan.mjs')?.via === 'scripts/**',
    '-- an input `crosspkg` covers is covered: the `test` job ORs both lists',
  );

  // THE HOLE the card reads: a generic test input neither list covers.
  const testDropped = judgeTestInputs(testWorkflow(['packages/**', 'vitest.preset.mts']), testTurbo());
  assert(
    uncoveredTestPaths(testDropped).join(',') === 'ui/vitest.config.mts' && testDropped.uncovered[0].from.join(',') === 'test',
    `a \`test\` root input dropped from \`core\` is reported by path and task -- got ${uncoveredTestPaths(testDropped).join(', ')}`,
  );
  const repoDropped = judgeTestInputs(testWorkflow(), testTurbo({ tasks: { test: { inputs: [] }, 'test:repo': { inputs: ['$TURBO_ROOT$/tools/scan.mjs'] } } }));
  assert(
    uncoveredTestPaths(repoDropped).join(',') === 'tools/scan.mjs' && repoDropped.uncovered[0].from.join(',') === 'test:repo',
    `-- and so is a \`test:repo\` root input under a root no list names -- got ${uncoveredTestPaths(repoDropped).join(', ')}`,
  );
  assert(quietly(() => reportTestInputs(testDropped)) === 1 && quietly(() => reportTestInputs(testClean)) === 0, '-- and the report path returns 1 over the hole and 0 over the clean tree');

  // Refusals: never a clean zero over a subject that was not read.
  const testRefusal = (v) => typeof v.refusal === 'string' && v.refusal.length > 0;
  assert(testRefusal(judgeTestInputs(testWorkflow(), null)), 'refuses when turbo.json could not be read');
  assert(testRefusal(judgeTestInputs(testWorkflow(), '{ not json')), 'refuses when turbo.json is not JSON');
  assert(testRefusal(judgeTestInputs(testWorkflow(), JSON.stringify({}))), 'refuses when turbo.json declares no `tasks` map');
  assert(testRefusal(judgeTestInputs(testWorkflow(), testTurbo({ tasks: { build: {} } }))), 'refuses when turbo.json declares no generic `test` task');
  assert(
    testRefusal(judgeTestInputs(testWorkflow(undefined, "${{ !cancelled() && needs.filter.outputs.core != 'false' }}"), testTurbo())),
    'refuses when the `test` job\'s `if:` stops naming `crosspkg`, as the first subject does',
  );

  // The population is a REASON for the third subject's leftover rule: a literal
  // `core` row beside a build input that covers a test input is not a leftover.
  const leftoverTurbo = (testInputs) =>
    JSON.stringify({
      tasks: {
        build: { inputs: ['$TURBO_ROOT$/ui/tsconfig.json'] },
        test: { inputs: testInputs },
      },
    });
  const leftoverCore = ['packages/**', 'turbo.json', 'ui/tsconfig.json', 'ui/vitest.config.mts'];
  const withTestReason = judgeBuildInputs(buildWorkflow({ core: leftoverCore }), leftoverTurbo(['$TURBO_ROOT$/ui/vitest.config.mts']), manifestFixture('turbo run build'));
  assert(!withTestReason.refusal && (withTestReason.stale ?? ['(no verdict)']).length === 0, `a literal \`core\` row beside a build input that covers a test input is no leftover -- got ${withTestReason.refusal ?? withTestReason.stale.join(', ')}`);
  const withoutTestReason = judgeBuildInputs(buildWorkflow({ core: leftoverCore }), leftoverTurbo([]), manifestFixture('turbo run build'));
  assert((withoutTestReason.stale ?? []).join(',') === 'ui/vitest.config.mts', '-- and the same row IS one once turbo.json stops declaring that test input');

  // The real tree: clean, and the five #27961 rows are what makes it so.
  const realTurbo = readFileSync(join(REPO_ROOT, TURBO_CONFIG), 'utf8');
  const realTest = judgeTestInputs(realSource, realTurbo);
  assert(!realTest.refusal && uncoveredTestPaths(realTest).length === 0, `the checked-in tree's generic test inputs are all covered -- ${realTest.refusal ?? uncoveredTestPaths(realTest).join(', ')}`);
  const TEST_ROWS = ['ui/vitest.config.mts', 'ui/vitest.setup.*', 'ui/scripts/test-shard-*', 'ui/apps/console/vitest.config.ts', 'ui/apps/console/vite.config.ts'];
  let testRowsDropped = realSource;
  for (const row of TEST_ROWS) testRowsDropped = testRowsDropped.replace(`              - '${row}'\n`, '');
  assert(
    TEST_ROWS.every((row) => !testRowsDropped.includes(`              - '${row}'\n`)) && TEST_ROWS.every((row) => realSource.includes(`              - '${row}'\n`)),
    'the real-tree rollback found all five #27961 rows in the checked-in ci.yml and removed them',
  );
  assert(
    uncoveredTestPaths(judgeTestInputs(testRowsDropped, realTurbo)).sort().join(',') === [...TEST_ROWS].sort().join(','),
    'the checked-in ci.yml with the five #27961 rows dropped reports exactly those five, and nothing else',
  );
  assert(inScratchTree(testRowsDropped, (root) => quietly(() => main(root, undefined, realUiReads))) === 1, '-- and main() returns 1 over it: the report path, not only `judgeTestInputs`');

  // The bound the header states: TEST_TASKS is the pair the real job runs.
  const realTestRuns = (parse(realSource)?.jobs?.[SCHEDULED_JOB]?.steps ?? []).map((s) => String(s?.run ?? ''));
  const turboTaskLists = realTestRuns.flatMap((r) => [...r.matchAll(/pnpm turbo run (test(?::[\w-]+)?(?:\s+[a-z][\w:-]*)*)\s+\$FILTERS/g)].map((m) => m[1].trim()));
  assert(
    turboTaskLists.length > 0 && turboTaskLists.every((t) => t === TEST_TASKS.join(' ')),
    `bound: every whole-package test \`turbo run\` the real \`${SCHEDULED_JOB}\` job makes names exactly ${TEST_TASKS.join(' ')} -- got ${JSON.stringify(turboTaskLists)}`,
  );

  // ── (12) Test UI and the files outside ui/ that ui tests read (#37935) ──────────
  battery('(12) Test UI and the files outside ui/ that ui tests read');
  const UI_IF =
    "${{ !cancelled() && needs.filter.outputs.ui_tree != 'false' && (needs.filter.outputs.ui != 'false' || needs.filter.outputs.ui_consumers != 'false') }}";
  // The `ui` list's first row is the tree; every later row sits under the
  // reads-group heading, followed by the trade-off lines, as in the real file.
  const uiWorkflow = ({ ui = ['ui/**'], consumers = ['packages/spec/**'], condition = UI_IF, job = 'test-ui', tradeOffs = [], heading = true } = {}) => {
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
      '            ui:',
      list(ui.slice(0, 1)),
      ...(heading ? [`              # ── ${UI_READS_GROUP_MARKER} ──`, `              # prose naming \`${UI_TRADE_OFF_MARKER}\` declares nothing`] : []),
      ...(ui.length > 1 ? [list(ui.slice(1))] : []),
      ...tradeOffs.map((t) => `              # ${UI_TRADE_OFF_MARKER} ${t}`),
      '            ui_consumers:',
      list(consumers),
      `  ${job}:`,
      `    if: ${JSON.stringify(condition)}`,
      '    steps:',
      '      - run: echo test',
    ].join('\n');
  };
  // A scratch tree of ui tests, read by the real collector: the walker, not a
  // hand-built row, is what turns each spelling into a path.
  const ADR_A = ['docs', 'adr', '0001-a.md'].join('/');
  const uiScratch = (files, fn) => {
    const scratch = mkdtempSync(join(tmpdir(), 'ci-filter-parity-ui-'));
    try {
      for (const [rel, text] of Object.entries(files)) {
        mkdirSync(dirname(join(scratch, rel)), { recursive: true });
        writeFileSync(join(scratch, rel), text);
      }
      return fn(uiRootReadsOf(scratch, Object.keys(files)));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  const UI_SEED = "import { readFileSync, readdirSync } from 'node:fs';\nimport { dirname, resolve } from 'node:path';\nimport { fileURLToPath } from 'node:url';\nconst HERE = dirname(fileURLToPath(import.meta.url));\n";
  const fileReader = `${UI_SEED}const ADR = resolve(HERE, '../../../../${ADR_A}');\nreadFileSync(ADR, 'utf8');\n`;
  const dirReader = `${UI_SEED}readdirSync(resolve(HERE, '../../../../docs/adr'));\n`;
  const ownAdrReader = `${UI_SEED}readFileSync(resolve(HERE, '../../docs/adr/0002-own.md'), 'utf8');\n`;
  const uiPaths = (rows) => (rows ?? ['(no verdict)']).map((r) => r.path ?? r);

  const ADR_ON_DISK = { [ADR_A]: '# 0001\n' };
  const uiReadsFx = uiScratch(
    {
      ...ADR_ON_DISK,
      'ui/packages/p/src/a.test.ts': fileReader,
      'ui/packages/p/src/own.test.ts': ownAdrReader,
      'ui/packages/p/src/plain.ts': fileReader,
    },
    (r) => r,
  );
  assert(
    !uiReadsFx.refusal && uiReadsFx.tests === 2 && uiPaths(uiReadsFx.rows).join(',') === ADR_A && uiReadsFx.rows[0].from.join(',') === 'ui/packages/p/src/a.test.ts',
    `the collector finds a ui test's root ADR read through the shared walker, and neither the ui tree's own ADR nor a non-test file -- got ${uiReadsFx.refusal ?? JSON.stringify(uiReadsFx.rows)}`,
  );
  const uiCovered = judgeUiReads(uiWorkflow({ ui: ['ui/**', ADR_A] }), uiReadsFx);
  assert(!uiCovered.refusal && uiCovered.uncovered.length === 0 && uiCovered.stale.length === 0, `positive control: the read named verbatim in \`ui\` is covered -- ${uiCovered.refusal ?? uiPaths(uiCovered.uncovered).join(', ')}`);
  assert(judgeUiReads(uiWorkflow({ ui: ['ui/**', 'docs/adr/**'] }), uiReadsFx).uncovered?.length === 0, '-- and so is it by the `docs/adr/**` subtree');
  assert(judgeUiReads(uiWorkflow({ consumers: [ADR_A] }), uiReadsFx).uncovered?.length === 0, '-- and by `ui_consumers`, which the job ORs');

  // THE HOLE the card reads: the ADR a ui test reads, in no list.
  const uiHole = judgeUiReads(uiWorkflow(), uiReadsFx);
  assert(uiPaths(uiHole.uncovered).join(',') === ADR_A, `a ui test's root ADR read no list covers is reported by path -- got ${uiPaths(uiHole.uncovered).join(', ')}`);
  assert(judgeUiReads(uiWorkflow({ ui: ['ui/**', 'docs/**/0001-a.md'] }), uiReadsFx).uncovered?.length === 1, '-- and a wildcard row covers nothing by the pure-string rule, the bound the first subject states');
  assert(quietly(() => reportUiReads(uiHole)) === 1 && quietly(() => reportUiReads(uiCovered)) === 0, '-- and the report path returns 1 over the hole and 0 over the clean tree');

  // A directory read needs the subtree: a sibling file row is not coverage.
  const uiDirReads = uiScratch({ ...ADR_ON_DISK, 'ui/packages/p/src/d.test.ts': dirReader }, (r) => r);
  assert(
    uiPaths(uiDirReads.rows).join(',') === 'docs/adr' &&
      judgeUiReads(uiWorkflow({ ui: ['ui/**', ADR_A] }), uiDirReads).uncovered?.length === 1 &&
      judgeUiReads(uiWorkflow({ ui: ['ui/**', 'docs/adr/**'] }), uiDirReads).uncovered?.length === 0,
    `a ui test listing \`docs/adr\` is covered by \`docs/adr/**\` alone -- got ${JSON.stringify(uiDirReads.rows)}`,
  );

  // A directory BOUND to a name and then listed: the walker puts every bound
  // name in `files`, so the name sits in both sets and only the disk says it is
  // a directory. Read as a file row, a literal `docs/adr` row would pass while
  // matching no changed file.
  const boundDirReader = `${UI_SEED}const ADR_DIR = resolve(HERE, '../../../../docs/adr');\nreaddirSync(ADR_DIR);\n`;
  const uiBoundDir = uiScratch({ ...ADR_ON_DISK, 'ui/packages/p/src/b.test.ts': boundDirReader }, (r) => r);
  assert(
    uiPaths(uiBoundDir.rows).join(',') === 'docs/adr' && uiBoundDir.rows[0].kind === 'dir' &&
      judgeUiReads(uiWorkflow({ ui: ['ui/**', 'docs/adr'] }), uiBoundDir).uncovered?.length === 1 &&
      judgeUiReads(uiWorkflow({ ui: ['ui/**', 'docs/adr/**'] }), uiBoundDir).uncovered?.length === 0,
    `a bound-then-listed directory read is classified as a directory, covered by \`docs/adr/**\` and not by a literal \`docs/adr\` row -- got ${JSON.stringify(uiBoundDir.rows)}`,
  );
  // A spelled path naming nothing on disk is a synthetic fixture path, not a read.
  const uiSynthetic = uiScratch({ 'ui/packages/p/src/a.test.ts': fileReader }, (r) => r);
  assert(!uiSynthetic.refusal && uiSynthetic.rows.length === 0, `a ui test naming an ADR that is not on disk reads nothing -- got ${JSON.stringify(uiSynthetic.rows)}`);

  // The reverse direction: a `ui` row under the root whose reader is gone.
  const uiStale = judgeUiReads(uiWorkflow({ ui: ['ui/**', ADR_A, 'docs/adr/0009-gone.md'] }), uiReadsFx);
  assert((uiStale.stale ?? []).join(',') === 'docs/adr/0009-gone.md', `a \`ui\` row under docs/adr that no ui test reads is a leftover -- got ${(uiStale.stale ?? []).join(', ')}`);
  assert(quietly(() => reportUiReads(uiStale)) === 1, '-- and the report path returns 1 over it');

  // Refusals: never a clean zero over a subject that was not read.
  const uiRefusal = (v) => typeof v.refusal === 'string' && v.refusal.length > 0;
  assert(uiRefusal(uiScratch({ 'ui/packages/p/src/plain.ts': fileReader }, (r) => r)), 'refuses when no ui test file is tracked');
  assert(uiRefusal(judgeUiReads(uiWorkflow({ job: 'test-ui-renamed' }), uiReadsFx)), 'refuses when ci.yml has no `test-ui` job');
  assert(
    uiRefusal(judgeUiReads(uiWorkflow({ condition: "${{ !cancelled() && needs.filter.outputs.ui_consumers != 'false' && needs.filter.outputs.ui_tree != 'false' }}" }), uiReadsFx)),
    'refuses when the `test-ui` job\'s `if:` stops naming `ui` -- `ui_consumers` and `ui_tree` do not count as it',
  );
  assert(uiRefusal(judgeUiReads(uiWorkflow(), null)) && uiRefusal(judgeUiReads(uiWorkflow(), { refusal: 'x' })), 'refuses when the reads were not supplied or were refused');

  // The real tree: clean, and the #37935 row is what makes it so.
  const ADR_0084_ROW = "              - 'docs/adr/0084-application-builder-information-architecture.md'\n";
  const realUi = judgeUiReads(realSource, realUiReads);
  assert(
    !realUi.refusal && realUi.uncovered.length === 0 && realUi.stale.length === 0 &&
      (realUi.named ?? []).join(',') === UI_SCHEDULING_FILTERS.join(','),
    `the checked-in tree's root ADR reads by ui tests are all covered, against both lists the real \`if:\` ORs -- ${realUi.refusal ?? uiPaths(realUi.uncovered).join(', ')}`,
  );
  const uiRowDropped = realSource.replace(ADR_0084_ROW, '');
  assert(realSource.includes(ADR_0084_ROW) && !uiRowDropped.includes(ADR_0084_ROW), 'the real-tree rollback found the #37935 row in the checked-in ci.yml and removed it');
  assert(
    uiPaths(judgeUiReads(uiRowDropped, realUiReads).uncovered).join(',') === 'docs/adr/0084-application-builder-information-architecture.md',
    'the checked-in ci.yml with the #37935 row dropped reports exactly ADR-0084, and nothing else',
  );
  assert(inScratchTree(uiRowDropped, (root) => quietly(() => main(root, undefined, realUiReads))) === 1, '-- and main() returns 1 over it: the report path, not only `judgeUiReads`');

  // #38133: the population is every read outside ui/, not the root docs/adr.
  // A root document and an extensionless import of a server source, each
  // found by the walker and resolved on disk.
  const ROOT_DOC = ['CONTRIBUTING', 'md'].join('.');
  const SERVER_SRC = ['packages', 'srv', 'src', 'endpoint.ts'].join('/');
  const wideReader =
    `${UI_SEED}import { columns } from '../../../../packages/srv/src/endpoint';\n` +
    `readFileSync(resolve(HERE, '../../../../${ROOT_DOC}'), 'utf8');\n`;
  const uiWide = uiScratch(
    { [ROOT_DOC]: '# contributing\n', [SERVER_SRC]: 'export const columns = [];\n', 'ui/packages/p/src/w.test.ts': wideReader },
    (r) => r,
  );
  assert(
    uiPaths(uiWide.rows).join(',') === [ROOT_DOC, SERVER_SRC].join(','),
    `the collector finds a root document and an extensionless import of a server source, both outside ui/ -- got ${JSON.stringify(uiWide.rows)}`,
  );
  const wideHole = judgeUiReads(uiWorkflow(), uiWide);
  assert(uiPaths(wideHole.uncovered).join(',') === [ROOT_DOC, SERVER_SRC].join(','), `-- and both are reported uncovered with no row -- got ${uiPaths(wideHole.uncovered).join(', ')}`);
  const wideRows = judgeUiReads(uiWorkflow({ ui: ['ui/**', ROOT_DOC, SERVER_SRC] }), uiWide);
  assert(wideRows.uncovered?.length === 0 && wideRows.stale?.length === 0, `positive control: each named verbatim in the reads group is covered -- ${wideRows.refusal ?? uiPaths(wideRows.uncovered).join(', ')}`);
  assert(judgeUiReads(uiWorkflow({ consumers: ['packages/srv/**'], ui: ['ui/**', ROOT_DOC] }), uiWide).uncovered?.length === 0, '-- and a server source under a `ui_consumers` subtree is covered by it');

  // A declared trade-off: the read stays unscheduled and the gate stays green.
  const traded = judgeUiReads(uiWorkflow({ ui: ['ui/**', ROOT_DOC], tradeOffs: [`${SERVER_SRC} -- its server twin runs in Test Core`] }), uiWide);
  assert(
    traded.uncovered?.length === 0 && uiPaths(traded.tradedOff).join(',') === SERVER_SRC && traded.staleTradeOffs?.length === 0 && quietly(() => reportUiReads(traded)) === 0,
    `a read declared as a trade-off is neither uncovered nor stale, and the report path returns 0 -- got ${traded.refusal ?? JSON.stringify(traded.uncovered)}`,
  );
  const tradeGone = judgeUiReads(uiWorkflow({ ui: ['ui/**', ROOT_DOC, SERVER_SRC], tradeOffs: [`${SERVER_SRC} -- covered now`, 'packages/none/x.ts -- nobody reads it'] }), uiWide);
  assert(
    (tradeGone.staleTradeOffs ?? []).join(',') === [SERVER_SRC, 'packages/none/x.ts'].join(',') && quietly(() => reportUiReads(tradeGone)) === 1,
    `a trade-off a row covers, and one for a read no test makes, are both stale and red -- got ${(tradeGone.staleTradeOffs ?? []).join(', ')}`,
  );
  assert(uiRefusal(judgeUiReads(uiWorkflow({ ui: ['ui/**', ROOT_DOC], tradeOffs: [SERVER_SRC] }), uiWide)), 'refuses a trade-off line with no `-- REASON`');
  assert(uiRefusal(judgeUiReads(uiWorkflow({ heading: false, ui: ['ui/**', ROOT_DOC] }), uiWide)), 'refuses when the `ui` list carries no reads-group heading');
  // A row ABOVE the heading is a job input, not a read, and is never a leftover.
  const aboveHeading = judgeUiReads(uiWorkflow({ ui: ['pnpm-lock.yaml', ROOT_DOC, SERVER_SRC] }), uiWide);
  assert(aboveHeading.stale?.length === 0, `a reader-less row above the heading is not judged as a leftover -- got ${(aboveHeading.stale ?? []).join(', ')}`);

  // The real tree: each #38133 row and the declared trade-off, rolled back.
  for (const [row, path] of [
    ["              - 'CONTRIBUTING.md'\n", 'CONTRIBUTING.md'],
    ["              - 'packages/plugins/plugin-auth/src/admin-import-users.ts'\n", 'packages/plugins/plugin-auth/src/admin-import-users.ts'],
    ["              - 'scripts/ci-shard-matrix.mjs'\n", 'scripts/ci-shard-matrix.mjs'],
  ]) {
    const dropped = realSource.replace(row, '');
    assert(
      realSource.includes(row) && uiPaths(judgeUiReads(dropped, realUiReads).uncovered).join(',') === path,
      `the checked-in ci.yml with the #38133 row for ${path} dropped reports exactly that path`,
    );
  }
  const TRADE_LINE = `              # ${UI_TRADE_OFF_MARKER} packages/mcp/src/skill-md.ts -- the\n`;
  const tradeDropped = realSource.replace(TRADE_LINE, '');
  assert(
    realSource.includes(TRADE_LINE) && uiPaths(judgeUiReads(tradeDropped, realUiReads).uncovered).join(',') === 'packages/mcp/src/skill-md.ts',
    'the checked-in ci.yml with its declared trade-off line dropped reports packages/mcp/src/skill-md.ts uncovered',
  );

  // ── (13) the ui scheduling pin (#38132) ─────────────────────────────────
  battery('(13) the ui scheduling pin: the paths-filter input, the ui outputs, the ui rows and every ui job condition');
  const realPin = readPin(REPO_ROOT);
  const pinOf = (source, pin = realPin) => judgeUiScheduling(source, pin);
  const pinRed = (v) =>
    !v.refusal &&
    v.extraInputs.length + v.missingInputs.length + v.changedOutputs.length + v.missingRows.length + v.unpinnedJobs.length + v.vanishedJobs.length + v.narrowedJobs.length > 0;
  const realPinVerdict = pinOf(realSource);
  assert(
    !realPinVerdict.refusal && !pinRed(realPinVerdict) && realPinVerdict.uiJobs.length === Object.keys(realPin.conditions).length && realPinVerdict.uiJobs.includes(UI_TEST_JOB),
    `positive control: the checked-in ci.yml holds its pin, and every job reading a ui output is pinned -- ${realPinVerdict.refusal ?? JSON.stringify(realPinVerdict)}`,
  );
  assert(quietly(() => reportUiScheduling(realPinVerdict)) === 0, '-- and the report path returns 0 over it');

  // The CNF reading of a condition, and the at-least-as-wide relation.
  assert(
    JSON.stringify(conditionClauses("${{ !cancelled() && (a != 'false' || b != 'false') && c }}")) === JSON.stringify([['!cancelled()'], ["a != 'false'", "b != 'false'"], ['c']]),
    'a condition reads as clauses of a conjunction, each the set of its disjuncts, the `${{ }}` wrapper dropped',
  );
  assert(conditionAtLeast("x && (a || b || c)", "x && (a || b) && y").holds, 'dropping a clause or adding a disjunct is at least as wide');
  assert(!conditionAtLeast("x && (a || b) && z", "x && (a || b)").holds, 'adding a clause is narrower');
  assert(!conditionAtLeast("x && a", "x && (a || b)").holds, 'dropping a disjunct is narrower');
  assert(!conditionAtLeast("x && a == 'false'", "x && a != 'false'").holds, 'changing an atom is narrower (syntactic: never a silent pass)');
  assert(conditionAtLeast("(x) && ( a  ||  b )", "x && (b || a)").holds, 'whitespace, order and redundant parentheses do not matter');

  // Each pinned part ablated on the REAL ci.yml.
  const FILTERS_LINE = '        with:\n          filters: |\n';
  assert(realSource.split(FILTERS_LINE).length === 2, 'the real paths-filter step carries one `with:` block that opens with `filters:`');
  const inputAdded = realSource.replace(FILTERS_LINE, "        with:\n          predicate-quantifier: 'every'\n          filters: |\n");
  const inputVerdict = pinOf(inputAdded);
  assert((inputVerdict.extraInputs ?? []).join(',') === 'predicate-quantifier', `a \`with:\` input added to the paths-filter step reds by name -- got ${JSON.stringify(inputVerdict.extraInputs)}`);
  assert(inScratchTree(inputAdded, (root) => quietly(() => main(root, undefined, realUiReads))) === 1, '-- and main() returns 1 over it, the pin read from the scratch tree');

  const UI_OUTPUT_LINE = "      ui: ${{ steps.changes.outputs.ui || 'true' }}\n";
  assert(realSource.includes(UI_OUTPUT_LINE), 'the real `filter` job carries the pinned `ui` output line');
  const outputNarrowed = pinOf(realSource.replace(UI_OUTPUT_LINE, "      ui: ${{ steps.changes.outputs.ui || 'false' }}\n"));
  assert((outputNarrowed.changedOutputs ?? []).map((o) => o.name).join(',') === 'ui', `the \`ui\` output rewritten reds by name -- got ${JSON.stringify(outputNarrowed.changedOutputs)}`);

  const UI_TREE_ROW = "              - 'ui/**'\n";
  const SPEC_ROW = "              - 'packages/spec/**'\n";
  assert(realSource.split(UI_TREE_ROW).length === 2 && realSource.split(SPEC_ROW).length === 2, 'the real ci.yml carries the `ui/**` and `packages/spec/**` rows once each');
  const rowsDropped = pinOf(realSource.replace(UI_TREE_ROW, '').replace(SPEC_ROW, ''));
  assert(
    (rowsDropped.missingRows ?? []).map((r) => `${r.name}:${r.row}`).join(',') === 'ui:ui/**,ui_consumers:packages/spec/**',
    `a pinned \`ui\` row and a pinned \`ui_consumers\` row dropped red by list and row -- got ${JSON.stringify(rowsDropped.missingRows)}`,
  );
  assert(!pinRed(pinOf(realSource.replace(UI_TREE_ROW, `${UI_TREE_ROW}              - 'extra/**'\n`))), 'control: a row ADDED to `ui` widens and stays green');

  const TEST_UI_IF = `    if: \${{ ${realPin.conditions[UI_TEST_JOB]} }}\n`;
  assert(realSource.includes(TEST_UI_IF), 'the real `test-ui` job carries its pinned `if:` verbatim');
  const ifTo = (replacement) => pinOf(realSource.replace(TEST_UI_IF, `    if: \${{ ${replacement} }}\n`));
  const narrowedIds = (v) => (v.narrowedJobs ?? []).map((j) => j.id).join(',');
  const pinnedTestUi = realPin.conditions[UI_TEST_JOB];
  assert(narrowedIds(ifTo(`${pinnedTestUi} && github.event_name != 'pull_request'`)) === UI_TEST_JOB, 'a conjunct added to `test-ui` reds it by job');
  assert(narrowedIds(ifTo(pinnedTestUi.replace(" || needs.filter.outputs.ui_consumers != 'false'", ''))) === UI_TEST_JOB, '-- and so does dropping its `ui_consumers` disjunct');
  assert(narrowedIds(ifTo(pinnedTestUi.replace("needs.filter.outputs.ui != 'false'", "needs.filter.outputs.ui == 'true'"))) === UI_TEST_JOB, '-- and so does rewriting its `ui` atom');
  const ifWidened = ifTo(pinnedTestUi.replace(" && needs.test-ui-plan.outputs.shards != '[]'", ''));
  assert(!pinRed(ifWidened) && (ifWidened.widenedJobs ?? []).join(',') === UI_TEST_JOB, 'control: a conjunct DROPPED widens, stays green, and is reported as wider than the pin');

  const newUiJob = `${realSource}\n  probe-ui:\n    needs: filter\n    if: \${{ needs.filter.outputs.ui != 'false' }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo probe\n`;
  assert((pinOf(newUiJob).unpinnedJobs ?? []).join(',') === 'probe-ui', 'a new job reading a ui output with no pinned condition reds by name');
  const LINT_UI_KEY = '\n  lint-ui:\n';
  assert(realSource.split(LINT_UI_KEY).length === 2, 'the real ci.yml carries the `lint-ui` job key once');
  assert((pinOf(realSource.replace(LINT_UI_KEY, '\n  lint-ui-renamed:\n')).vanishedJobs ?? []).join(',') === 'lint-ui', 'a pinned ui job renamed away reds as vanished (and its new name as unpinned)');
  assert(quietly(() => reportUiScheduling(ifTo(`${pinnedTestUi} && false`))) === 1, 'the report path returns 1 over a narrowed condition');

  // Refusals: a pin that cannot be read is never a clean zero.
  const refusesPin = (pin) => typeof pinOf(realSource, pin).refusal === 'string';
  assert(refusesPin(null) && refusesPin([]) && refusesPin({}), 'refuses a missing, non-object or empty pin');
  assert(refusesPin({ ...realPin, inputs: [] }), 'refuses a pin with no inputs');
  assert(refusesPin({ ...realPin, conditions: {} }), 'refuses a pin with no conditions');
  const { ui: _droppedUi, ...outputsWithoutUi } = realPin.outputs;
  assert(refusesPin({ ...realPin, outputs: outputsWithoutUi }), 'refuses a pin that pins no `ui` output');
  assert(inScratchTree(realSource, (root) => { rmSync(join(root, UI_PIN_FILE)); return quietly(() => main(root, undefined, realUiReads)); }) === 1, 'main() returns 1 when the pin file is absent from the tree');

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
      `pre-#10015 rollback uncovering the ten it fixed plus #10848's one plus #10178's two plus #12201's one plus #12924's one plus #14561's one plus #14824's three plus #15818's two plus #18650's one plus #29972's one plus #30289's one plus #31017's one plus #31729's one plus #34920's one, minus the three under the \`skills/**\` build input \`core\` now covers, ` +
      `and the CI wiring read out of lint.yml; ` +
      `and Build Core's build inputs: a build input dropped from \`core\` observed red by path and declaring task, ` +
      `turbo.json itself, a globalDependencies entry and a new-root input each required, test-task and negated inputs ` +
      `and the excluded docs build left out until the build script stops excluding it, a leftover literal entry, ` +
      `ten refusals, and the checked-in tree green with one input dropped observed red through the report path; ` +
      `and the scripts Build Core's own steps run: a guard row dropped from \`core\` and a guard step added with no ` +
      `row each observed red by path and step, through an alias, an alias chain, a direct path and an import, a ` +
      `commented-out line requiring nothing, a row whose step is gone reported as a leftover, an unresolvable ` +
      `script refused, the five real guards and the imported population-floor covered by their own rows, the ` +
      `lean-entry row dropped observed red through the report path, and both recognizer bounds pinned to the real job; ` +
      `and Test Core's generic test inputs: a \`test\` and a \`test:repo\` root input each observed red by path and task, ` +
      `one covered only by \`crosspkg\`, package-task and negated inputs left out, five refusals, a test input keeping a ` +
      `\`core\` row beside a build input from reading as a leftover, the checked-in tree green with the five #27961 rows ` +
      `dropped observed red through the report path, and the task pair pinned to the real job; ` +
      `and Test UI's root ADR reads: a ui test's ADR read found through the shared walker and observed red by path, ` +
      `covered verbatim, by its subtree and by \`ui_consumers\`, a directory read needing its subtree, a bound-then-listed directory classified as one, a path not on disk read as nothing, a wildcard row ` +
      `covering nothing, a reader-less row reported as a leftover, five refusals, and the checked-in tree green with ` +
      `the #37935 row dropped observed red through the report path, generalised to every read outside ui/ (a root ` +
      `document and an extensionless server import found, covered by a row or by \`ui_consumers\`, a declared trade-off ` +
      `green, a stale or redundant trade-off red, a malformed one and a missing heading refused, a row above the heading ` +
      `never a leftover, and each #38133 row and the trade-off rolled back off the real tree observed red); ` +
      `and the ui scheduling pin: the real tree green against it, the condition clauses and their at-least-as-wide ` +
      `relation, and on the real ci.yml a paths-filter input added, the \`ui\` output rewritten, a \`ui\` and a ` +
      `\`ui_consumers\` row dropped, a \`test-ui\` conjunct added, a disjunct dropped and an atom rewritten each observed ` +
      `red, a row added and a conjunct dropped observed green, a new unpinned ui job and a renamed pinned one red, ` +
      `five pin refusals, and main() red over a missing pin file.`,
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
