#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-merged-branch-reaper-outcome -- run the SHIPPED merged-branch-reaper
// classifier under doubles and hold its OUTCOMES to contract.
//
//   node scripts/check-merged-branch-reaper-outcome.mjs             # judge the shipped script
//   node scripts/check-merged-branch-reaper-outcome.mjs --self-test # prove the battery can go red
//   node scripts/check-merged-branch-reaper-outcome.mjs --list      # the scenario table
//
// ## Why this file exists (#13503)
//
// `.github/workflows/merged-branch-reaper.yml` carries the classifier that
// decides which branches a deletion pass would take. Its token grant is
// `contents: read`, so the workflow itself cannot delete anything -- but its
// output IS the deletion list a human is asked to release, and the maintainer's
// ruling of 2026-09-03 (issue #13503) turns that list into an action.
//
// That ruling added the BASE-REF GUARD: `merged_at` says a pull request landed,
// it does not say WHERE, and a stacked PR merged into another dev branch
// reports `merged_at` exactly like one that landed on `main`. Measured over the
// 678 `copilot/*` branches in the #13503 census (2026-09-02): of 575 MERGED, 48
// merged into something other than `main`, and one of those 48 --
// `copilot/check-action-run-status`, based on a PR that closed WITHOUT
// merging -- is a MERGED branch whose content has no confirmed path to `main`
// at all. Unguarded, the classifier calls it safe to delete.
//
// A guard against a destructive default is worth exactly what proves it still
// holds. Read alone, the classifier's diff looks the same whether the guard
// narrows what gets reaped or widens it, and the workflow's own runs cannot
// tell anybody either: a dry run over a real repository prints a list, and a
// list is not a contract. So the contract is asserted here --
//
//   reapable(branch)  =>  that branch has a merged PR whose base is `main`
//
// -- over every scenario, on the SHIPPED bytes.
//
// ## The method: the shipped bytes, never a copy
//
// The script is read out of the YAML with a real parser (`jobs -> sweep ->
// steps[github-script] -> with.script`) and executed the way the action
// executes it:
//
//     new AsyncFunction('github', 'context', 'core', ..., source)
//
// A copy of the script pasted into this file would be a test of the copy. The
// extraction is therefore load-bearing, and every failure to extract is a
// FAILURE rather than a skip (#4690): a renamed workflow, a step that no longer
// uses github-script, an empty `script:` -- all of them exit non-zero, because a
// harness that could not find its subject has verified nothing at all.
//
// Assertion 0 is the compile. github-script compiles the whole block as ONE
// AsyncFunction body, and the sibling harness next door
// (`check-cross-repo-closer-outcome.mjs`) records a real incident of a workflow
// script that never ran at all because of a duplicate declaration -- a failure
// class no outcome assertion can see.
//
// ## What is asserted
//
// Four invariants over EVERY scenario, independent of what that scenario is
// about, because they are the properties an edit here can break silently:
//
//   INV-NARROW  every reaped branch has a merged PR based on `main`. This is
//               the guard, stated as a consequence rather than as the presence
//               of a line of code, so a rewrite that keeps the behaviour passes
//               and one that loses it cannot.
//   INV-HELD    every branch in the held bucket really has a merged PR and
//               really has no main-based one -- the guard does not get to
//               quarantine branches it merely failed to classify.
//   INV-PART    the buckets PARTITION the candidate set: each candidate lands
//               in exactly one. A branch that falls out of every bucket is
//               invisible in the report and reads as "nothing to say about it".
//   INV-SHOWN   the held count is RENDERED -- read off the TABLE ROW, which is
//               where the count lives, not off the prose heading below it that
//               would survive the row's deletion. A bucket computed and not
//               printed is a branch excluded in silence, which is the one shape
//               a reader of the dry-run list cannot detect.
//
// Then per-scenario outcomes: which bucket each fixture lands in, what the
// summary says, and the step outputs.
//
// NOT asserted: the API sweep's pagination, `retries`, or anything the ACTION
// consumes rather than the script. No stub of `github` can exercise those.
//
// ## The self-test, and why it is not optional
//
// A battery over a script that is already correct is green on day one and green
// forever, including the day someone deletes the thing it guards. `--self-test`
// mutates the extracted source and requires the battery to go RED for each
// mutation, naming the scenario that catches it. The classes: the GUARD removed
// or inverted, its BASE constant changed, the fail-closed direction flipped, the
// held bucket unrecorded or unrendered, and -- because the guard must not have
// cost anything that was already there -- the pre-existing decisions it sits
// beside (open-PR precedence, the grace window, the defensive head-ref filter,
// the protected short-circuit).
//
// Each mutation asserts its own anchor was PRESENT before substituting: a
// mutation that silently matched nothing would leave the battery green and read
// exactly like a passing self-test.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireDependency } from './import-prerequisite.mjs';
const { isMap, isSeq, parseDocument } = await requireDependency('yaml', () => import('yaml'), import.meta.url);
import { isEntrypoint } from './invoked-as.mjs';

