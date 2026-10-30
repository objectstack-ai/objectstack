#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// scheduled-full-run-card -- the API plumbing of `scheduled-full-run-card.yml`'s
// "File or refresh the card" step (#26086).
//
//   node scripts/ci/scheduled-full-run-card.mjs --self-test
//
// The step used to carry this body inline, as an `actions/github-script`
// `script:` block. It now imports this module and calls `fileCardStep` with the
// same `github` / `context` / `core` the action hands any script, so the token,
// the step's `retries:` policy and its `permissions:` are exactly what they
// were. The decision half (identity, de-dup, body, stale-block swap) was
// already in `./scheduled-full-run.mjs` and is untouched; what moved is the
// half the workflow header calls "the API paging and the event guard": the
// previous-green lookup, the compare range, and the callbacks wired into
// `fileOrRefreshCard`.
//
// Moved byte-for-byte except two spellings: the module is a static import
// instead of an `import()` off `$GITHUB_WORKSPACE`, and `sweptAt` reads an
// injectable clock (`now`, default `new Date()`) so the self-test can pin the
// body. The self-test's expected values were captured by running the INLINE
// body (main at 6390fe52) under the same doubles before the move.
//
// Dependency-free on purpose, like `./scheduled-full-run.mjs`: the job runs off
// a bare checkout with no install step.

import process from 'node:process';

import { isEntrypoint } from '../invoked-as.mjs';
import * as mod from './scheduled-full-run.mjs';

/**
 * The step body. `github` / `context` / `core` are the ones
 * `actions/github-script` passes; `now` exists for the self-test.
 */
