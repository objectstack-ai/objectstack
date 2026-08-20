#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-merge-queue-triage-outcome -- run the SHIPPED merge-queue-triage script
// under doubles, against REAL captured failure logs, and hold its outcomes to
// contract.
//
//   node scripts/check-merge-queue-triage-outcome.mjs             # judge the shipped script
//   node scripts/check-merge-queue-triage-outcome.mjs --self-test # prove the battery can go red
//   node scripts/check-merge-queue-triage-outcome.mjs --list      # the scenario table
//
// ## Why this file exists (#10128)
//
// `.github/workflows/merge-queue-triage.yml` carries ~450 lines of inline
// `actions/github-script`, and it only ever runs on a RED merge_group build --
// a condition nobody can produce on demand and nobody wants to. Its two 2026-08-20
// limbs are exactly the kind that rot unnoticed:
//
//   limb (1) prints the failure REASON line beside the FAIL line. Green-on-a-
//     clean-corpus proves nothing about it, because the corpus that matters is
//     a log of a failure that already happened.
//   limb (2) files ONE anchor issue when the same failing test file has ejected
//     >= 2 DISTINCT pull requests in 24 h, and REFRESHES it rather than filing a
//     second one. Idempotency is a property of the PAIR of runs, and the second
//     run is the one nobody tests.
//
// So the subject here is the shipped bytes, driven twice where it matters, with
// real logs on the input side and a full call ledger on the output side.
//
// ## The method: the shipped bytes, never a copy
//
// The script is read out of the YAML with a real parser (`jobs -> triage ->
// steps[github-script] -> with.script`) and executed the way the action
// executes it:
//
//     new AsyncFunction('github', 'context', 'core', ..., source)
//
// A copy pasted into this file would be a test of the copy. Every failure to
// extract is a FAILURE rather than a skip (#4690): a renamed workflow, a moved
// job, a second github-script step, an empty `script:` -- each exits non-zero,
// because a harness that could not find its subject has verified nothing.
// Assertion C0 is the compile itself: github-script builds the whole block as
// one AsyncFunction body, and the sibling closer harness records a real
// 2026-08-02 run where that is what failed.
//
// ## The corpus, and where every byte of it came from
//
// `scripts/fixtures/merge-queue-triage/` holds three files. None is invented,
// and each states which half of the argument it carries:
//
//   plugin-dev-timeout.job-log.txt / plugin-dev-assertion.job-log.txt
//     Real vitest 4.1.10 output, captured in this repo on 2026-08-20 by running
//     the incident's OWN file --
//     `packages/plugins/plugin-dev/src/dev-plugin-security-enforcement-warning.test.ts`
//     at its pre-#10120 revision (7552e03375) -- against an unbuilt dependency
//     closure. That is the exact condition #10112 measured, and it reproduces
//     the assertion form verbatim (`start() published the service: expected
//     false to be true`). The timeout form is the same file and the same
//     command with `--testTimeout=1`, which produces vitest's real
//     `Error: Test timed out in 1ms.` line.
//
//     The pair is the whole point of limb (1): their FAIL lines are BYTE-
//     IDENTICAL and their reason lines are opposite diagnoses. Scenario E3
//     asserts that identity rather than describing it, so the fixtures cannot
//     drift into two obviously-different logs and leave the claim unproven.
//
//   incident-32333709633-published-excerpt.job-log.txt
//     Verbatim from the triage comment the bot POSTED on PR #10008 for queue
//     build 32333709633 (comment 5351634659), read back through the API. This
//     is what a human actually saw on 2026-08-20, and scenario E4 pins the two
//     defects visible in it: no reason line anywhere, and four of its seven
//     lines are `stdout | ...` noise admitted only by the multiplication sign
//     inside a test TITLE (`(#7986 x #7799/#8022)`) -- budget spent on nothing
//     while the deciding line was absent.
//
// Two properties of the fixtures are the harness's doing and are declared
// rather than hidden: the ESC byte is stored in its ESCAPE SPELLING (a raw 0x1b
// in a repo file is a `check:nul-bytes` failure) and materialised here, and the
// two vitest captures are prefixed with a synthetic runner timestamp by
// `asJobLog()` so the shipped script's timestamp-stripping path is exercised.
// The CONTENT lines are untouched.
//
// ## Nothing here touches the live repo
//
// There is no network in this file. `github` is a Proxy over hand-written
// stubs; an API the harness does not model is RECORDED and thrown, and `judge`
// fails the scenario on that record regardless of what the scenario's own
// assertions say -- the sibling closer harness measured why: an unstubbed
// method throws INSIDE the script's own `try` and is absorbed by whichever
// degradation branch is nearest, leaving a green assertion about a path the
// script no longer takes. That guard is also the enforcement of this
// workflow's stated boundary: if the script ever grows a call that re-queues,
// labels, or dispatches anything, no scenario has to anticipate it -- the
// unmodelled access fails the battery by itself.
//
// ## The self-test, and why it is not optional
//
// A battery over a script that is already correct is green on day one and green
// forever, including the day someone deletes what it guards. `--self-test`
// mutates the extracted source -- drop the reason lookahead, restore the
// anywhere-matching cross mark, let a FAIL borrow the next FAIL's reason, count
// runs instead of distinct PRs, aggregate over keys this run never hit, always
// create instead of refreshing, drop the sighting markers, drop each anti-no-op
// announcement, create an anchor without having established one does not exist,
// and move the redelivery guard below the aggregation -- and requires the
// battery to go RED for each, naming the scenario it expects. Each mutation
// also asserts its own anchor was PRESENT before substituting: a mutation that
// silently matched nothing would leave the battery green and read exactly like
// a passing self-test.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMap, isSeq, parseDocument } from 'yaml';