const WORKFLOW = '.github/workflows/merged-branch-reaper.yml';
const JOB = 'sweep';
const SELF = 'scripts/check-merged-branch-reaper-outcome.mjs';
const LINT_WORKFLOW = '.github/workflows/lint.yml';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const DAY = 24 * 60 * 60 * 1000;

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` is not a success condition on its own: "every case
// held" and "the cases never ran" print the same line. Every section opens with
// `battery('<name>')`, every assertion is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count. The counts are a FLOOR --
// adding cases is ordinary work and must not red.
const SELF_TEST_BATTERY_FLOOR = 5;
const UNATTRIBUTED_BATTERY = '(no battery open)';
const SELF_TEST_BATTERIES = Object.freeze({
  '1. The unmutated shipped script must be green -- otherwise every red below': 1,
  '2. Every mutation must be REACHED and must turn the battery red, in the': 57,
  '3. A script that does not compile is caught before any scenario runs.': 1,
  '4. Missing input is a failure, never a pass (#4690).': 1,
  '5. Wiring. A check nobody runs is the #4449 shape this repo keeps paying': 3,
});

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

// ── Extraction ──────────────────────────────────────────────────────────────

/**
 * The inline github-script source, read out of the shipped workflow.
 *
 * @param {string} root repository root
 * @returns {{ source: string|null, problems: string[] }}
 */
export function extractScript(root) {
  const problems = [];
  const path = join(root, WORKFLOW);
  if (!existsSync(path)) {
    problems.push(`${WORKFLOW} does not exist -- nothing was extracted, so nothing was verified.`);
    return { source: null, problems };
  }
  const doc = parseDocument(readFileSync(path, 'utf8'));
  if (doc.errors.length > 0) {
    problems.push(`${WORKFLOW}: YAML parse error -- ${doc.errors[0].message}`);
    return { source: null, problems };
  }
  const steps = doc.getIn(['jobs', JOB, 'steps']);
  if (!isSeq(steps)) {
    problems.push(`${WORKFLOW}: job \`${JOB}\` has no \`steps:\` sequence -- the subject of this check is gone.`);
    return { source: null, problems };
  }
  const scripted = steps.items.filter((step) => {
    if (!isMap(step)) return false;
    return String(step.get('uses') ?? '').startsWith('actions/github-script@');
  });
  if (scripted.length !== 1) {
    problems.push(
      `${WORKFLOW}: expected exactly one \`actions/github-script@*\` step in \`${JOB}\`, found ${scripted.length}. ` +
        'This harness drives one script; a second one would be unverified while this still reported OK.',
    );
    return { source: null, problems };
  }
  const source = scripted[0].getIn(['with', 'script']);
  if (typeof source !== 'string' || source.trim() === '') {
    problems.push(`${WORKFLOW}: the github-script step has no non-empty \`with.script\` -- nothing to run.`);
    return { source: null, problems };
  }
  return { source, problems };
}

// ── Doubles ─────────────────────────────────────────────────────────────────

/**
 * Any property this harness does not model is recorded OUT OF BAND and throws.
 *
 * A stub set that lags the script does not under-report -- it reports a pass
 * about a path the script no longer takes. `judge` fails the scenario on the
 * record, whatever that scenario's own assertions say.
 */
function guarded(name, impl, sink) {
  const PASSTHROUGH = new Set(['then', 'toJSON', 'constructor', 'inspect']);
  return new Proxy(impl, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol' || PASSTHROUGH.has(prop)) return Reflect.get(target, prop, receiver);
      if (prop in target) return Reflect.get(target, prop, receiver);
      sink.push(`${name}.${String(prop)}`);
      throw new Error(
        `${SELF}: the shipped script now uses \`${name}.${String(prop)}\`, which this harness does not stub. ` +
          'Model it here rather than deleting the assertion that found it.',
      );
    },
  });
}

/** A pull-request record shaped the way `pulls.list` returns one. */
function pr({ number, head, base = 'main', mergedAtDaysAgo = null, state = 'closed', noBase = false }) {
  return {
    number,
    state,
    head: { ref: head },
    ...(noBase ? {} : { base: { ref: base } }),
    merged_at: mergedAtDaysAgo === null ? null : new Date(Date.now() - mergedAtDaysAgo * DAY).toISOString(),
  };
}

/**
 * `github` / `context` / `core` doubles plus a call log.
 *
 * `branches` is what `repos.listBranches` answers; `pulls` maps a BRANCH NAME to
 * the raw list `pulls.list` answers for `head: owner:branch`. The map is keyed
 * by branch rather than by PR head so a scenario can hand back a record whose
 * `head.ref` is something else -- which is what the shipped script's defensive
 * filter exists for.
 */