export async function fileCardStep({ github, context, core, now = () => new Date() }) {
  const { owner, repo } = context.repo;
  const run = context.payload.workflow_run;

  const identity = mod.cardIdentity(run.name);
  const runUrl = run.html_url;

  // The previous GREEN scheduled run of THIS workflow. `status:
  // 'success'` is the filter that matters: a cancelled or a red
  // earlier run is not a point the tree was known good at, so a range
  // measured from one would name commits that were already suspect.
  let previousGreen = null;
  let commits = [];
  let compareUrl = null;
  let commitsTruncated = false;
  let rangeNote = null;
  try {
    const previous = await github.rest.actions.listWorkflowRuns({
      owner, repo,
      workflow_id: run.workflow_id,
      event: 'schedule',
      branch: 'main',
      status: 'success',
      per_page: 1,
    });
    const hit = previous.data.workflow_runs?.[0];
    if (hit) previousGreen = { run_id: hit.id, head_sha: hit.head_sha };
    else rangeNote = 'No previous GREEN `schedule` run of this workflow is in the API window — either this is the first one, or every scheduled run in the window was red.';
  } catch (error) {
    rangeNote = `The previous-green lookup failed (${error.message}).`;
  }

  if (previousGreen) {
    try {
      const cmp = await github.rest.repos.compareCommitsWithBasehead({
        owner, repo,
        basehead: `${previousGreen.head_sha}...${run.head_sha}`,
      });
      commits = (cmp.data.commits ?? []).map((c) => ({
        sha: c.sha,
        title: String(c.commit?.message ?? '').split('\n')[0],
      }));
      compareUrl = cmp.data.html_url ?? null;
      // The compare endpoint caps at 250 commits. Saying so beats
      // presenting a truncated list as the whole hour.
      commitsTruncated = (cmp.data.total_commits ?? commits.length) > commits.length;
    } catch (error) {
      // ⛔ Do NOT fall through to "nothing landed": that string is the
      // FLAKE reading, and a failed lookup is not evidence of an
      // empty range. Drop the range entirely and say why.
      previousGreen = null;
      rangeNote = `The commit range could not be read (${error.message}).`;
    }
  }

  const body = mod.renderBody({
    identity,
    runUrl,
    headSha: run.head_sha,
    conclusion: run.conclusion,
    sweptAt: now().toISOString(),
    previousGreen,
    commits,
    compareUrl,
    commitsTruncated,
    rangeNote,
  });

  // The DECISION is the module's, driven offline by its self-test
  // against a mutable board (one red run files one card; the next
  // refreshes it and files no second; a refresh of a card whose
  // every blocker is a closed LOCAL card, a PR one merged, moves
  // `pm:blocked` to `pm:queue`). What is left here is thin callbacks
  // over the API.
  const outcome = await mod.fileOrRefreshCard({
    identity,
    body,
    ownerRepo: `${owner}/${repo}`,
    perPage: 100,
    maxPages: 10,
    listPage: async (page) => {
      const res = await github.rest.issues.listForRepo({
        owner, repo, state: 'open', sort: 'created', direction: 'asc', per_page: 100, page,
      });
      return res.data;
    },
    updateIssue: async ({ number, body: b }) => {
      await github.rest.issues.update({ owner, repo, issue_number: number, body: b });
    },
    createIssue: async ({ title, body: b, labels }) => {
      // Additive on create; ⛔ nothing here ever replaces a whole
      // label set (`check:whole-set-label-write` refuses that verb).
      const res = await github.rest.issues.create({ owner, repo, title, body: b, labels });
      return { number: res.data.number };
    },
    // Read only for a card carrying `pm:blocked`.
    listComments: async ({ number, page, perPage }) => {
      const res = await github.rest.issues.listComments({
        owner, repo, issue_number: number, per_page: perPage, page,
      });
      return res.data;
    },
    getIssue: async ({ repo: target, number }) => {
      const [targetOwner, targetRepo] = target.split('/');
      const res = await github.rest.issues.get({ owner: targetOwner, repo: targetRepo, issue_number: number });
      // A PR number answers `closed` merged or not; `merged_at` tells them apart.
      const pr = res.data.pull_request ? { pull_request: { merged_at: res.data.pull_request.merged_at ?? null } } : {};
      return { state: res.data.state, closed_at: res.data.closed_at, ...pr };
    },
    // The swap: an additive POST and ONE remove by name.
    addLabels: async ({ number, labels }) => {
      await github.rest.issues.addLabels({ owner, repo, issue_number: number, labels });
    },
    removeLabel: async ({ number, name }) => {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: number, name });
    },
  });

  core.info(`${outcome.action} ${identity.marker} card #${outcome.number} (${body.length} chars)`);
  if (outcome.block) core.info(`block: ${outcome.blockSummary}`);
  const moved = outcome.block === 'expired' ? ' (every blocker closed: pm:blocked moved to pm:queue)' : '';
  core.notice(`${run.name} is red on the scheduled full run — card #${outcome.number} ${outcome.action}${moved}.`);
  core.setOutput('action', outcome.action);
  core.setOutput('number', String(outcome.number));
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// The job only runs on a RED scheduled run of a watched workflow, from the
// default branch, so nothing on a pull request can exercise it. Each case below
// drives `fileCardStep` under doubles of `github` / `context` / `core` and pins
// three things: the API calls it makes (in order, with their parameters), the
// body it hands `issues.create` / `issues.update` -- as the exact
// `renderBody(...)` arguments, so a wording change in `./scheduled-full-run.mjs`
// does not red this file but a change to what the plumbing passes it does -- and
// what it reports through `core`. An API the doubles do not model throws AND is
// recorded, and every case fails on that record: the step's own `catch` blocks
// would otherwise absorb it into a degradation path and the case would pass
// over a branch it never meant to take.

const SHA = (c) => c.repeat(40);
const OWNER_REPO = { owner: 'objectstack-ai', repo: 'objectstack' };
const FIXED_NOW = new Date('2026-10-27T01:00:00.000Z');
const httpError = (status, message) => Object.assign(new Error(message), { status });