const WORKFLOW = '.github/workflows/merge-queue-triage.yml';
const JOB = 'triage';
const SELF = 'scripts/check-merge-queue-triage-outcome.mjs';
const FIXTURES = 'scripts/fixtures/merge-queue-triage';
const THIS_REPO = { owner: 'objectstack-ai', repo: 'objectstack' };
const WORKFLOW_ID = 4859;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

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

/**
 * The job's declared `permissions:`. Limb (2) writes an issue, and a workflow
 * that files issues without `issues: write` fails at RUN TIME, on a red queue
 * build, where nobody is watching -- so the grant is pinned next to the code
 * that needs it.
 */
export function extractPermissions(root) {
  const doc = parseDocument(readFileSync(join(root, WORKFLOW), 'utf8'));
  const perms = doc.getIn(['jobs', JOB, 'permissions']);
  return isMap(perms) ? Object.fromEntries(perms.items.map((p) => [String(p.key), String(p.value)])) : {};
}

// ── Corpus ──────────────────────────────────────────────────────────────────

const ESC = String.fromCharCode(27);

/** Read a fixture and materialise the ESC byte its stored form spells out. */
function fixture(root, name) {
  const path = join(root, FIXTURES, name);
  if (!existsSync(path)) throw new Error(`${SELF}: fixture ${FIXTURES}/${name} is missing -- the corpus is the evidence, so this is a failure, not a skip.`);
  return readFileSync(path, 'utf8').split('\\u001b').join(ESC);
}

/**
 * Wrap captured tool output in the runner's line prefix.
 *
 * GitHub Actions stamps every job-log line with an ISO timestamp, and the
 * shipped script strips it. The captures are real vitest output taken outside
 * Actions, so the prefix is added HERE -- declared, uniform, and applied to
 * nothing but the line start.
 */
function asJobLog(text) {
  return text.split('\n').map((l) => `2026-08-20T05:01:00.7629588Z ${l}`).join('\n');
}

// ── Doubles ─────────────────────────────────────────────────────────────────

/** An octokit-shaped rejection: `status` is what the script's `describe` reads. */
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const MODELLED_ISSUE_METHODS = new Set([
  'listComments', 'createComment', 'listCommentsForRepo', 'listForRepo', 'create', 'update',
]);
const MODELLED_ACTION_METHODS = new Set(['listJobsForWorkflowRun', 'listWorkflowRunsForRepo']);

/**
 * `github` / `context` / `core` doubles plus a full call ledger.
 *
 * Every field of `world` is a fact the script can read; every entry of `calls`
 * is a write it made. Scenarios are written against both, because "did not do
 * the wrong thing" is as load-bearing here as "did the right thing" -- the
 * workflow's declared boundary is that it names and aggregates and DECIDES
 * NOTHING.
 */
function makeDoubles(world) {
  const w = {
    runId: 90000001,
    prNumber: 10008,
    workflowId: WORKFLOW_ID,
    headBranch: `gh-readonly-queue/main/pr-10008-${'a'.repeat(40)}`,
    jobs: [],
    logs: {},
    logErrors: {},
    prComments: [],
    prCommentsError: null,
    repoComments: [],
    repoCommentPages: null,
    repoCommentsError: null,
    openIssues: [],
    openIssuePages: null,
    listIssuesError: null,
    createIssueError: null,
    updateIssueError: null,
    queueRuns: [],
    prCommentPostError: null,
    ...world,
  };

  const calls = {
    listComments: [], listCommentsForRepo: [], listForRepo: [],
    createComment: [], issueCreate: [], issueUpdate: [], logs: [],
  };
  const log = { info: [], warning: [], failed: [], summary: [] };
  const unstubbedCalls = [];
  let summaryBuffer = [];

  const issuesApi = {
    async listComments({ issue_number: n }) {
      calls.listComments.push(n);
      if (w.prCommentsError) throw w.prCommentsError;
      return { data: w.prComments.map((body) => ({ body })) };
    },
    async createComment({ issue_number: n, body }) {
      calls.createComment.push({ issue_number: n, body });
      if (w.prCommentPostError) throw w.prCommentPostError;
      return { data: { id: 1 } };
    },
    async listCommentsForRepo({ page = 1, per_page: perPage = 100, since }) {
      calls.listCommentsForRepo.push({ page, perPage, since });
      if (w.repoCommentsError) throw w.repoCommentsError;
      // `repoCommentPages` forces the truncation case: every page comes back
      // full, so the script can never reach the end of the window.
      if (w.repoCommentPages !== null) {
        return { data: Array.from({ length: perPage }, () => ({ body: w.repoComments[0] ?? '' })) };
      }
      return { data: page === 1 ? w.repoComments.map((body) => ({ body })) : [] };
    },
    async listForRepo({ page = 1, per_page: perPage = 100, state, labels }) {
      calls.listForRepo.push({ page, perPage, state, labels });
      if (w.listIssuesError) throw w.listIssuesError;
      if (w.openIssuePages !== null) {
        return { data: Array.from({ length: perPage }, (_, i) => ({ number: 900000 + i, title: 'unrelated finding', body: 'nothing' })) };
      }
      return { data: page === 1 ? w.openIssues : [] };
    },
    async create({ title, body, labels }) {
      if (w.createIssueError) throw w.createIssueError;
      const number = 20000 + calls.issueCreate.length;
      calls.issueCreate.push({ number, title, body, labels });
      return { data: { number, title, body } };
    },
    async update({ issue_number: n, body }) {
      if (w.updateIssueError) throw w.updateIssueError;
      calls.issueUpdate.push({ issue_number: n, body });
      return { data: {} };
    },
  };

  const actionsApi = {
    async listJobsForWorkflowRun() { return { data: w.jobs }; },
    async listWorkflowRunsForRepo() { return { data: w.queueRuns }; },
  };

  // An unmodelled API call must be LOUD, and a throw alone is not loud enough:
  // every call in the script sits inside a `try`, so a `TypeError` from an
  // unstubbed method is caught and absorbed into whichever degradation that
  // `catch` implements -- leaving the battery green over a behaviour it never
  // exercised. So the access is RECORDED as well as thrown, and `judge` fails
  // the scenario on the record.
  const guard = (impl, path, allowed) =>
    new Proxy(impl, {
      get(t, prop, receiver) {
        if (typeof prop === 'string' && !allowed.has(prop)) {
          unstubbedCalls.push(`${path}.${prop}`);
          throw new Error(
            `${SELF}: the shipped script now uses \`${path}.${prop}\`, which this harness does not ` +
              'stub. Model it here rather than letting a scenario absorb it.',
          );
        }
        return Reflect.get(t, prop, receiver);
      },
    });

  const rest = guard(
    {
      issues: guard(issuesApi, 'github.rest.issues', MODELLED_ISSUE_METHODS),
      actions: guard(actionsApi, 'github.rest.actions', MODELLED_ACTION_METHODS),
    },
    'github.rest',
    new Set(['issues', 'actions']),
  );

  const github = guard(
    {
      rest,
      async paginate(fn, params) { return (await fn(params)).data; },
      async request(route, params) {
        calls.logs.push(params.job_id);
        if (!/\/logs$/.test(route)) {
          unstubbedCalls.push(`github.request(${route})`);
          throw new Error(`${SELF}: unmodelled request route ${route}`);
        }
        const err = w.logErrors[params.job_id];
        if (err) throw err;
        return { data: w.logs[params.job_id] ?? '' };
      },
    },
    'github',
    new Set(['rest', 'paginate', 'request']),
  );

  const summary = {
    addRaw(text) { summaryBuffer.push(text); return summary; },
    async write() { log.summary.push(summaryBuffer.join('')); summaryBuffer = []; return summary; },
  };

  const core = {
    info: (m) => log.info.push(String(m)),
    warning: (m, props) => log.warning.push({ message: String(m), props: props ?? null }),
    setFailed: (m) => log.failed.push(String(m)),
    summary,
  };

  const context = {
    repo: { ...THIS_REPO },
    payload: {
      workflow_run: {
        id: w.runId,
        workflow_id: w.workflowId,
        head_branch: w.headBranch,
        html_url: `https://github.com/objectstack-ai/objectstack/actions/runs/${w.runId}`,
      },
    },
  };

  return { github, context, core, calls, log, unstubbedCalls, world: w };
}