function makeDoubles({ branches = [], pulls = {} }) {
  const calls = { listBranches: 0, pulls: [] };
  const log = { info: [], notice: [], warning: [], failed: [], outputs: {} };
  const unstubbedCalls = [];
  let summaryBuffer = [];
  let summaryWritten = false;
  const files = {};

  const restRepos = guarded(
    'github.rest.repos',
    {
      async listBranches() {
        calls.listBranches += 1;
        return branches;
      },
    },
    unstubbedCalls,
  );
  const restPulls = guarded(
    'github.rest.pulls',
    {
      async list(params) {
        const head = String(params?.head ?? '');
        const branch = head.slice(head.indexOf(':') + 1);
        calls.pulls.push(branch);
        return pulls[branch] ?? [];
      },
    },
    unstubbedCalls,
  );

  const github = guarded(
    'github',
    {
      // `paginate(fn, params)` is modelled as ONE page. The scenarios are
      // fixtures, not a repository, so pagination has nothing to reveal here --
      // and the alternative, a stub that pages, would be a test of the stub.
      async paginate(fn, params) {
        return fn(params);
      },
      rest: guarded('github.rest', { repos: restRepos, pulls: restPulls }, unstubbedCalls),
    },
    unstubbedCalls,
  );

  const summary = guarded(
    'core.summary',
    {
      addRaw(text) {
        summaryBuffer.push(String(text));
        return summary;
      },
      async write() {
        summaryWritten = true;
        return summary;
      },
    },
    unstubbedCalls,
  );

  const core = guarded(
    'core',
    {
      info: (m) => log.info.push(String(m)),
      notice: (m) => log.notice.push(String(m)),
      warning: (m) => log.warning.push(String(m)),
      setFailed: (m) => log.failed.push(String(m)),
      setOutput: (k, v) => {
        log.outputs[String(k)] = String(v);
      },
      summary,
    },
    unstubbedCalls,
  );

  const context = guarded('context', { repo: { owner: 'objectstack-ai', repo: 'objectstack' } }, unstubbedCalls);

  // `fs` is faked rather than written: the artifact upload is the ACTION's
  // half, and a harness that writes to disk to read its own fixture back is
  // testing the disk. Capturing it here is also what makes the payload -- the
  // machine-readable half of the report -- assertable.
  const realRequire = createRequire(import.meta.url);
  const fakeFs = {
    writeFileSync(path, content) {
      files[String(path)] = String(content);
    },
  };
  const requireDouble = (id) => (id === 'fs' || id === 'node:fs' ? fakeFs : realRequire(id));

  return {
    github,
    context,
    core,
    requireDouble,
    calls,
    log,
    unstubbedCalls,
    files,
    summary: () => summaryBuffer.join('\n'),
    summaryWritten: () => summaryWritten,
  };
}

/** The report payload the script writes for the upload step, parsed. */
function payloadOf(doubles) {
  const written = Object.entries(doubles.files);
  if (written.length !== 1) return null;
  try {
    return JSON.parse(written[0][1]);
  } catch {
    return null;
  }
}

/**
 * Run the script exactly as `actions/github-script` does: as the body of an
 * AsyncFunction whose scope carries the action's argument set.
 */