const watchedRun = (over = {}) => ({
  name: 'CI',
  workflow_id: 77,
  html_url: 'https://github.com/objectstack-ai/objectstack/actions/runs/900',
  head_sha: SHA('b'),
  conclusion: 'failure',
  ...over,
});
const previousGreenRun = { data: { workflow_runs: [{ id: 800, head_sha: SHA('a') }] } };
const compareOf = (n, total = n) => ({
  data: {
    commits: Array.from({ length: n }, (_, i) => ({
      sha: SHA(String(i + 1)),
      commit: { message: `feat: change ${i + 1}\n\nbody` },
    })),
    html_url: 'https://github.com/objectstack-ai/objectstack/compare/x...y',
    total_commits: total,
  },
});
const commitsOf = (n) => Array.from({ length: n }, (_, i) => ({ sha: SHA(String(i + 1)), title: `feat: change ${i + 1}` }));
const COMPARE_URL = 'https://github.com/objectstack-ai/objectstack/compare/x...y';
const LOOKUP = {
  api: 'actions.listWorkflowRuns',
  params: { ...OWNER_REPO, workflow_id: 77, event: 'schedule', branch: 'main', status: 'success', per_page: 1 },
};
const COMPARE = { api: 'repos.compareCommitsWithBasehead', params: { ...OWNER_REPO, basehead: `${SHA('a')}...${SHA('b')}` } };
const SCAN = {
  api: 'issues.listForRepo',
  params: { ...OWNER_REPO, state: 'open', sort: 'created', direction: 'asc', per_page: 100, page: 1 },
};
const created = (number, name = 'CI') => [
  { info: `filed ${mod.cardIdentity(name).marker} card #${number}` },
  { notice: `${name} is red on the scheduled full run — card #${number} filed.` },
  { output: ['action', 'filed'] },
  { output: ['number', String(number)] },
];
const createCall = (name = 'CI') => ({
  api: 'issues.create',
  params: { ...OWNER_REPO, title: mod.cardIdentity(name).title, labels: ['bug', 'domain:devx', 'priority:p0'] },
});

/** The `renderBody` arguments the step must compute for a case. */
const renderArgs = (over = {}) => ({
  identity: mod.cardIdentity(over.name ?? 'CI'),
  runUrl: watchedRun().html_url,
  headSha: SHA('b'),
  conclusion: 'failure',
  sweptAt: FIXED_NOW.toISOString(),
  previousGreen: { run_id: 800, head_sha: SHA('a') },
  commits: [],
  compareUrl: null,
  commitsTruncated: false,
  rangeNote: null,
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'name')),
});