/** Anything github-script hands the script that this harness does not model. */
function unstubbed(name, sink) {
  return new Proxy({}, {
    get(_t, prop) {
      sink.push(typeof prop === 'string' ? `${name}.${prop}` : name);
      throw new Error(
        `${SELF}: the shipped script now uses \`${name}\`, which this harness does not stub. ` +
          'Model it here rather than deleting the assertion that found it.',
      );
    },
  });
}

/** Run the script exactly as `actions/github-script` does. */
async function runScript(source, world) {
  const doubles = makeDoubles(world);
  const args = {
    github: doubles.github,
    context: doubles.context,
    core: doubles.core,
    exec: unstubbed('exec', doubles.unstubbedCalls),
    glob: unstubbed('glob', doubles.unstubbedCalls),
    io: unstubbed('io', doubles.unstubbedCalls),
    fetch: unstubbed('fetch', doubles.unstubbedCalls),
    require: createRequire(import.meta.url),
    __original_require__: createRequire(import.meta.url),
  };
  const fn = new AsyncFunction(...Object.keys(args), source);
  let threw = null;
  try {
    await fn(...Object.values(args));
  } catch (err) {
    threw = err;
  }
  return { ...doubles, threw };
}

// ── World builders ──────────────────────────────────────────────────────────

const KEY_A = 'src/dev-plugin-security-enforcement-warning.test.ts';
const KEY_B = 'src/webhook-secret-at-rest.test.ts';

const shardJob = (id, name = 'Test Core (3/3)') => ({
  id,
  name,
  html_url: `https://github.com/objectstack-ai/objectstack/actions/runs/1/job/${id}`,
  conclusion: 'failure',
  steps: [{ name: "Run this shard's tests", conclusion: 'failure' }],
});

/** The comment body a previous ejection left behind, as the ledger reads it. */
const sightingComment = (key, pr, runId) =>
  `### merge queue build failed\n<!-- merge-queue-triage:${runId} -->\n<!-- queue-signature:${key}|pr=${pr}|run=${runId} -->`;

/** The anchor issue an earlier pair already produced. */
const anchorIssue = (number, key) => ({
  number,
  title: `Queue-flake anchor: ${key}`,
  body: `earlier body\n<!-- queue-signature-anchor:${key} -->`,
});

/** The one comment the script posted in `result`, or ''. */
const postedBody = (r) => r.calls.createComment[0]?.body ?? '';

/**
 * The fenced excerpt lines the comment carries, as an array.
 *
 * Read out of the code fences rather than grepped out of the whole body: the
 * comment's own explanatory prose names both `FAIL` and `AssertionError`, so a
 * grep would let the static text satisfy assertions about the EXTRACTION.
 */
const excerptLines = (r) => {
  const out = [];
  let inFence = false;
  for (const raw of postedBody(r).split('\n')) {
    const l = raw.trim();
    if (l === '```') { inFence = !inFence; continue; }
    if (inFence) out.push(l);
  }
  return out;
};

// ── Scenarios ───────────────────────────────────────────────────────────────

const REFUSED = httpError(503, 'No server is currently available to service your request.');