async function runScript(source, scenario) {
  const doubles = makeDoubles(scenario);
  const unstubbedArg = (name) =>
    guarded(name, {}, doubles.unstubbedCalls);
  const args = {
    github: doubles.github,
    context: doubles.context,
    core: doubles.core,
    exec: unstubbedArg('exec'),
    glob: unstubbedArg('glob'),
    io: unstubbedArg('io'),
    fetch: unstubbedArg('fetch'),
    require: doubles.requireDouble,
    __original_require__: doubles.requireDouble,
  };
  const fn = new AsyncFunction(...Object.keys(args), source);

  const saved = {};
  for (const key of ['GRACE_DAYS', 'RUNNER_TEMP']) {
    saved[key] = Object.hasOwn(process.env, key) ? process.env[key] : undefined;
  }
  if (scenario.graceDays === undefined) delete process.env.GRACE_DAYS;
  else process.env.GRACE_DAYS = String(scenario.graceDays);
  process.env.RUNNER_TEMP = '/reaper-harness-temp';

  let threw = null;
  try {
    await fn(...Object.values(args));
  } catch (err) {
    // github-script routes a throw to setFailed, so an escape is not
    // automatically wrong -- but it IS a different outcome from a deliberate
    // verdict, and scenarios say which one they expect.
    threw = err;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  return { ...doubles, threw, payload: payloadOf(doubles) };
}

// ── Scenarios ───────────────────────────────────────────────────────────────
//
// Every fixture branch carries the reaper's standing prefix, because that is
// what the shipped script filters on. The #13503 census that produced the guard
// measured the `copilot/` namespace; its shapes are re-spelled here under
// `claude/` rather than invented, and the scenario names say which census row
// each one is.

const SCENARIOS = [
  {
    id: 'G1',
    name: 'MERGED into main, past grace -- still reaped (the guard costs the base case nothing)',
    scenario: () => ({
      graceDays: 7,
      branches: [{ name: 'claude/landed-on-main' }],
      pulls: { 'claude/landed-on-main': [pr({ number: 101, head: 'claude/landed-on-main', base: 'main', mergedAtDaysAgo: 30 })] },
    }),
    check: (r, t) => [
      t(bucket(r, 'reapable').includes('claude/landed-on-main'), 'G1 is reapable'),
      t(bucket(r, 'mergedElsewhere').length === 0, 'G1 leaves the held bucket empty'),
      t((r.payload?.buckets?.reapable?.[0] ?? {}).base_pr === 101, 'G1 records WHICH pull request cleared the base-ref guard'),
      t(r.log.outputs.reapable === '1', `G1 reports one reapable branch on the step output, got ${r.log.outputs.reapable}`),
    ],
  },
  {
    id: 'G2',
    name: 'MERGED into a sibling branch -- HELD by the base-ref guard, never reaped',
    scenario: () => ({
      graceDays: 7,
      branches: [{ name: 'claude/stacked-on-a-sibling' }],
      pulls: {
        'claude/stacked-on-a-sibling': [
          pr({ number: 202, head: 'claude/stacked-on-a-sibling', base: 'claude/the-base', mergedAtDaysAgo: 30 }),
        ],
      },
    }),
    check: (r, t) => [
      t(bucket(r, 'reapable').length === 0, 'G2 is NOT reapable -- this is the guard'),
      t(bucket(r, 'mergedElsewhere').includes('claude/stacked-on-a-sibling'), 'G2 lands in the held bucket'),
      t((r.payload?.buckets?.mergedElsewhere?.[0] ?? {}).base === 'claude/the-base', 'G2 records the base it actually merged into'),
      t(r.summary().includes('claude/stacked-on-a-sibling'), 'G2 is NAMED in the report -- a held branch nobody can see is a branch excluded in silence'),
      t(r.summary().includes('claude/the-base'), 'G2 names the base in the report, which is what a human needs to clear it'),
      t(r.log.outputs.merged_elsewhere === '1', `G2 reports the held count on the step output, got ${r.log.outputs.merged_elsewhere}`),
      t((r.log.notice[0] ?? '').includes('base-ref guard'), 'G2 says on the run notice that a branch was held by the guard'),
    ],
  },
  {
    id: 'G3',
    name: 'the census’s one measured false positive: merged into a base whose own PR closed unmerged',
    // `copilot/check-action-run-status` (base `copilot/release-new-version-
    // please-work`, PR #124, closed without merging) is the single branch in
    // the 678-ref census whose content has no confirmed path to `main`. It is
    // the reason the guard exists, so it is a row here rather than a sentence.
    scenario: () => ({
      graceDays: 7,
      branches: [{ name: 'claude/check-action-run-status' }],
      pulls: {
        'claude/check-action-run-status': [
          pr({ number: 303, head: 'claude/check-action-run-status', base: 'claude/release-new-version-please-work', mergedAtDaysAgo: 120 }),
        ],
      },
    }),
    check: (r, t) => [
      t(bucket(r, 'reapable').length === 0, 'G3 is NOT reapable -- unguarded, this is the branch the reaper would have deleted'),
      t(bucket(r, 'mergedElsewhere').includes('claude/check-action-run-status'), 'G3 is held for the human look the ruling requires'),
      t(bucket(r, 'grace').length === 0, 'G3 is not merely aged out -- 120 days past merge, the grace window has nothing to do with it'),
    ],
  },
  {
    id: 'G4',
    name: 'a merged PR record carrying NO base at all is fail-closed',
    scenario: () => ({
      graceDays: 7,
      branches: [{ name: 'claude/no-base-on-the-record' }],
      pulls: {
        'claude/no-base-on-the-record': [
          pr({ number: 404, head: 'claude/no-base-on-the-record', mergedAtDaysAgo: 30, noBase: true }),
        ],
      },
    }),
    check: (r, t) => [
      t(bucket(r, 'reapable').length === 0, 'G4 is NOT reapable -- an absent base answers neither question, and the cost of guessing is a deleted branch'),
      t(bucket(r, 'mergedElsewhere').includes('claude/no-base-on-the-record'), 'G4 is held'),
      t(
        String((r.payload?.buckets?.mergedElsewhere?.[0] ?? {}).base).includes('no base'),
        'G4 says the base was ABSENT rather than printing an empty string that reads like a branch name',
      ),
    ],
  },
  {
    id: 'G5',
    name: 'merged into main AND later into a sibling -- still reapable, and grace still runs off the NEWEST merge',
    // The guard is an additional requirement, never a replacement for the
    // existing tie-break. If it moved the grace window it could reap something
    // EARLIER than the unguarded script would, which is the one direction a
    // narrowing guard must not have.
    scenario: () => ({
      graceDays: 7,
      branches: [{ name: 'claude/two-merges' }],
      pulls: {
        'claude/two-merges': [
          pr({ number: 501, head: 'claude/two-merges', base: 'main', mergedAtDaysAgo: 40 }),
          pr({ number: 502, head: 'claude/two-merges', base: 'claude/somewhere-else', mergedAtDaysAgo: 30 }),
        ],
      },
    }),
    check: (r, t) => [
      t(bucket(r, 'reapable').includes('claude/two-merges'), 'G5 is reapable -- one of its merges did land on main'),
      t((r.payload?.buckets?.reapable?.[0] ?? {}).pr === 502, 'G5 still reports the NEWEST merge, not the main one, because that is what the grace window is measured from'),
      t((r.payload?.buckets?.reapable?.[0] ?? {}).base_pr === 501, 'G5 names the main-based pull request separately'),
    ],
  },
  {
    id: 'G6',
    name: 'merged into main INSIDE the grace window -- held by grace, and the guard did not shorten it',
    scenario: () => ({
      graceDays: 7,
      branches: [{ name: 'claude/just-landed' }],
      pulls: { 'claude/just-landed': [pr({ number: 601, head: 'claude/just-landed', base: 'main', mergedAtDaysAgo: 1 })] },
    }),
    check: (r, t) => [
      t(bucket(r, 'grace').includes('claude/just-landed'), 'G6 is held by the grace window'),
      t(bucket(r, 'reapable').length === 0, 'G6 is not reaped'),
      t(bucket(r, 'mergedElsewhere').length === 0, 'G6 is NOT held by the base-ref guard -- it landed on main, and conflating the two reasons would misreport why it was kept'),
    ],
  },
  {
    id: 'P1',
    name: 'an open PR still outranks a merge into main',
    scenario: () => ({
      graceDays: 7,
      branches: [{ name: 'claude/reused' }],
      pulls: {
        'claude/reused': [
          pr({ number: 701, head: 'claude/reused', base: 'main', mergedAtDaysAgo: 30 }),
          pr({ number: 702, head: 'claude/reused', base: 'main', state: 'open' }),
        ],
      },
    }),
    check: (r, t) => [
      t(bucket(r, 'open').includes('claude/reused'), 'P1 is excluded as in use'),
      t(bucket(r, 'reapable').length === 0, 'P1 is not reaped'),
      t(bucket(r, 'mergedElsewhere').length === 0, 'P1 is not held by the guard -- the open PR is the reason, and the report must say the right one'),
    ],
  },
  {
    id: 'P2',
    name: 'CLOSED unmerged stays excluded by the MERGED-only policy',
    scenario: () => ({
      graceDays: 7,
      branches: [{ name: 'claude/abandoned' }],
      pulls: { 'claude/abandoned': [pr({ number: 801, head: 'claude/abandoned', base: 'main' })] },
    }),
    check: (r, t) => [
      t(bucket(r, 'closedUnmerged').includes('claude/abandoned'), 'P2 is closed-unmerged'),
      t(bucket(r, 'reapable').length === 0, 'P2 is not reaped'),
    ],
  },
  {
    id: 'P3',
    name: 'a PR whose head ref is a DIFFERENT branch never counts as this branch’s PR',
    scenario: () => ({
      graceDays: 7,
      branches: [{ name: 'claude/no-pr-of-its-own' }],
      pulls: {
        'claude/no-pr-of-its-own': [pr({ number: 901, head: 'claude/someone-else', base: 'main', mergedAtDaysAgo: 30 })],
      },
    }),
    check: (r, t) => [
      t(bucket(r, 'noPr').includes('claude/no-pr-of-its-own'), 'P3 has no PR of its own'),
      t(bucket(r, 'reapable').length === 0, 'P3 is not reaped on somebody else’s merge'),
    ],
  },
  {
    id: 'P4',
    name: 'a protected branch short-circuits before any PR is read',
    scenario: () => ({
      graceDays: 7,
      branches: [{ name: 'claude/protected-somehow', protected: true }],
      pulls: {
        'claude/protected-somehow': [pr({ number: 1001, head: 'claude/protected-somehow', base: 'main', mergedAtDaysAgo: 30 })],
      },
    }),
    check: (r, t) => [
      t(bucket(r, 'protectedBranch').includes('claude/protected-somehow'), 'P4 is excluded as protected'),
      t(r.calls.pulls.length === 0, 'P4 never even asks for its pull requests'),
    ],
  },
  {
    id: 'R1',
    name: 'the whole population renders: one branch per bucket, counted and named',
    scenario: () => ({
      graceDays: 7,
      branches: [
        { name: 'claude/r-reapable' },
        { name: 'claude/r-held' },
        { name: 'claude/r-grace' },
        { name: 'claude/r-open' },
        { name: 'claude/r-closed' },
        { name: 'claude/r-nopr' },
        { name: 'main' },
      ],
      pulls: {
        'claude/r-reapable': [pr({ number: 1101, head: 'claude/r-reapable', base: 'main', mergedAtDaysAgo: 30 })],
        'claude/r-held': [pr({ number: 1102, head: 'claude/r-held', base: 'claude/r-reapable', mergedAtDaysAgo: 30 })],
        'claude/r-grace': [pr({ number: 1103, head: 'claude/r-grace', base: 'main', mergedAtDaysAgo: 2 })],
        'claude/r-open': [pr({ number: 1104, head: 'claude/r-open', base: 'main', state: 'open' })],
        'claude/r-closed': [pr({ number: 1105, head: 'claude/r-closed', base: 'main' })],
      },
    }),
    check: (r, t) => [
      t(r.payload?.prefix_branches === 6, `R1 counts six prefixed candidates out of seven remote heads, got ${r.payload?.prefix_branches}`),
      t(bucket(r, 'reapable').length === 1 && bucket(r, 'mergedElsewhere').length === 1, 'R1 splits reaped from held'),
      t(r.summary().includes('| MERGED, but not into `main` | 1 |'), 'R1 renders the held bucket as its own row in the table, with its own count'),
      t(r.summary().includes('claude/r-held'), 'R1 names the held branch in the excluded section'),
      t(r.summaryWritten(), 'R1 writes the job summary'),
      t(r.log.failed.length === 0, `R1 does not fail the job over findings, got ${r.log.failed.join(' | ')}`),
    ],
  },
];

/** The branch names in one bucket of the run's payload. */
function bucket(result, name) {
  return (result.payload?.buckets?.[name] ?? []).map((e) => e.branch);
}

// ── The battery ─────────────────────────────────────────────────────────────

/**
 * Run every scenario against `source`.
 *
 * @returns {Promise<{ failures: {id: string, message: string}[], checked: number }>}
 */
export async function judge(source) {
  const failures = [];
  let checked = 0;

  try {
    new AsyncFunction('github', 'context', 'core', source);
  } catch (err) {
    checked++;
    failures.push({ id: 'C0', message: `the shipped script does not compile as an AsyncFunction body -- ${err.message}` });
    return { failures, checked };
  }
  checked++;

  for (const s of SCENARIOS) {
    const t = (cond, message) => {
      checked++;
      return cond ? null : { id: s.id, message };
    };
    const fixture = s.scenario();
    let result;
    try {
      result = await runScript(source, fixture);
    } catch (err) {
      failures.push({ id: s.id, message: `the harness itself threw -- ${err.message}` });
      continue;
    }

    for (const name of new Set(result.unstubbedCalls)) {
      checked++;
      failures.push({
        id: s.id,
        message: `the shipped script used \`${name}\`, which this harness does not model -- `
          + 'this scenario therefore verified something other than the behaviour it names. Model it in `makeDoubles`.',
      });
    }

    if (result.threw) {
      checked++;
      failures.push({ id: s.id, message: `the shipped script threw -- ${result.threw.message}` });
      continue;
    }
    if (!result.payload) {
      checked++;
      failures.push({
        id: s.id,
        message: 'the shipped script wrote no parseable report payload -- the artifact this workflow uploads IS its machine-readable half, and nothing downstream can read a run that did not produce one.',
      });
      continue;
    }

    // ── The four invariants, ahead of the scenario's own assertions ─────────
    const candidates = (fixture.branches ?? []).filter((b) => b.name.startsWith('claude/'));
    const prsFor = (name) => (fixture.pulls?.[name] ?? []).filter((p) => p.head && p.head.ref === name);
    const buckets = result.payload.buckets ?? {};

    for (const entry of buckets.reapable ?? []) {
      checked++;
      const mine = prsFor(entry.branch);
      const ok = mine.some((p) => p.merged_at && p.base && p.base.ref === 'main');
      if (!ok) {
        failures.push({
          id: s.id,
          message: `INV-NARROW: \`${entry.branch}\` is REAPED without a merged pull request based on \`main\`. `
            + 'The base-ref guard (#13503) is the property this file exists for: a reaper may only ever narrow here.',
        });
      }
    }

    for (const entry of buckets.mergedElsewhere ?? []) {
      checked++;
      const mine = prsFor(entry.branch);
      const merged = mine.filter((p) => p.merged_at);
      const intoMain = merged.filter((p) => p.base && p.base.ref === 'main');
      if (merged.length === 0 || intoMain.length > 0) {
        failures.push({
          id: s.id,
          message: `INV-HELD: \`${entry.branch}\` is held by the base-ref guard but ${merged.length === 0 ? 'has no merged pull request at all' : 'DID merge into main'} -- `
            + 'the guard does not get to quarantine branches it merely failed to classify.',
        });
      }
    }

    checked++;
    const placed = Object.values(buckets).flatMap((list) => list.map((e) => e.branch));
    const missing = candidates.map((b) => b.name).filter((name) => !placed.includes(name));
    const duplicated = placed.filter((name, i) => placed.indexOf(name) !== i);
    if (missing.length > 0 || duplicated.length > 0) {
      failures.push({
        id: s.id,
        message: `INV-PART: the buckets do not partition the candidates -- unplaced: [${missing.join(', ')}], placed twice: [${duplicated.join(', ')}]. `
          + 'A candidate in no bucket is invisible in the report and reads as "nothing to say about it".',
      });
    }

    checked++;
    if (!result.summary().includes('| MERGED, but not into')) {
      failures.push({
        id: s.id,
        message: 'INV-SHOWN: the rendered report has no row for the base-ref guard’s bucket. '
          + 'A bucket computed and not printed is a branch excluded in silence, which is the one shape a reader of the dry-run list cannot detect.',
      });
    }

    for (const f of s.check(result, t)) if (f) failures.push(f);
  }

  return { failures, checked };
}

// ── Reporting ───────────────────────────────────────────────────────────────

function reportProblems(problems) {
  console.error(`check-merged-branch-reaper-outcome: ${problems.length} input problem(s) -- the run is NOT a pass\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`
A harness that could not find its subject has verified nothing, so this exits
non-zero rather than reporting OK (#4690). Either ${WORKFLOW}
moved and this file must follow it, or the step it guards is gone -- and if it
is gone, deleting this check is the honest edit, not letting it pass.`);
}

async function main() {
  const root = repoRoot();
  const { source, problems } = extractScript(root);
  if (problems.length > 0) {
    reportProblems(problems);
    process.exit(1);
  }

  const { failures, checked } = await judge(source);
  if (failures.length === 0) {
    console.log(
      `check-merged-branch-reaper-outcome: OK (${checked} assertions over ${SCENARIOS.length} scenarios, ` +
        `driving the ${source.length}-char classifier extracted from ${WORKFLOW}).`,
    );
    process.exit(0);
  }

  console.error(`check-merged-branch-reaper-outcome: ${failures.length} failed assertion(s) over the SHIPPED script\n`);
  for (const f of failures) console.error(`  - [${f.id}] ${f.message}`);
  console.error(`
The subject is the inline classifier in ${WORKFLOW}, run
under doubles exactly as actions/github-script runs it. Fix the workflow, or --
if the contract genuinely changed -- change the scenario here and say so in the
PR body. Scenario table: node ${SELF} --list`);
  process.exit(1);
}

function list() {
  for (const s of SCENARIOS) console.log(`${s.id.padEnd(4)} ${s.name}`);
  console.log(`\n${SCENARIOS.length} scenarios over ${WORKFLOW}`);
}

// ── Self-test ────────────────────────────────────────────────────────────────

const MUTATIONS = [
  {
    id: 'M1',
    what: 'the base-ref guard is removed, so a branch merged anywhere is reaped (the #13503 defect, restored)',
    from: '} else if (intoMain.length === 0) {',
    to: '} else if (false) {',
    expect: ['G2', 'G3', 'G4'],
  },
  {
    id: 'M2',
    what: 'the guard stops reading the base, so every merge counts as a merge into main',
    from: 'const intoMain = merged.filter((pr) => pr.base && pr.base.ref === BASE_REF);',
    to: 'const intoMain = merged.slice();',
    expect: ['G2', 'G3', 'G4'],
  },
  {
    id: 'M3',
    what: 'the base constant names a branch this repo does not have, so nothing clears the guard',
    from: "const BASE_REF = 'main';",
    to: "const BASE_REF = 'trunk';",
    expect: ['G1', 'G5', 'G6'],
  },
  {
    id: 'M4',
    what: 'an absent base is read as main -- the fail-closed direction flipped',
    from: 'merged.filter((pr) => pr.base && pr.base.ref === BASE_REF)',
    to: 'merged.filter((pr) => !pr.base || pr.base.ref === BASE_REF)',
    expect: ['G4'],
  },
  {
    id: 'M5',
    what: 'a held branch stops being recorded, so the guard excludes it and the report never says so',
    from: 'buckets.mergedElsewhere.push({',
    to: 'void ({',
    expect: ['G2', 'G3', 'G4'],
  },
  {
    id: 'M6',
    what: 'the held bucket loses its row in the table, so its count is computed and never printed',
    from: 'lines.push(`| MERGED, but not into',
    to: 'if (false) lines.push(`| MERGED, but not into',
    expect: ['G1'],
  },
  {
    id: 'M7',
    what: 'the held branches stop being listed, so the human look the ruling requires has nothing to look at',
    from: '? sample(buckets.mergedElsewhere,',
    to: '? String(void 0) || sample([],',
    expect: ['G2'],
  },
  {
    id: 'M8',
    what: 'the held count stops reaching the step output',
    from: "core.setOutput('merged_elsewhere', String(n(buckets.mergedElsewhere)));",
    to: '',
    expect: ['G2'],
  },
  {
    id: 'M9',
    what: 'the open-PR precedence is dropped, so a branch with a live PR is reaped on an older merge',
    from: "buckets.open.push({ branch: branch.name, pr: open[0].number, note: 'also has a merged PR' });",
    to: 'void 0;',
    expect: ['P1'],
  },
  {
    id: 'M10',
    what: 'the grace comparison is flipped, so a branch merged an hour ago is reaped and an old one is held',
    from: 'new Date(newest.merged_at).getTime() > graceCutoff',
    to: 'new Date(newest.merged_at).getTime() < graceCutoff',
    expect: ['G1', 'G6'],
  },
  {
    id: 'M11',
    what: 'the defensive head-ref filter is dropped, so somebody else’s merged PR reaps this branch',
    from: 'const mine = prs.filter((pr) => pr.head && pr.head.ref === branch.name);',
    to: 'const mine = prs.slice();',
    expect: ['P3'],
  },
  {
    id: 'M12',
    what: 'the protected short-circuit is dropped',
    from: 'if (branch.protected) {',
    to: 'if (false) {',
    expect: ['P4'],
  },
];

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 -- a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-merged-branch-reaper-outcome self-test reached its verdict';

async function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };

  const root = repoRoot();
  const { source, problems } = extractScript(root);
  if (problems.length > 0) {
    reportProblems(problems);
    process.exit(1);
  }

  const failures = [];
  let checked = 0;
  const assert = (cond, msg) => {
    registerCase();
    checked++;
    if (!cond) failures.push(msg);
  };

  battery('1. The unmutated shipped script must be green -- otherwise every red below');
  const clean = await judge(source);
  assert(
    clean.failures.length === 0,
    `the shipped script is green before any mutation, got: ${clean.failures.map((f) => `[${f.id}] ${f.message}`).join(' | ')}`,
  );

  battery('2. Every mutation must be REACHED and must turn the battery red, in the');
  for (const m of MUTATIONS) {
    assert(source.includes(m.from), `${m.id}: its anchor is present in the shipped script (a no-op mutation proves nothing)`);
    if (!source.includes(m.from)) continue;
    const mutated = source.split(m.from).join(m.to);
    assert(mutated !== source, `${m.id}: the substitution changed the source`);
    const red = await judge(mutated);
    assert(red.failures.length > 0, `${m.id}: ${m.what} -- the battery goes RED`);
    for (const id of m.expect) {
      assert(
        red.failures.some((f) => f.id === id),
        `${m.id}: scenario ${id} is the one that catches it, got [${[...new Set(red.failures.map((f) => f.id))].join(', ')}]`,
      );
    }
  }

  battery('3. A script that does not compile is caught before any scenario runs.');
  const broken = await judge(`${source}\nconst github = 1;`);
  assert(broken.failures.length === 1 && broken.failures[0].id === 'C0', 'a non-compiling script is reported as C0, once');

  battery('4. Missing input is a failure, never a pass (#4690).');
  const gone = extractScript(join(root, 'scripts'));
  assert(gone.source === null && gone.problems.length === 1, 'a missing workflow file is an input problem, not a pass');

  battery('5. Wiring. A check nobody runs is the #4449 shape this repo keeps paying');
  const lint = join(root, LINT_WORKFLOW);
  assert(existsSync(lint), `wiring: ${LINT_WORKFLOW} exists -- it is where this check runs`);
  if (existsSync(lint)) {
    const body = readFileSync(lint, 'utf8');
    assert(body.includes(SELF), `wiring: ${LINT_WORKFLOW} still invokes ${SELF}`);
    assert(body.includes(`${SELF} --self-test`), `wiring: ${LINT_WORKFLOW} runs the --self-test half too`);
  }

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ───
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    failures.push(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} -- a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    failures.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES -- an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    failures.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN -- 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} -- cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    failures.push(
      'A battery at or below its floor means cases STOPPED RUNNING -- the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now skips) and restore it.',
    );
  }

  if (failures.length) {
    console.error(`✗ check-merged-branch-reaper-outcome --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ check-merged-branch-reaper-outcome --self-test: ${checked} assertions, `
      + `${MUTATIONS.length} mutations of the shipped script each driven to red.`,
  );

  return SELF_TEST_VERDICT;
}

// The CLI dispatch is guarded so that IMPORTING this module is inert: a module
// that runs its gate on import would judge whatever tree it was imported from
// and print a pass about the wrong subject.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    if ((await selfTest()) !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-merged-branch-reaper-outcome self-test: selfTest() returned without reaching its\n'
          + 'verdict, so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  }
  else if (process.argv.includes('--list')) list();
  else await main();
}