const SELF_TEST_CASES = [
  {
    label: 'a red run with a green predecessor and no open card files one card over the compare range',
    run: watchedRun(),
    api: {
      'actions.listWorkflowRuns': async () => previousGreenRun,
      'repos.compareCommitsWithBasehead': async () => compareOf(2),
      'issues.listForRepo': async () => ({ data: [] }),
      'issues.create': async () => ({ data: { number: 501 } }),
    },
    calls: [LOOKUP, COMPARE, SCAN, createCall()],
    body: renderArgs({ commits: commitsOf(2), compareUrl: COMPARE_URL }),
    reports: created(501),
  },
  {
    label: 'no green predecessor in the API window: no compare call, and the body says why there is no range',
    run: watchedRun(),
    api: {
      'actions.listWorkflowRuns': async () => ({ data: { workflow_runs: [] } }),
      'issues.listForRepo': async () => ({ data: [] }),
      'issues.create': async () => ({ data: { number: 502 } }),
    },
    calls: [LOOKUP, SCAN, createCall()],
    body: renderArgs({
      previousGreen: null,
      rangeNote: 'No previous GREEN `schedule` run of this workflow is in the API window — either this is the first one, or every scheduled run in the window was red.',
    }),
    reports: created(502),
  },
  {
    label: 'a refused previous-green lookup files anyway and names the refusal, never an empty range',
    run: watchedRun(),
    api: {
      'actions.listWorkflowRuns': async () => { throw httpError(503, 'No server is currently available'); },
      'issues.listForRepo': async () => ({ data: [] }),
      'issues.create': async () => ({ data: { number: 503 } }),
    },
    calls: [LOOKUP, SCAN, createCall()],
    body: renderArgs({ previousGreen: null, rangeNote: 'The previous-green lookup failed (No server is currently available).' }),
    reports: created(503),
  },
  {
    label: 'a refused compare drops the range entirely rather than reading as "nothing landed"',
    run: watchedRun(),
    api: {
      'actions.listWorkflowRuns': async () => previousGreenRun,
      'repos.compareCommitsWithBasehead': async () => { throw httpError(404, 'Not Found'); },
      'issues.listForRepo': async () => ({ data: [] }),
      'issues.create': async () => ({ data: { number: 504 } }),
    },
    calls: [LOOKUP, COMPARE, SCAN, createCall()],
    body: renderArgs({ previousGreen: null, rangeNote: 'The commit range could not be read (Not Found).' }),
    reports: created(504),
  },
  {
    label: 'a compare past the endpoint cap is marked truncated, and the watched workflow names the card',
    run: watchedRun({ name: 'Lint & Type Check' }),
    api: {
      'actions.listWorkflowRuns': async () => previousGreenRun,
      'repos.compareCommitsWithBasehead': async () => compareOf(3, 300),
      'issues.listForRepo': async () => ({ data: [] }),
      'issues.create': async () => ({ data: { number: 505 } }),
    },
    calls: [LOOKUP, COMPARE, SCAN, createCall('Lint & Type Check')],
    body: renderArgs({ name: 'Lint & Type Check', commits: commitsOf(3), compareUrl: COMPARE_URL, commitsTruncated: true }),
    reports: created(505, 'Lint & Type Check'),
  },
  {
    label: 'an open card is refreshed in place: one issues.update, no create, no label write',
    run: watchedRun(),
    api: {
      'actions.listWorkflowRuns': async () => previousGreenRun,
      'repos.compareCommitsWithBasehead': async () => compareOf(1),
      'issues.listForRepo': async () => ({
        data: [{ number: 420, title: mod.cardIdentity('CI').title, body: 'x', state: 'open', labels: [{ name: 'bug' }] }],
      }),
      'issues.update': async () => ({ data: {} }),
    },
    calls: [LOOKUP, COMPARE, SCAN, { api: 'issues.update', params: { ...OWNER_REPO, issue_number: 420 } }],
    body: renderArgs({ commits: commitsOf(1), compareUrl: COMPARE_URL }),
    reports: [
      { info: `refreshed ${mod.cardIdentity('CI').marker} card #420` },
      { info: 'block: not-blocked' },
      { notice: 'CI is red on the scheduled full run — card #420 refreshed.' },
      { output: ['action', 'refreshed'] },
      { output: ['number', '420'] },
    ],
  },
  {
    label: 'a pm:blocked card whose only blocker closed reaches every callback: comments, issue read, add then remove',
    run: watchedRun(),
    api: {
      'actions.listWorkflowRuns': async () => previousGreenRun,
      'repos.compareCommitsWithBasehead': async () => compareOf(0),
      'issues.listForRepo': async () => ({
        data: [{
          number: 430,
          title: mod.cardIdentity('CI').title,
          body: 'old\n\nBlocked-by: #600\n',
          state: 'open',
          labels: [{ name: 'bug' }, { name: 'pm:blocked' }],
          assignees: [],
        }],
      }),
      'issues.listComments': async () => ({ data: [{ body: 'a comment' }] }),
      'issues.get': async () => ({ data: { state: 'closed', closed_at: '2026-10-26T20:00:00Z' } }),
      'issues.addLabels': async () => ({ data: [] }),
      'issues.removeLabel': async () => ({ data: [] }),
      'issues.update': async () => ({ data: {} }),
    },
    calls: [
      LOOKUP, COMPARE, SCAN,
      { api: 'issues.listComments', params: { ...OWNER_REPO, issue_number: 430, per_page: 100, page: 1 } },
      { api: 'issues.get', params: { ...OWNER_REPO, issue_number: 600 } },
      { api: 'issues.addLabels', params: { ...OWNER_REPO, issue_number: 430, labels: ['pm:queue'] } },
      { api: 'issues.removeLabel', params: { ...OWNER_REPO, issue_number: 430, name: 'pm:blocked' } },
      { api: 'issues.update', params: { ...OWNER_REPO, issue_number: 430 } },
    ],
    // The refreshed body carries the block note `fileOrRefreshCard` puts above
    // the footer; the rendered half is what this step computed.
    body: renderArgs({ compareUrl: COMPARE_URL }),
    blockNote: { verdict: 'expired', resolutions: [{ local: true, number: 600, closedAt: '2026-10-26T20:00:00Z' }] },
    reports: [
      { info: `refreshed ${mod.cardIdentity('CI').marker} card #430` },
      { info: 'block: expired -- #600 closed' },
      { notice: 'CI is red on the scheduled full run — card #430 refreshed (every blocker closed: pm:blocked moved to pm:queue).' },
      { output: ['action', 'refreshed'] },
      { output: ['number', '430'] },
    ],
  },
  {
    label: 'a pm:blocked card whose blocker is a PR closed unmerged is held: the PR shape reaches the judgement, no label write',
    run: watchedRun(),
    api: {
      'actions.listWorkflowRuns': async () => previousGreenRun,
      'repos.compareCommitsWithBasehead': async () => compareOf(0),
      'issues.listForRepo': async () => ({
        data: [{
          number: 440,
          title: mod.cardIdentity('CI').title,
          body: 'old\n\nBlocked-by: #601\n',
          state: 'open',
          labels: [{ name: 'bug' }, { name: 'pm:blocked' }],
          assignees: [],
        }],
      }),
      'issues.listComments': async () => ({ data: [] }),
      'issues.get': async () => ({
        data: { state: 'closed', closed_at: '2026-10-26T20:00:00Z', pull_request: { merged_at: null } },
      }),
      'issues.update': async () => ({ data: {} }),
    },
    calls: [
      LOOKUP, COMPARE, SCAN,
      { api: 'issues.listComments', params: { ...OWNER_REPO, issue_number: 440, per_page: 100, page: 1 } },
      { api: 'issues.get', params: { ...OWNER_REPO, issue_number: 601 } },
      { api: 'issues.update', params: { ...OWNER_REPO, issue_number: 440 } },
    ],
    body: renderArgs({ compareUrl: COMPARE_URL }),
    reports: [
      { info: `refreshed ${mod.cardIdentity('CI').marker} card #440` },
      { info: 'block: held -- #601 closed unmerged (a PR that never landed)' },
      { notice: 'CI is red on the scheduled full run — card #440 refreshed.' },
      { output: ['action', 'refreshed'] },
      { output: ['number', '440'] },
    ],
  },
];