function scenarios(root) {
  const TIMEOUT_LOG = asJobLog(fixture(root, 'plugin-dev-timeout.job-log.txt'));
  const ASSERTION_LOG = asJobLog(fixture(root, 'plugin-dev-assertion.job-log.txt'));
  const PUBLISHED = fixture(root, 'incident-32333709633-published-excerpt.job-log.txt');

  // Two FAIL lines back to back, the first without a reason of its own. The
  // lookahead must NOT hand the second one's reason to the first.
  const BORROW_LOG = asJobLog([
    ' FAIL  src/orphan.test.ts > suite > a failure whose reason line never printed',
    ' FAIL  src/neighbour.test.ts > suite > the next failure, which does have one',
    'AssertionError: expected 1 to be 2 // Object.is equality',
  ].join('\n'));

  // The two timeout spellings vitest emits that the incident did not produce.
  // Synthetic, and labelled as such: the hook form is quoted verbatim in
  // plugin-dev's own file header (`Hook timed out in 10000ms`, four queue
  // ejections in one night), the teardown form is vitest's third timeout knob.
  const OTHER_TIMEOUTS_LOG = asJobLog([
    ' FAIL  src/hooked.test.ts > suite > a hook that outran its budget',
    'Error: Hook timed out in 10000ms.',
    ' FAIL  src/torn.test.ts > suite > a teardown that outran its budget',
    'Error: Teardown timed out in 10000ms.',
  ].join('\n'));

  const base = (over = {}) => ({
    jobs: [shardJob(111)],
    logs: { 111: TIMEOUT_LOG },
    ...over,
  });

  return [
    // ── limb (1): the reason line ──────────────────────────────────────────
    {
      id: 'E1',
      name: 'a real TIMEOUT log: the excerpt names `Test timed out`, labelled',
      world: () => base(),
      check(r, t) {
        const lines = excerptLines(r);
        return [
          t(lines.some((l) => l.includes(`FAIL  ${KEY_A}`)), 'the FAIL line is excerpted'),
          t(lines.some((l) => l.startsWith('↳ 失败原因:') && l.includes('Error: Test timed out in 1ms.')),
            `the reason line is excerpted and labelled, got: ${JSON.stringify(lines)}`),
          t(!lines.some((l) => l.includes('AssertionError')), 'no assertion is reported for a timeout log'),
        ];
      },
    },
    {
      id: 'E2',
      name: 'a real ASSERTION log: the excerpt names the AssertionError, labelled',
      world: () => base({ logs: { 111: ASSERTION_LOG } }),
      check(r, t) {
        const lines = excerptLines(r);
        return [
          t(lines.some((l) => l.includes(`FAIL  ${KEY_A}`)), 'the FAIL line is excerpted'),
          t(lines.some((l) => l.startsWith('↳ 失败原因:')
            && l.includes('AssertionError: SecurityPlugin.init() ran: expected false to be true')),
            `the assertion is excerpted and labelled, got: ${JSON.stringify(lines)}`),
          t(!lines.some((l) => l.includes('timed out')), 'no timeout is reported for an assertion log'),
        ];
      },
    },
    {
      id: 'E3',
      name: 'the two real logs share IDENTICAL FAIL lines and differ ONLY in the reason',
      world: () => base(),
      rerun: () => base({ logs: { 111: ASSERTION_LOG } }),
      check(r, t, first) {
        const fails = (x) => excerptLines(x).filter((l) => l.startsWith('FAIL'));
        const reasons = (x) => excerptLines(x).filter((l) => l.startsWith('↳ 失败原因:'));
        const sharedFails = fails(first).filter((l) => fails(r).includes(l));
        return [
          t(sharedFails.length > 0,
            'the timeout run and the assertion run excerpt at least one identical FAIL line -- '
            + 'that identity is the defect limb (1) exists for, so the corpus must keep exhibiting it'),
          t(reasons(first).length > 0 && reasons(r).length > 0, 'both runs excerpt a reason'),
          t(reasons(first).every((l) => !reasons(r).includes(l)),
            'no reason line is shared between the two -- the reason is what separates them'),
        ];
      },
    },
    {
      id: 'E4',
      name: 'the excerpt the bot really published: no reason in it, and the x-noise is gone',
      world: () => base({ logs: { 111: PUBLISHED } }),
      check(r, t) {
        const lines = excerptLines(r);
        return [
          t(lines.filter((l) => l.startsWith('FAIL')).length === 3,
            `all three real FAIL lines survive, got ${lines.filter((l) => l.startsWith('FAIL')).length}`),
          t(!lines.some((l) => l.includes('stdout |')),
            'the four `stdout | ...` lines, admitted only by the multiplication sign inside a test '
            + `TITLE, are no longer excerpted, got: ${JSON.stringify(lines)}`),
          t(lines.filter((l) => l.startsWith('↳ 失败原因:')).every((l) => l.includes('没有可识别的原因行')),
            'the published excerpt is reported as carrying no reason line -- which is exactly what a '
            + 'reader had on 2026-08-20, and is why one was diagnosed wrongly'),
        ];
      },
    },
    {
      id: 'E5',
      name: 'a reason is never borrowed from the NEXT failure',
      world: () => base({ logs: { 111: BORROW_LOG } }),
      check(r, t) {
        const lines = excerptLines(r);
        const orphanIdx = lines.findIndex((l) => l.includes('src/orphan.test.ts'));
        return [
          t(orphanIdx >= 0, 'the reasonless FAIL line is excerpted'),
          t(lines[orphanIdx + 1]?.includes('没有可识别的原因行'),
            `the reasonless FAIL reports NO reason rather than the next failure's, got: ${JSON.stringify(lines)}`),
          t(lines.some((l) => l.startsWith('↳ 失败原因:') && l.includes('AssertionError: expected 1 to be 2')),
            `the next failure still gets its own reason, labelled, got: ${JSON.stringify(lines)}`),
        ];
      },
    },
    {
      id: 'E6',
      name: 'hook and teardown timeouts are recognised reasons too',
      world: () => base({ logs: { 111: OTHER_TIMEOUTS_LOG } }),
      check(r, t) {
        const lines = excerptLines(r);
        return [
          t(lines.some((l) => l.startsWith('↳ 失败原因:') && l.includes('Hook timed out in 10000ms')),
            `the hook-timeout spelling is recognised, got: ${JSON.stringify(lines)}`),
          t(lines.some((l) => l.startsWith('↳ 失败原因:') && l.includes('Teardown timed out in 10000ms')),
            'the teardown-timeout spelling is recognised'),
        ];
      },
    },

    // ── limb (2): cross-PR aggregation ────────────────────────────────────
    {
      id: 'A1',
      name: 'POSITIVE: the same key on a SECOND distinct PR files exactly ONE anchor',
      world: () => base({
        prNumber: 10008,
        headBranch: `gh-readonly-queue/main/pr-10008-${'a'.repeat(40)}`,
        repoComments: [sightingComment(KEY_A, 10105, 32328768059)],
      }),
      check(r, t) {
        const created = r.calls.issueCreate;
        return [
          t(created.length === 1, `exactly one anchor issue is filed, got ${created.length}`),
          t(r.calls.issueUpdate.length === 0, 'nothing is refreshed -- there was nothing to refresh'),
          t((created[0]?.body ?? '').includes(`<!-- queue-signature-anchor:${KEY_A} -->`),
            'the anchor carries the stable per-key marker that makes it findable next time'),
          t(/\|\s*#10105\s*\|/.test(created[0]?.body ?? '') && /\|\s*#10008\s*\|/.test(created[0]?.body ?? ''),
            `both victim PRs are listed in the anchor, got: ${JSON.stringify(created[0]?.body ?? '')}`),
          t((created[0]?.title ?? '') === `Queue-flake anchor: ${KEY_A}`,
            'the title is stable across refreshes -- a count in it would make the anchor unfindable'),
          t(postedBody(r).includes(`#${created[0]?.number}`),
            "the victim's comment links the anchor"),
          t(postedBody(r).includes(`<!-- queue-signature:${KEY_A}|pr=10008|run=${r.world.runId} -->`),
            'this ejection records its own sighting for the next one to read'),
        ];
      },
    },
    {
      id: 'A2',
      name: 'IDEMPOTENCY: a THIRD ejection REFRESHES the open anchor and files no second one',
      // Driven as a pair: run 1 produces the anchor and the comment, run 2's
      // world is built out of run 1's OUTPUT. A fixture that hand-wrote the
      // anchor would prove each half while leaving the two runs free to
      // disagree about the marker's spelling, which is the only way this can
      // actually break.
      world: () => base({
        prNumber: 10008,
        headBranch: `gh-readonly-queue/main/pr-10008-${'a'.repeat(40)}`,
        repoComments: [sightingComment(KEY_A, 10105, 32328768059)],
      }),
      rerun: (first) => base({
        runId: 90000002,
        prNumber: 10003,
        headBranch: `gh-readonly-queue/main/pr-10003-${'b'.repeat(40)}`,
        repoComments: [
          sightingComment(KEY_A, 10105, 32328768059),
          postedBody(first),
        ],
        openIssues: first.calls.issueCreate.map((c) => ({ number: c.number, title: c.title, body: c.body })),
      }),
      check(r, t, first) {
        const anchor = first.calls.issueCreate[0];
        return [
          t(first.calls.issueCreate.length === 1, 'the first run filed the anchor'),
          t(r.calls.issueCreate.length === 0,
            `the second run files NO new anchor, got ${r.calls.issueCreate.length}`),
          t(r.calls.issueUpdate.length === 1 && r.calls.issueUpdate[0].issue_number === anchor?.number,
            `the second run REFRESHES the same anchor (#${anchor?.number}), got ${JSON.stringify(r.calls.issueUpdate)}`),
          t(/\|\s*#10105\s*\|/.test(r.calls.issueUpdate[0]?.body ?? '')
            && /\|\s*#10008\s*\|/.test(r.calls.issueUpdate[0]?.body ?? '')
            && /\|\s*#10003\s*\|/.test(r.calls.issueUpdate[0]?.body ?? ''),
            `the refreshed body lists all three victims, got: ${JSON.stringify(r.calls.issueUpdate[0]?.body ?? '')}`),
          t(postedBody(r).includes(`#${anchor?.number}`), "the third victim's comment links the SAME anchor"),
        ];
      },
    },
    {
      id: 'A3',
      name: 'NEGATIVE: two ejections with DIFFERENT keys produce no anchor at all',
      world: () => base({
        prNumber: 10008,
        // The ledger carries another PR's ejection on a DIFFERENT key, and that
        // key has itself already been seen twice. Neither fact may reach this
        // run: an ejection must not file an anchor for a signature it did not hit.
        repoComments: [
          sightingComment(KEY_B, 10105, 32328768059),
          sightingComment(KEY_B, 10003, 32328768060),
        ],
      }),
      check(r, t) {
        return [
          t(r.calls.issueCreate.length === 0, `no anchor is filed, got ${r.calls.issueCreate.length}`),
          t(r.calls.issueUpdate.length === 0, 'nothing is refreshed either'),
          t(postedBody(r).includes('只有本 PR 撞到过'),
            'the comment says this key has been seen on this PR alone -- "seen once" must not read like "not looked at"'),
        ];
      },
    },
    {
      id: 'A4',
      name: 'NEGATIVE: the SAME PR twice is one distinct PR, and files no anchor',
      world: () => base({
        prNumber: 10008,
        repoComments: [
          sightingComment(KEY_A, 10008, 32328768059),
          sightingComment(KEY_A, 10008, 32328768060),
        ],
      }),
      check(r, t) {
        return [
          t(r.calls.issueCreate.length === 0,
            `two ejections of ONE PR are not >= 2 distinct PRs, got ${r.calls.issueCreate.length} anchor(s)`),
          t(r.calls.issueUpdate.length === 0, 'nothing is refreshed either'),
          t(postedBody(r).includes('只有本 PR 撞到过'), 'the comment reports it as a single-PR signature'),
        ];
      },
    },
    {
      id: 'A5',
      name: 'a REDELIVERED workflow_run writes nothing at all -- comment, anchor or ledger',
      world: () => base({
        prNumber: 10008,
        prComments: [`already here\n<!-- merge-queue-triage:90000001 -->`],
        repoComments: [sightingComment(KEY_A, 10105, 32328768059)],
      }),
      check(r, t) {
        return [
          t(r.calls.createComment.length === 0, 'no second comment'),
          t(r.calls.issueCreate.length === 0 && r.calls.issueUpdate.length === 0,
            'no anchor is filed or refreshed -- one queue build contributes its signature once, '
            + `however many times GitHub delivers it, got ${JSON.stringify({ c: r.calls.issueCreate.length, u: r.calls.issueUpdate.length })}`),
          t(r.calls.listCommentsForRepo.length === 0, 'the ledger is not even read'),
        ];
      },
    },
    {
      id: 'A6',
      name: 'ANTI-NO-OP: unreadable logs announce "not measured", never "nothing found"',
      world: () => base({ logs: {}, logErrors: { 111: REFUSED } }),
      check(r, t) {
        return [
          t(r.calls.issueCreate.length === 0, 'no anchor is filed from an unread log'),
          t(r.log.warning.some((x) => /nothing to key on/i.test(x.props?.title ?? '')),
            `the run is annotated, got titles: ${JSON.stringify(r.log.warning.map((x) => x.props?.title))}`),
          t(postedBody(r).includes('这一轮没测到'),
            'the comment distinguishes an absent measurement from an absent signal'),
        ];
      },
    },
    {
      id: 'A7',
      name: 'ANTI-NO-OP: a truncated 24h ledger reports its counts as LOWER BOUNDS',
      world: () => base({
        repoComments: [sightingComment(KEY_A, 10105, 32328768059)],
        repoCommentPages: 'full',
      }),
      check(r, t) {
        return [
          t(r.log.warning.some((x) => /ledger incomplete/i.test(x.props?.title ?? '')),
            `the run is annotated, got titles: ${JSON.stringify(r.log.warning.map((x) => x.props?.title))}`),
          t(postedBody(r).includes('下界'), 'the comment says the distinct-PR count is a lower bound'),
        ];
      },
    },
    {
      id: 'A8',
      name: 'an anchor is NOT created while its absence is unestablished',
      world: () => base({
        repoComments: [sightingComment(KEY_A, 10105, 32328768059)],
        openIssuePages: 'full',
      }),
      check(r, t) {
        return [
          t(r.calls.issueCreate.length === 0,
            `a duplicate anchor is worse than a late one, got ${r.calls.issueCreate.length} created`),
          t(r.log.warning.some((x) => /anchor not created/i.test(x.props?.title ?? '')),
            `the run is annotated, got titles: ${JSON.stringify(r.log.warning.map((x) => x.props?.title))}`),
          t(postedBody(r).includes('避免开出重复的锚点'), 'the comment explains why no anchor appeared'),
        ];
      },
    },
    {
      id: 'A9',
      name: 'a refused anchor write costs the job nothing, and the comment carries the facts anyway',
      world: () => base({
        repoComments: [sightingComment(KEY_A, 10105, 32328768059)],
        createIssueError: REFUSED,
      }),
      check(r, t) {
        return [
          t(r.log.failed.length === 0,
            `the job is NOT failed by an anchor refusal -- the invariant this workflow publishes is about the COMMENT, got: ${JSON.stringify(r.log.failed)}`),
          t(r.calls.createComment.length === 1, 'the triage comment is still delivered'),
          t(/#10105/.test(postedBody(r)) && /#10008/.test(postedBody(r)),
            'the victim list is in the comment, so no fact existed only in the failed request'),
          t(r.log.warning.some((x) => /anchor not created/i.test(x.props?.title ?? '')), 'and it is annotated'),
        ];
      },
    },
    {
      id: 'A10',
      name: 'a non-queue branch is still ignored, and the aggregation never starts',
      world: () => base({ headBranch: 'main' }),
      check(r, t) {
        return [
          t(r.calls.createComment.length === 0, 'no comment on a non-queue run'),
          t(r.calls.issueCreate.length === 0 && r.calls.issueUpdate.length === 0, 'and no anchor'),
          t(r.calls.logs.length === 0, 'and no job logs are pulled'),
        ];
      },
    },
    {
      id: 'A11',
      name: 'delivery refusal still fails the job and still reproduces the whole triage in the summary',
      world: () => base({
        repoComments: [sightingComment(KEY_A, 10105, 32328768059)],
        prCommentPostError: REFUSED,
      }),
      check(r, t) {
        return [
          t(r.log.failed.length === 1, `the job fails, got ${JSON.stringify(r.log.failed)}`),
          t(r.log.summary.length === 1 && r.log.summary[0].includes('FAIL'),
            'the diagnosis is written where it outlives the request'),
          t(r.log.summary[0].includes('跨 PR 聚合账本读的就是这些评论'),
            'the summary says the sighting was lost with the comment -- the ledger reads comments, '
            + 'so an undelivered comment is invisible to every later aggregation'),
        ];
      },
    },
  ];
}

