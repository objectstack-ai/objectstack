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
 * `CROSS_PACKAGE_TEST_INPUTS` is imported from the sibling gate, which exports it
 * for this purpose. A copy here would be a second list of the declarations kept
 * in step by hand -- exactly the defect this gate exists to close, one file
 * further out. Importing that module runs nothing: its dispatch is behind
 * `isEntrypoint`, and its own `--self-test` spawns a real child to pin that.
 *
 * ## Wiring
 *
 * Invoked from `.github/workflows/lint.yml` as `node scripts/...` directly, both
 * legs, rather than through a `pnpm check:*` alias: that alias belongs in root
 * `package.json`, declared territory of the @changesets/cli v3 migration lane
 * (#9465) while it runs. The self-test asserts that wiring against the workflow
 * text -- a gate that exists and is not scheduled is the same dormant shape from
 * the other side.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { parse } from 'yaml';

import { CROSS_PACKAGE_TEST_INPUTS } from './check-cross-package-test-inputs.mjs';
import { isEntrypoint } from './invoked-as.mjs';

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
  return report(judge(source, table));
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
  return verdict.uncovered.length > 0 ? 1 : 0;
}

// ── self-test ────────────────────────────────────────────────────────────────
//
// Both directions, on fixtures this file builds, plus the real tree. The cases
// that matter most are the two a cheaper rule gets wrong: a declaration whose
// ROOT is present in a scheduling list through a DIFFERENT FILE
// (`.github/workflows/ci.yml` is in `core`; `.github/workflows/scaffold-e2e.yml`
// is a different file and must be named), and a declaration under a root that
// appears nowhere at all.

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

export async function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (cond, label) => {
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
  const stale = judge(fixtureWorkflow({ crosspkg: ['scripts/**', 'tools/**'] }), table(['scripts/x.mjs']));
  assert(stale.stale.join(',') === 'tools/**', 'a `crosspkg` entry that covers no declaration is reported stale');
  assert(uncoveredGlobs(stale).length === 0, '-- while the declaration it does cover stays covered');
  const notStale = judge(fixtureWorkflow({ crosspkg: ['content/**'] }), table(['content/docs/x.mdx']));
  assert(notStale.stale.length === 0, 'an entry covering a declaration through the SUBTREE limb is not stale');

  // ── (5) refusals: never a clean zero over a subject that was not read ────
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
  // ever covered (the retirement skill's SKILL.md, a `.claude/` literal), so
  // the rollback now uncovers eleven. This pin is judged over the LIVE
  // declaration table on purpose: a declaration added under a root the
  // rollback keeps leaves the count alone, one under a new root moves it and
  // is recorded here by name.
  const preFix = judge(fixtureWorkflow({ core: real.filters?.core, crosspkg: ['scripts/**'] }), CROSS_PACKAGE_TEST_INPUTS);
  assert(
    new Set(uncoveredGlobs(preFix)).size === 11,
    `rolling \`crosspkg\` back to its pre-#10015 list uncovers the ten it fixed plus #10848's one -- got ${new Set(uncoveredGlobs(preFix)).size}`,
  );
  assert(
    uncoveredGlobs(preFix).includes('.claude/skills/spec-property-retirement/SKILL.md'),
    `-- and the post-#10015 member is #10848's declaration, by name`,
  );

  // ── (7) WIRING: the gate and its self-test really run in CI ──────────────
  const SELF = 'scripts/check-ci-filter-parity.mjs';
  let lint = null;
  try {
    lint = readFileSync(join(REPO_ROOT, '.github/workflows/lint.yml'), 'utf8');
  } catch (err) {
    failures.push(`cannot read .github/workflows/lint.yml to verify wiring: ${err?.code ?? err?.message}`);
  }
  if (lint !== null) {
    assert(lint.includes(`node ${SELF}\n`), `wiring: lint.yml invokes ${SELF} (no root package.json alias -- #9465 fence)`);
    assert(lint.includes(`node ${SELF} --self-test`), 'wiring: lint.yml runs the --self-test leg too');
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
      `pre-#10015 rollback uncovering the ten it fixed plus #10848's one, and the CI wiring read out of lint.yml.`,
  );
  return 0;
}

// The CLI dispatch is guarded so that IMPORTING this module is inert: the
// judging functions are exported so another workflow source can be judged, and
// a module that ran its gate on import would print a verdict about this repo
// into an importer's stdout and hand it this gate's exit status
// (`check:entry-guard`; the sibling gate's header records what that cost).
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(await selfTest());
  if (process.argv.includes('--list')) process.exit(list());
  process.exit(main());
}
