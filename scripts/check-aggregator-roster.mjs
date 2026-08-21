#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-aggregator-roster (#10490) -- an aggregate gate's `needs:` roster must
 * equal the membership it DECLARES, in both directions.
 *
 *   node scripts/check-aggregator-roster.mjs              # judge the checked-in workflows
 *   node scripts/check-aggregator-roster.mjs --self-test  # prove the battery can go red
 *
 * ## The gap this closes
 *
 * Three of this repo's required contexts are aggregator jobs standing in for a
 * set of real jobs, each deciding its verdict from what it lists in `needs:`:
 * `test-gate` / `Test Core` and `dogfood-gate` / `Dogfood Regression Gate` in
 * ci.yml, and `typecheck` / `TypeScript Type Check` in lint.yml.
 *
 * Nothing held those rosters to anything. The failure mode is one forgotten
 * line:
 *
 *   1. someone adds a lane to the workflow;
 *   2. they do not add it to the aggregator's `needs:`;
 *   3. the lane runs, and its check-run is ADVISORY -- only the aggregate name
 *      is in the ruleset's required set;
 *   4. the aggregator goes green without ever looking at it.
 *
 * The result is a job that appears in the checks list, appears to belong to a
 * required family, and blocks nothing. That is the dormant-gate shape this repo
 * keeps paying for (#4690's "not measured" reported as "measured and clean"),
 * one level up: not a gate reading nothing, but a gate nobody reads.
 *
 * ## Why the existing gates do not already cover it
 *
 *   - `check:required-contexts` pins each aggregate's `name:` and job id, and
 *     asserts no unregistered job carries a registered name. It says nothing
 *     about `needs:`.
 *   - `check:shard-attestation` covers ci.yml's two aggregates from the OTHER
 *     side: every `--leg` it counts must appear in `needs:`, and every job that
 *     publishes a credential must be counted by exactly one gate. That is the
 *     `roster -> needs` direction only. The reverse -- a job wired into a
 *     gate's `needs:` that no `--leg` counts -- contributes nothing to that
 *     gate's verdict and was unchecked: a lane that LOOKS aggregated and is
 *     not.
 *   - The `typecheck` aggregator carried a hand-maintained `EXPECTED_LANES`
 *     count. A count is the classic thing that goes stale, it covers one of
 *     three aggregates, and a number cannot say WHICH lane went missing. This
 *     gate is what let that number be replaced by a roster.
 *
 * ## The shape
 *
 * Triage's ruling on the card's open question (2026-08-21) was: an explicit
 * member declaration per aggregator, asserted equal to `needs:` in both
 * directions -- NOT a repo-wide job-id naming convention across ci.yml and
 * lint.yml. So the declaration is local to the workflow file, in real YAML the
 * runner and every parser already see, as job-level `env:`:
 *
 *   env:
 *     OS_AGGREGATOR_MEMBERS: test            # lanes whose verdict this gate carries
 *     OS_AGGREGATOR_NON_MEMBERS: filter      # in `needs:` for another reason
 *
 * `OS_AGGREGATOR_NON_MEMBERS` exists because `needs:` is not only a roster:
 * both ci.yml gates list `filter` so they can apply the #4928
 * skipped-only-when-filter-succeeded guard, and `filter` is emphatically not a
 * lane they stand in for. Without a place to say so, the honest `needs:` would
 * be unrepresentable and the gate would be gamed by widening the roster --
 * which is the failure it exists to catch.
 *
 * Discovery is by declaration, so a NEW aggregator that adds the two keys is
 * covered without editing this file. `REQUIRED_AGGREGATORS` is the floor
 * underneath that: the three jobs that carry a branch-protection-required
 * context must each be found AND declared, so deleting the declaration to make
 * a red go away is itself red.
 *
 * ## Why every unreadable state is a REFUSAL, not a quiet pass
 *
 * A gate that reads a roster is exactly the kind that can pass while reading
 * nothing: no aggregator found, a workflow that does not parse, or a
 * declaration that resolves to zero members all produce an empty comparison,
 * and an empty comparison has no violations in it. Every one of those exits 1
 * naming what could not be read (#4690). The self-test pins each refusal.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

/** The declaration keys, spelled once. */
export const MEMBERS_KEY = 'OS_AGGREGATOR_MEMBERS';
export const NON_MEMBERS_KEY = 'OS_AGGREGATOR_NON_MEMBERS';

/** The workflow files this gate reads. */
const WORKFLOW_FILES = ['ci.yml', 'lint.yml'];

/**
 * The aggregators that carry a branch-protection-required context, and so may
 * never lose their declaration. Kept in step with the `REQUIRED_CONTEXTS`
 * registry in `scripts/check-required-contexts.mjs` -- that file is the
 * registry of required NAMES; this is the subset of them that aggregate other
 * jobs. Deliberately not imported from there: that module runs its gate on
 * import (it is on `check:entry-guard`'s KNOWN_IMPORT_UNSAFE ledger), so an
 * import would judge the repo as a side effect of reading a constant.
 */
export const REQUIRED_AGGREGATORS = [
  { workflow: 'ci.yml', job: 'test-gate', context: 'Test Core' },
  { workflow: 'ci.yml', job: 'dogfood-gate', context: 'Dogfood Regression Gate' },
  { workflow: 'lint.yml', job: 'typecheck', context: 'TypeScript Type Check' },
];

/** A legal GitHub Actions job id. A comma or a stray quote fails here. */
const JOB_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * A `--leg <job>/<total>:` token in an aggregate gate's `run:` text.
 * Same shape `check:shard-attestation` reads; re-spelled rather than imported
 * for the KNOWN_IMPORT_UNSAFE reason above.
 */
const LEG_TOKEN = /--leg\s+['"]?([A-Za-z0-9_-]+)\/(\d+):/g;

/** Repository root, resolved from this file rather than from the cwd. */
function scriptRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

// ── Reading the declaration ─────────────────────────────────────────────────

/** `needs:` as a list, whichever of the two YAML spellings was used. */
export function needsOf(job) {
  if (Array.isArray(job?.needs)) return job.needs.map((n) => String(n));
  if (typeof job?.needs === 'string') return [job.needs];
  return [];
}

/**
 * Split one declaration value into ids.
 *
 * Whitespace-separated on purpose: a comma survives the split as part of the
 * token and then fails `JOB_ID`, so `a, b` is a named error rather than a
 * silent roster of `a,` and `b`.
 */
export function declaredIds(value) {
  if (value === undefined || value === null) return undefined;
  return String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** The `run:` text of every step of a job, joined. */
function runTextOf(job) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  return steps.map((step) => (typeof step?.run === 'string' ? step.run : '')).join('\n');
}

// ── The verdict, as a pure function ─────────────────────────────────────────

/**
 * Judge every declared aggregator across the given workflows.
 *
 * Pure: every input is an argument, so `--self-test` drives the real decision
 * over mutated workflow text instead of a parallel imitation of it.
 *
 * @param {{ workflows: Map<string, { doc?: unknown, error?: string }> }} input
 * @returns {{ problems: string[], read: string[], found: string[] }}
 */
export function judge({ workflows }) {
  const problems = [];
  const read = [];
  const found = [];

  for (const file of WORKFLOW_FILES) {
    const entry = workflows.get(file);
    if (!entry) {
      problems.push(`${file}: not supplied to the roster check -- nothing about it was verified (see #4690).`);
      continue;
    }
    if (entry.error) {
      problems.push(`${file}: ${entry.error} -- nothing in it was verified (see #4690).`);
      continue;
    }
    const doc = entry.doc;
    const jobs = doc && typeof doc === 'object' ? doc.jobs : undefined;
    if (!jobs || typeof jobs !== 'object') {
      problems.push(`${file}: has no jobs: map -- nothing in it was verified (see #4690).`);
      continue;
    }
    const jobIds = new Set(Object.keys(jobs));

    for (const [id, job] of Object.entries(jobs)) {
      const env = job && typeof job === 'object' ? job.env : undefined;
      const rawMembers = env && typeof env === 'object' ? env[MEMBERS_KEY] : undefined;
      const rawNonMembers = env && typeof env === 'object' ? env[NON_MEMBERS_KEY] : undefined;
      if (rawMembers === undefined && rawNonMembers === undefined) continue;

      found.push(`${file}/${id}`);
      const where = `${file} job '${id}'`;

      if (rawMembers === undefined) {
        problems.push(`${where} declares ${NON_MEMBERS_KEY} but no ${MEMBERS_KEY} -- a roster of nothing verifies nothing (see #4690).`);
        continue;
      }

      const members = declaredIds(rawMembers) ?? [];
      const nonMembers = declaredIds(rawNonMembers) ?? [];

      // Zero members is a REFUSAL, not an empty allow-list: every comparison
      // below would be trivially satisfied and the gate would report a green
      // over an aggregator it never checked.
      if (members.length === 0) {
        problems.push(`${where} declares an EMPTY ${MEMBERS_KEY} -- refusing to report a pass for an aggregator with no roster (see #4690).`);
        continue;
      }

      let malformed = false;
      for (const [key, ids] of [
        [MEMBERS_KEY, members],
        [NON_MEMBERS_KEY, nonMembers],
      ]) {
        for (const candidate of ids) {
          if (JOB_ID.test(candidate)) continue;
          problems.push(`${where} lists ${JSON.stringify(candidate)} in ${key}, which is not a legal job id -- separate ids with spaces, not commas.`);
          malformed = true;
        }
      }
      if (malformed) continue;

      const memberSet = new Set(members);
      const nonMemberSet = new Set(nonMembers);
      for (const both of members.filter((m) => nonMemberSet.has(m))) {
        problems.push(`${where} lists '${both}' in BOTH ${MEMBERS_KEY} and ${NON_MEMBERS_KEY} -- a job is aggregated or it is not.`);
      }

      // A declared id that is not a job in this workflow: the roster names
      // something that does not exist, so the aggregate stands in for a lane
      // nobody runs.
      for (const [key, ids] of [
        [MEMBERS_KEY, members],
        [NON_MEMBERS_KEY, nonMembers],
      ]) {
        for (const candidate of ids) {
          if (jobIds.has(candidate)) continue;
          problems.push(`${where} declares '${candidate}' in ${key}, but ${file} has no such job -- the roster names a lane that does not exist.`);
        }
      }

      const needs = needsOf(job);
      const needsSet = new Set(needs);

      // ── Direction 1: declared member missing from `needs:` ───────────────
      // The card's failure. The lane runs, publishes an ADVISORY check-run,
      // and the required aggregate never looks at it.
      for (const member of members) {
        if (needsSet.has(member)) continue;
        problems.push(
          `${where} declares '${member}' as a member but does not list it in needs:, so its verdict is NOT aggregated -- ` +
            `it publishes an advisory check-run and rides green behind a required context (#10490).`,
        );
      }

      // ── Direction 2: `needs:` entry that the roster does not account for ──
      // Equally silent: the gate lists the job, so a reader assumes it is
      // covered, but nothing in the verdict consults it.
      for (const need of needs) {
        if (memberSet.has(need) || nonMemberSet.has(need)) continue;
        problems.push(
          `${where} lists '${need}' in needs: but declares it neither in ${MEMBERS_KEY} nor in ${NON_MEMBERS_KEY} -- ` +
            `add it to the roster it belongs to, or drop it from needs:.`,
        );
      }

      // ── Direction 3: `needs:` entry naming a job that is not there ────────
      for (const need of needs) {
        if (jobIds.has(need)) continue;
        problems.push(`${where} lists '${need}' in needs:, but ${file} has no such job -- the lane was deleted and the roster still claims it.`);
      }

      // ── The declaration must match how the gate actually counts ───────────
      // ci.yml's two gates decide from `--leg <job>/<total>` tokens
      // (`check:shard-attestation`). Where those exist they ARE the members,
      // so the new declaration cannot drift into a second source of truth.
      const legs = [...runTextOf(job).matchAll(LEG_TOKEN)].map((m) => m[1]);
      if (legs.length > 0) {
        const legSet = new Set(legs);
        for (const member of members) {
          if (legSet.has(member)) continue;
          problems.push(`${where} declares '${member}' as a member but counts no --leg for it -- the gate's verdict never reads that lane.`);
        }
        for (const leg of legSet) {
          if (memberSet.has(leg)) continue;
          problems.push(`${where} counts a --leg for '${leg}' but does not declare it in ${MEMBERS_KEY} -- the roster and the verdict disagree.`);
        }
      }

      read.push(
        `${file}/${id}: ${members.length} member(s) [${members.join(', ')}]` +
          `${nonMembers.length > 0 ? ` + ${nonMembers.length} non-member input(s) [${nonMembers.join(', ')}]` : ''}` +
          ` == needs: [${[...needs].sort().join(', ')}]` +
          `${legs.length > 0 ? ` (cross-checked against ${legs.length} --leg token(s))` : ''}`,
      );
    }
  }

  // ── The floor: a required aggregate may not lose its declaration ──────────
  const foundSet = new Set(found);
  for (const required of REQUIRED_AGGREGATORS) {
    const key = `${required.workflow}/${required.job}`;
    if (foundSet.has(key)) continue;
    const entry = workflows.get(required.workflow);
    const jobs = entry && !entry.error && entry.doc && typeof entry.doc === 'object' ? entry.doc.jobs : undefined;
    const exists = jobs && typeof jobs === 'object' && Object.hasOwn(jobs, required.job);
    problems.push(
      exists
        ? `job '${required.job}' in ${required.workflow} carries the required context '${required.context}' but declares no ${MEMBERS_KEY} roster -- ` +
          `refusing to report a pass for an aggregate whose membership nothing states (#10490/#4690).`
        : `job '${required.job}' was not found in ${required.workflow}, so the required context '${required.context}' could not be checked at all (see #4690).`,
    );
  }

  return { problems, read, found };
}

// ── Reading the tree ────────────────────────────────────────────────────────

/** Read and parse both workflows into the shape `judge` consumes. */
export async function readWorkflows(root) {
  const { parse } = await import('yaml');
  const workflows = new Map();
  for (const file of WORKFLOW_FILES) {
    const path = join(root, '.github', 'workflows', file);
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      workflows.set(file, { error: `cannot be read (${error.code ?? error.message})` });
      continue;
    }
    try {
      workflows.set(file, { doc: parse(text) });
    } catch (error) {
      workflows.set(file, { error: `does not parse as YAML: ${error.message}` });
    }
  }
  return workflows;
}

// ── Modes ───────────────────────────────────────────────────────────────────

async function main() {
  const root = scriptRepoRoot();
  const verdict = judge({ workflows: await readWorkflows(root) });

  if (verdict.problems.length > 0) {
    console.error(`❌  check-aggregator-roster — ${verdict.problems.length} problem(s):\n`);
    for (const problem of verdict.problems) console.error(`  • ${problem}`);
    console.error(
      `\n  An aggregate gate stands in for the jobs it lists in needs:. Its ${MEMBERS_KEY} declaration is what\n` +
        `  says which those are; when the two disagree, either a lane rides green behind a required context or\n` +
        `  the gate claims a lane nobody runs. Fix the workflow, not this gate.\n`,
    );
    process.exit(1);
  }

  // The OK line states what was READ, per aggregator. A bare "OK" from a gate
  // that resolves rosters is indistinguishable from a gate that resolved none.
  console.log(
    `✓ check-aggregator-roster: ${verdict.found.length} aggregator(s) across ${WORKFLOW_FILES.length} workflow(s); ` +
      `roster == needs: in both directions, and all ${REQUIRED_AGGREGATORS.length} required-context aggregate(s) declared.`,
  );
  for (const line of verdict.read) console.log(`    ${line}`);
}

// ── Self-test ───────────────────────────────────────────────────────────────

async function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (condition, description) => {
    checked += 1;
    if (!condition) failures.push(description);
  };

  const root = scriptRepoRoot();
  const { parse } = await import('yaml');
  const sources = Object.fromEntries(
    WORKFLOW_FILES.map((file) => [file, readFileSync(join(root, '.github', 'workflows', file), 'utf8')]),
  );

  /** Judge the real workflows with one file's text replaced by `source`. */
  const withSource = (file, source) =>
    judge({
      workflows: new Map(
        Object.entries({ ...sources, [file]: source }).map(([f, text]) => {
          try {
            return [f, { doc: parse(text) }];
          } catch (error) {
            return [f, { error: `does not parse as YAML: ${error.message}` }];
          }
        }),
      ),
    });

  /**
   * A mutated workflow, with the mutation itself asserted.
   *
   * Every anchor is a literal lifted out of a real workflow, so any of them can
   * go stale under an unrelated edit. `String.replace` that matches nothing
   * returns its input unchanged -- which would leave the assertion below
   * judging the PRISTINE workflow and passing for the wrong reason, silently
   * and forever. So a no-op mutation is a named failure of its own.
   */
  const fixture = (label, file, mutate) => {
    const source = mutate(sources[file]);
    assert(source !== sources[file], `fixture '${label}': its ${file} anchor no longer matches -- the assertion below would judge the pristine workflow`);
    return withSource(file, source);
  };

  // ── (1) BASELINE: the checked-in tree is green, and says what it read ─────
  const baseline = judge({ workflows: await readWorkflows(root) });
  assert(baseline.problems.length === 0, `the checked-in workflows pass -- got ${JSON.stringify(baseline.problems)}`);
  assert(
    baseline.found.length >= REQUIRED_AGGREGATORS.length,
    `every required-context aggregator is discovered (${baseline.found.length} found, ${REQUIRED_AGGREGATORS.length} required)`,
  );
  for (const required of REQUIRED_AGGREGATORS) {
    assert(baseline.found.includes(`${required.workflow}/${required.job}`), `'${required.job}' in ${required.workflow} is discovered by its declaration`);
    assert(
      baseline.read.some((line) => line.startsWith(`${required.workflow}/${required.job}:`)),
      `the OK line states what it read for '${required.job}' -- a bare OK proves nothing`,
    );
  }

  // ── (2) POSITIVE CONTROL A, per aggregator ───────────────────────────────
  // A declared member dropped from `needs:` -- the card's exact failure.
  // Predicted direction: RED, naming the aggregator and the orphaned lane.
  const dropped = [
    { label: 'typecheck loses a lane from needs:', file: 'lint.yml', member: 'typecheck-consumers', from: '      - typecheck-consumers\n', to: '' },
    { label: 'test-gate loses its matrix from needs:', file: 'ci.yml', member: 'test', from: '    needs: [test, filter]\n', to: '    needs: [filter]\n' },
    {
      label: 'dogfood-gate loses the CLI pass from needs:',
      file: 'ci.yml',
      member: 'dogfood-verify',
      from: '    needs: [dogfood, dogfood-verify, filter]\n',
      to: '    needs: [dogfood, filter]\n',
    },
  ];
  for (const scenario of dropped) {
    const verdict = fixture(scenario.label, scenario.file, (s) => s.replace(scenario.from, scenario.to));
    assert(
      verdict.problems.some((p) => p.includes(`declares '${scenario.member}' as a member`) && p.includes('does not list it in needs:')),
      `${scenario.label} ⇒ red, naming the member that is no longer aggregated -- got ${JSON.stringify(verdict.problems)}`,
    );
    assert(
      verdict.problems.some((p) => p.includes(scenario.file) && p.includes('rides green behind a required context')),
      `${scenario.label} ⇒ the finding names the workflow and the consequence`,
    );
  }

  // ── (3) POSITIVE CONTROL B, per aggregator ───────────────────────────────
  // A `needs:` entry naming a job that does not exist. Two findings at once,
  // both true and both wanted: the roster does not account for it, and the
  // workflow has no such job.
  const phantom = [
    { label: 'typecheck needs a job that was deleted', file: 'lint.yml', from: '      - typecheck-consumers\n', to: '      - typecheck-consumers\n      - typecheck-ghost\n', ghost: 'typecheck-ghost' },
    { label: 'test-gate needs a job that was deleted', file: 'ci.yml', from: '    needs: [test, filter]\n', to: '    needs: [test, filter, test-ghost]\n', ghost: 'test-ghost' },
    {
      label: 'dogfood-gate needs a job that was deleted',
      file: 'ci.yml',
      from: '    needs: [dogfood, dogfood-verify, filter]\n',
      to: '    needs: [dogfood, dogfood-verify, filter, dogfood-ghost]\n',
      ghost: 'dogfood-ghost',
    },
  ];
  for (const scenario of phantom) {
    const verdict = fixture(scenario.label, scenario.file, (s) => s.replace(scenario.from, scenario.to));
    assert(
      verdict.problems.some((p) => p.includes(`lists '${scenario.ghost}' in needs:`) && p.includes('has no such job')),
      `${scenario.label} ⇒ red, naming the phantom lane -- got ${JSON.stringify(verdict.problems)}`,
    );
    assert(
      verdict.problems.some((p) => p.includes(`lists '${scenario.ghost}' in needs:`) && p.includes(MEMBERS_KEY)),
      `${scenario.label} ⇒ red for the roster not accounting for it either`,
    );
  }

  // ── (4) A declared member that is not a job in the workflow ──────────────
  const ghostMember = fixture('typecheck declares a member that does not exist', 'lint.yml', (s) =>
    s.replace(`${MEMBERS_KEY}: typecheck-source-gates`, `${MEMBERS_KEY}: typecheck-phantom typecheck-source-gates`),
  );
  assert(
    ghostMember.problems.some((p) => p.includes("declares 'typecheck-phantom'") && p.includes('has no such job')),
    `a roster naming a job that does not exist ⇒ red -- got ${JSON.stringify(ghostMember.problems)}`,
  );

  // ── (5) REFUSALS -- the most important assertions in this file ────────────
  // Each of these makes the comparison EMPTY. An empty comparison contains no
  // violations, so a gate that merely looked for violations would report "no
  // problems" over an aggregator it never read (#4690).

  // 5a. The declaration is unfindable: the whole env block is gone.
  const noDeclaration = fixture('typecheck loses its roster declaration', 'lint.yml', (s) =>
    s.replace(new RegExp(`\\n    env:\\n      ${MEMBERS_KEY}: [^\\n]*\\n`), '\n'),
  );
  assert(
    noDeclaration.problems.some((p) => p.includes("job 'typecheck'") && p.includes('declares no') && p.includes('refusing to report a pass')),
    `deleting an aggregator's declaration ⇒ REFUSAL naming the job -- got ${JSON.stringify(noDeclaration.problems)}`,
  );

  // 5b. The aggregator job itself is gone from the workflow.
  const noJob = fixture('test-gate is deleted from ci.yml', 'ci.yml', (s) => s.replace(/\n  test-gate:\n/, '\n  test-gate-renamed-away:\n'));
  assert(
    noJob.problems.some((p) => p.includes("job 'test-gate' was not found in ci.yml") && p.includes('could not be checked at all')),
    `an aggregator that is not in the workflow ⇒ REFUSAL, not silence -- got ${JSON.stringify(noJob.problems)}`,
  );

  // 5c. The declaration resolves to ZERO members.
  const emptyRoster = fixture('typecheck declares an empty roster', 'lint.yml', (s) =>
    s.replace(new RegExp(`${MEMBERS_KEY}: [^\\n]*`), `${MEMBERS_KEY}: ''`),
  );
  assert(
    emptyRoster.problems.some((p) => p.includes('EMPTY') && p.includes('refusing to report a pass')),
    `a zero-member roster ⇒ REFUSAL, never an empty allow-list -- got ${JSON.stringify(emptyRoster.problems)}`,
  );

  // 5d. The workflow does not parse.
  const unparseable = withSource('lint.yml', 'jobs:\n  a: [\n');
  assert(
    unparseable.problems.some((p) => p.includes('lint.yml') && p.includes('nothing in it was verified')),
    `an unparseable workflow ⇒ REFUSAL -- got ${JSON.stringify(unparseable.problems)}`,
  );

  // 5e. A workflow that was never supplied at all.
  const missingFile = judge({ workflows: new Map([['ci.yml', { doc: parse(sources['ci.yml']) }]]) });
  assert(
    missingFile.problems.some((p) => p.includes('lint.yml') && p.includes('nothing about it was verified')),
    `a workflow absent from the input ⇒ REFUSAL -- got ${JSON.stringify(missingFile.problems)}`,
  );

  // 5f. A jobs-less document.
  const noJobs = withSource('lint.yml', 'name: Lint & Type Check\non:\n  push:\n');
  assert(
    noJobs.problems.some((p) => p.includes('has no jobs: map')),
    `a workflow with no jobs: map ⇒ REFUSAL -- got ${JSON.stringify(noJobs.problems)}`,
  );

  // ── (6) The declaration cannot drift from how the gate actually counts ────
  const legDrift = fixture('dogfood-gate stops counting a declared member', 'ci.yml', (s) =>
    s.replace("            --leg \"dogfood-verify/1:$OS_VERIFY_RESULT\"\n", ''),
  );
  assert(
    legDrift.problems.some((p) => p.includes("declares 'dogfood-verify' as a member but counts no --leg")),
    `a member the verdict never counts ⇒ red -- got ${JSON.stringify(legDrift.problems)}`,
  );

  // ── (7) Malformed declarations fail loudly rather than silently shrinking ─
  const commaSeparated = fixture('typecheck separates its roster with commas', 'lint.yml', (s) =>
    s.replace(
      `${MEMBERS_KEY}: typecheck-source-gates typecheck-workspace`,
      `${MEMBERS_KEY}: typecheck-source-gates, typecheck-workspace`,
    ),
  );
  assert(
    commaSeparated.problems.some((p) => p.includes('not a legal job id') && p.includes('not commas')),
    `a comma-separated roster ⇒ red naming the token -- got ${JSON.stringify(commaSeparated.problems)}`,
  );

  // ── (8) `filter` may not be laundered into the roster to silence a red ────
  const launderedFilter = fixture('test-gate calls filter a member', 'ci.yml', (s) =>
    s.replace(`${MEMBERS_KEY}: test\n      ${NON_MEMBERS_KEY}: filter`, `${MEMBERS_KEY}: test filter`),
  );
  assert(
    launderedFilter.problems.some((p) => p.includes("declares 'filter' as a member but counts no --leg")),
    `widening the roster to cover a non-member ⇒ red -- got ${JSON.stringify(launderedFilter.problems)}`,
  );

  // ── (9) WIRING: the gate and its self-test really run in CI ───────────────
  // A gate that exists and is not scheduled is the #10682 shape this card is a
  // sibling of. Asserted against the workflow text, not remembered.
  {
    const lint = sources['lint.yml'];
    const self = 'scripts/check-aggregator-roster.mjs';
    assert(lint.includes(`node ${self}\n`), `wiring: lint.yml invokes ${self} directly (no root package.json alias -- #9465 fence)`);
    assert(lint.includes(`node ${self} --self-test`), 'wiring: lint.yml runs the --self-test half too');
  }

  if (failures.length > 0) {
    console.error(`✗ check-aggregator-roster --self-test — ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(
    `✓ check-aggregator-roster --self-test: ${checked} assertions ` +
      `(baseline + a dropped member and a phantom needs: entry for each of the ${REQUIRED_AGGREGATORS.length} required aggregators + ` +
      `six refusals + the --leg cross-check + the malformed-roster and laundered-non-member pins + the CI wiring).`,
  );
}

// The CLI dispatch is guarded so that IMPORTING this module is inert: `judge`
// and `readWorkflows` are exported so another tree can be judged, and a module
// that ran its gate on import would silently judge THIS repo instead and print
// a verdict about the wrong subject (`check:entry-guard`).
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) await selfTest();
  else await main();
}