// The roster is a LITERAL the table is checked against (see
// scripts/check-agent-model-declared.mjs): each row label is a battery with a
// floor of 1, so a deleted or renamed row names itself at the floor.
const SELF_TEST_BATTERIES = Object.freeze({
  'a red run with a green predecessor and no open card files one card over the compare range': 1,
  'no green predecessor in the API window: no compare call, and the body says why there is no range': 1,
  'a refused previous-green lookup files anyway and names the refusal, never an empty range': 1,
  'a refused compare drops the range entirely rather than reading as "nothing landed"': 1,
  'a compare past the endpoint cap is marked truncated, and the watched workflow names the card': 1,
  'an open card is refreshed in place: one issues.update, no create, no label write': 1,
  'a pm:blocked card whose only blocker closed reaches every callback: comments, issue read, add then remove': 1,
  'a pm:blocked card whose blocker is a PR closed unmerged is held: the PR shape reaches the judgement, no label write': 1,
});
// Deleting a roster entry silences its floor as surely as zeroing it.
const SELF_TEST_BATTERY_FLOOR = 8;

/** Doubles of what github-script hands the step, recording every call. */
function doubles(caseDef) {
  const calls = [];
  const reports = [];
  const unmodelled = [];
  const endpoint = (ns, method) => async (params) => {
    const api = `${ns}.${method}`;
    const { body, ...rest } = params ?? {};
    calls.push({ api, params: rest, body });
    const answer = caseDef.api[api];
    if (!answer) {
      unmodelled.push(api);
      throw new Error(`self-test: \`github.rest.${api}\` is not modelled by this case`);
    }
    return answer(params);
  };
  const rest = new Proxy({}, {
    get: (_t, ns) => new Proxy({}, { get: (_u, method) => endpoint(String(ns), String(method)) }),
  });
  const core = {
    info: (m) => reports.push({ info: String(m) }),
    notice: (m) => reports.push({ notice: String(m) }),
    setOutput: (k, v) => reports.push({ output: [k, v] }),
  };
  const context = { repo: OWNER_REPO, payload: { workflow_run: caseDef.run } };
  return { github: { rest }, context, core, calls, reports, unmodelled };
}