// ── Judge ───────────────────────────────────────────────────────────────────

export async function judge(source, root) {
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

  // The permission grant limb (2) needs. A workflow that files issues without
  // it fails at run time, on a red queue build, where nobody is watching.
  const perms = extractPermissions(root);
  checked++;
  if (perms.issues !== 'write') {
    failures.push({ id: 'P0', message: `job \`${JOB}\` must declare \`issues: write\` -- limb (2) files and refreshes an issue. Got: ${JSON.stringify(perms)}` });
  }
  checked++;
  if (perms['pull-requests'] !== 'write') {
    failures.push({ id: 'P0', message: `job \`${JOB}\` must keep \`pull-requests: write\` -- the comment is the primary signal. Got: ${JSON.stringify(perms)}` });
  }

  for (const s of scenarios(root)) {
    const t = (cond, message) => { checked++; return cond ? null : { id: s.id, message }; };
    let result;
    let first = null;
    try {
      result = await runScript(source, s.world());
      if (typeof s.rerun === 'function') {
        first = result;
        result = await runScript(source, s.rerun(first));
      }
    } catch (err) {
      failures.push({ id: s.id, message: `the harness itself threw -- ${err.message}` });
      continue;
    }
    // Checked for EVERY scenario, ahead of its own assertions: an API the
    // harness does not model is swallowed by the script's own `catch` and
    // reported as a degradation, so no scenario assertion can be trusted to
    // notice it. This is also where the workflow's "decides nothing" boundary
    // is enforced -- a re-queue, a label write or a dispatch would arrive here
    // as an unmodelled call and fail the battery without any scenario having
    // had to anticipate it.
    for (const name of new Set([...(first?.unstubbedCalls ?? []), ...result.unstubbedCalls])) {
      checked++;
      failures.push({
        id: s.id,
        message: `the shipped script called \`${name}()\`, which this harness does not model -- `
          + "the script's own catch absorbed it, so this scenario verified a degradation path rather "
          + 'than the behaviour it names. Model the call in `makeDoubles` (and if it MUTATES anything '
          + 'beyond the triage comment and the anchor issue, read this workflow\'s boundary first).',
      });
    }
    for (const f of s.check(result, t, first)) if (f) failures.push(f);
  }

  return { failures, checked };
}