let selfTestReachedVerdict = false;

async function selfTest() {
  const failures = [];
  const seen = new Map();
  const fail = (label, message) => failures.push(`${label}: ${message}`);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  for (const c of SELF_TEST_CASES) {
    // Registered FIRST, before anything that can `continue`, so the floor
    // measures reach (see check-agent-model-declared.mjs).
    seen.set(c.label, (seen.get(c.label) ?? 0) + 1);
    const d = doubles(c);
    try {
      await fileCardStep({ github: d.github, context: d.context, core: d.core, now: () => FIXED_NOW });
    } catch (error) {
      fail(c.label, `the step threw: ${error.message}`);
      continue;
    }
    if (d.unmodelled.length > 0) fail(c.label, `called unmodelled API(s) ${d.unmodelled.join(', ')}`);
    const gotCalls = d.calls.map(({ api, params }) => ({ api, params }));
    if (!same(gotCalls, c.calls)) {
      fail(c.label, `API calls\n    expected ${JSON.stringify(c.calls)}\n    actual   ${JSON.stringify(gotCalls)}`);
    }
    const written = d.calls.filter((x) => x.api === 'issues.create' || x.api === 'issues.update');
    const rendered = c.blockNote
      ? mod.withBlockNote(mod.renderBody(c.body), mod.renderBlockNote(c.blockNote))
      : mod.renderBody(c.body);
    if (written.length !== 1) fail(c.label, `expected exactly one card write, got ${written.length}`);
    else if (written[0].body !== rendered) {
      fail(c.label, 'the card body is not renderBody() of the arguments this case pins');
    }
    // The size in the info line is the body's length, so it is matched by prefix.
    const gotReports = d.reports.map((r) => (r.info?.includes(' card #') ? { info: r.info.replace(/ \(\d+ chars\)$/, '') } : r));
    if (!same(gotReports, c.reports)) {
      fail(c.label, `core reports\n    expected ${JSON.stringify(c.reports)}\n    actual   ${JSON.stringify(gotReports)}`);
    }
  }

  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    failures.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
  }
  for (const [name, count] of seen) {
    if (!declared.includes(name)) failures.push(`case "${name}" (${count}) is not declared in SELF_TEST_BATTERIES`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      failures.push(`self-test battery "${name}" registered ${count} case(s), below its floor of ${SELF_TEST_BATTERIES[name]} -- it DID NOT RUN`);
    }
  }

  if (failures.length > 0) {
    console.error(`✗ scheduled-full-run-card --self-test: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(`✓ scheduled-full-run-card --self-test: ${SELF_TEST_CASES.length} cases over the card step's API plumbing.`);
  selfTestReachedVerdict = true;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    await selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ scheduled-full-run-card self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else {
    console.error('usage: node scripts/ci/scheduled-full-run-card.mjs --self-test\n'
      + '(the step itself runs through `fileCardStep`, imported by scheduled-full-run-card.yml)');
    process.exit(2);
  }
}