// ── Reporting ───────────────────────────────────────────────────────────────

function reportProblems(problems) {
  console.error(`check-merge-queue-triage-outcome: ${problems.length} input problem(s) -- the run is NOT a pass\n`);
  for (const p of problems) console.error(`  • ${p}`);
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
  const { failures, checked } = await judge(source, root);
  if (failures.length === 0) {
    console.log(
      `check-merge-queue-triage-outcome: OK (${checked} assertions over ${scenarios(root).length} scenarios, `
        + `driving the ${source.length}-char script extracted from ${WORKFLOW} against real captured logs).`,
    );
    process.exit(0);
  }
  console.error(`check-merge-queue-triage-outcome: ${failures.length} failed assertion(s) over the SHIPPED script\n`);
  for (const f of failures) console.error(`  • [${f.id}] ${f.message}`);
  console.error(`
The subject is the inline script in ${WORKFLOW}, run
under doubles exactly as actions/github-script runs it, over the real captured
logs in ${FIXTURES}/. Fix the workflow, or -- if the
contract genuinely changed -- change the scenario here and say so in the PR
body. Scenario table: node ${SELF} --list`);
  process.exit(1);
}

function list() {
  const root = repoRoot();
  for (const s of scenarios(root)) console.log(`${s.id.padEnd(4)} ${s.name}`);
  console.log(`\n${scenarios(root).length} scenarios over ${WORKFLOW}`);
}

// ── Self-test ───────────────────────────────────────────────────────────────
//
// Each mutation states the anchor it needs. A mutation whose anchor is absent
// is a FAILURE here, not a skip: the substitution would then be a no-op, the
// battery would stay green, and the self-test would report a detector it never
// exercised.

const MUTATIONS = [
  {
    id: 'M1',
    what: 'the reason lookahead is removed, restoring the excerpt that burned 2026-08-20',
    from: '          if (REASON_LINE.test(all[j])) { reason = all[j].trim().slice(0, 200); break; }',
    to: '',
    expect: ['E1', 'E2', 'E3', 'E5', 'E6'],
  },
  {
    id: 'M2',
    what: 'the cross marks go back to matching ANYWHERE, so a test TITLE re-enters the excerpt',
    from: 'const FAIL_LINE = /^\\s*(?:\u2717|\u00d7|\u2715)\\s|(?:^|[\\s|])(?:FAIL\\s|AssertionError|STALL)/;',
    to: 'const FAIL_LINE = /(?:^|[\\s|])(?:\u2717|\u00d7|\u2715|FAIL\\s|AssertionError|STALL)/;',
    expect: ['E4'],
  },
  {
    id: 'M3',
    what: 'the lookahead stops at nothing, so one failure borrows the next one\'s reason',
    from: '          if (FAIL_LINE.test(all[j])) break;',
    to: '',
    expect: ['E5'],
  },
  {
    id: 'M3b',
    what: 'the FAIL pattern is tested BEFORE the reason pattern, so `AssertionError` breaks the scan on the line it wanted',
    from: '          if (REASON_LINE.test(all[j])) { reason = all[j].trim().slice(0, 200); break; }\n          if (FAIL_LINE.test(all[j])) break;',
    to: '          if (FAIL_LINE.test(all[j])) break;\n          if (REASON_LINE.test(all[j])) { reason = all[j].trim().slice(0, 200); break; }',
    expect: ['E2'],
  },
  {
    id: 'M4',
    what: 'one sighting is enough to file an anchor',
    from: '  .filter((a) => a.prs.size >= 2)',
    to: '  .filter((a) => a.prs.size >= 1)',
    expect: ['A3', 'A4'],
  },
  {
    id: 'M5',
    what: 'RUNS are counted instead of DISTINCT PRs, so one PR ejecting twice files an anchor',
    from: '  .filter((a) => a.prs.size >= 2)',
    to: '  .filter((a) => [...a.prs.values()].reduce((n, x) => n + x.size, 0) >= 2)',
    expect: ['A4'],
  },
  {
    id: 'M6',
    what: 'every key in the ledger is aggregated, not only the ones THIS ejection hit',
    from: 'const aggregated = runKeys',
    to: 'const aggregated = [...sightings.keys()]',
    expect: ['A3'],
  },
  {
    id: 'M7',
    what: 'an existing anchor is ignored, so every ejection files another one (the duplication claim)',
    from: '  if (existing) {',
    to: '  if (false) {',
    expect: ['A2'],
  },
  {
    id: 'M8',
    what: 'the comment stops carrying sighting markers, so the 24h ledger has nothing to read',
    from: 'const sightingMarkers = runKeys.map((k) => `<!-- queue-signature:${k}|pr=${prNumber}|run=${run.id} -->`);',
    to: 'const sightingMarkers = [];',
    expect: ['A1', 'A2'],
  },
  {
    id: 'M9',
    what: 'the "nothing to key on" announcement is downgraded to an info line, so an unread log reads like a clean one',
    from: '  core.warning(\n    `No signature key could be derived',
    to: '  core.info(\n    `No signature key could be derived',
    expect: ['A6'],
  },
  {
    id: 'M10',
    what: 'the truncated-ledger announcement is downgraded, so a lower bound reads like a count',
    from: '  core.warning(\n    `The 24h sighting ledger was truncated',
    to: '  core.info(\n    `The 24h sighting ledger was truncated',
    expect: ['A7'],
  },
  {
    id: 'M11',
    what: 'an anchor is created without having established that none exists',
    from: '  if (!scanComplete) {',
    to: '  if (false) {',
    expect: ['A8'],
  },
  {
    id: 'M12',
    what: 'an anchor refusal is escalated to a job failure, breaking the published comment invariant',
    from: '    core.warning(`Could not file the anchor issue for ${a.key} (${describe(error)}).`,',
    to: '    core.setFailed(`Could not file the anchor issue for ${a.key} (${describe(error)}).`,',
    expect: ['A9'],
  },
  {
    id: 'M13',
    what: 'the redelivery guard stops returning, so a repeated delivery re-posts and double-counts its own signature',
    from: "  core.info('triage comment for this run already exists \u2014 skipping.');\n  return;",
    to: "  core.info('triage comment for this run already exists \u2014 skipping.');",
    expect: ['A5'],
  },
];

async function selfTest() {
  const root = repoRoot();
  const { source, problems } = extractScript(root);
  if (problems.length > 0) {
    reportProblems(problems);
    process.exit(1);
  }

  const failures = [];
  let checked = 0;
  const assert = (cond, msg) => { checked++; if (!cond) failures.push(msg); };

  // 1. The unmutated shipped script must be green -- otherwise every red below
  //    proves nothing about the mutation.
  const clean = await judge(source, root);
  assert(clean.failures.length === 0,
    `the shipped script is green before any mutation, got: ${clean.failures.map((f) => `[${f.id}] ${f.message}`).join(' | ')}`);

  // 2. Every mutation must be REACHED and must turn the battery red, in the
  //    scenarios it names.
  for (const m of MUTATIONS) {
    assert(source.includes(m.from), `${m.id}: its anchor is present in the shipped script (a no-op mutation proves nothing)`);
    if (!source.includes(m.from)) continue;
    const mutated = source.replace(m.from, m.to);
    assert(mutated !== source, `${m.id}: the substitution changed the source`);
    const red = await judge(mutated, root);
    assert(red.failures.length > 0, `${m.id}: ${m.what} -- the battery goes RED`);
    for (const id of m.expect) {
      assert(red.failures.some((f) => f.id === id),
        `${m.id}: scenario ${id} is one of the ones that catches it, got [${[...new Set(red.failures.map((f) => f.id))].join(', ')}]`);
    }
  }

  // 3. A script that does not compile is caught before any scenario runs.
  const broken = await judge(`${source}\nconst github = 1;`, root);
  assert(broken.failures.length === 1 && broken.failures[0].id === 'C0', 'a non-compiling script is reported as C0, once');

  // 4. Missing input is a failure, never a pass (#4690).
  const gone = extractScript(join(root, 'scripts'));
  assert(gone.source === null && gone.problems.length === 1, 'a missing workflow file is an input problem, not a pass');

  // 5. The corpus is the evidence. A fixture that quietly vanished would leave
  //    every extraction scenario asserting over an empty string.
  for (const name of ['plugin-dev-timeout.job-log.txt', 'plugin-dev-assertion.job-log.txt', 'incident-32333709633-published-excerpt.job-log.txt']) {
    assert(existsSync(join(root, FIXTURES, name)), `corpus: ${FIXTURES}/${name} exists`);
  }
  const timeoutFixture = fixture(root, 'plugin-dev-timeout.job-log.txt');
  const assertionFixture = fixture(root, 'plugin-dev-assertion.job-log.txt');
  assert(timeoutFixture.includes('Error: Test timed out in 1ms.'), 'corpus: the timeout capture really carries a timeout');
  assert(assertionFixture.includes('AssertionError: SecurityPlugin.init() ran: expected false to be true'),
    'corpus: the assertion capture really carries the assertion #10112 measured');
  const failOf = (t) => t.split('\n').find((l) => / FAIL  src\//.test(l));
  assert(failOf(timeoutFixture) === failOf(assertionFixture),
    'corpus: the two captures share a byte-identical FAIL line -- that identity IS the defect limb (1) exists for');

  // 6. Wiring. A check nobody runs is the #4449 shape this repo keeps paying for.
  const lint = join(root, '.github', 'workflows', 'lint.yml');
  assert(existsSync(lint), 'wiring: .github/workflows/lint.yml exists -- it is where this check runs');
  if (existsSync(lint)) {
    const body = readFileSync(lint, 'utf8');
    assert(body.includes(SELF), `wiring: lint.yml still invokes ${SELF}`);
    assert(body.includes(`${SELF} --self-test`), 'wiring: lint.yml runs the --self-test half too');
  }

  if (failures.length) {
    console.error(`✗ check-merge-queue-triage-outcome --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ check-merge-queue-triage-outcome --self-test: ${checked} assertions, `
      + `${MUTATIONS.length} mutations of the shipped script each driven to red.`,
  );
}

// The CLI dispatch is guarded so that IMPORTING this module is inert: the
// reverse-verification route needs `extractScript` / `judge` pointed at another
// tree, and a module that ran its gate on import would silently judge THIS repo
// instead and print a pass about the wrong subject.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--self-test')) await selfTest();
  else if (process.argv.includes('--list')) list();
  else await main();
}
