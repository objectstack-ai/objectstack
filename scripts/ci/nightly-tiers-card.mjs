#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// nightly-tiers-card -- the body of `test-nightly-tiers.yml`'s "File or
// refresh the card" step (#26086).
//
//   node scripts/ci/nightly-tiers-card.mjs --self-test
//
// The step used to carry this as an inline `actions/github-script` block that
// nothing imported and no test reached. It now imports this module and calls
// `fileNightlyCard` with the same `github` / `context` / `core`, so the token,
// the step's `retries:` and the job's permissions are exactly what they were.
//
// Moved byte-for-byte except three spellings: `fs` / `path` are static imports
// instead of `require()`, the environment is a parameter (`env`, default
// `process.env`) instead of a bare `process.env`, and `sweptAt` reads an
// injectable clock (`now`). The self-test's expected bodies are the SHA-256 of
// what the INLINE body (main at 6390fe52) wrote under the same doubles, same
// files and same clock, captured before the move.
//
// Dependency-free: the report job runs no `pnpm install`.
//
// dispatch-gates: no-path-population -- the --self-test (the one invocation a pull request runs, in Lint & Repo Gates) drives in-memory API doubles and a throwaway $RUNNER_TEMP under the OS temp directory and reads no tracked file; the shard log tails it names are fixture files it writes there, and the step itself reads only the artifacts the nightly run downloaded

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { isEntrypoint } from '../invoked-as.mjs';

/**
 * The step body. Reads the card identity, the tiers result and the report
 * reader's exit from `env` (the step's `env:` and the workflow's), the failing
 * files and the shards' log tails from `$RUNNER_TEMP`, and files or refreshes
 * the one open card.
 */
export async function fileNightlyCard({ github, context, core, env = process.env, now = () => new Date() }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const title = env.CARD_TITLE;
  const marker = env.CARD_MARKER;
  const labels = env.CARD_LABELS.split(',').map((s) => s.trim()).filter(Boolean);
  const result = env.TIERS_RESULT;
  const runUrl = `${env.GITHUB_SERVER_URL}/${owner}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`;

  const read = (name) => {
    try { return fs.readFileSync(path.join(env.RUNNER_TEMP, name), 'utf8'); }
    catch { return ''; }
  };
  const failing = read('failing-files.txt').split('\n').map((s) => s.trim()).filter(Boolean);
  const extractorExit = env.FAILING_FILES_EXIT;

  // The log tails, bounded. ⛔ The bound below is NOT the platform
  // cap, and the platform cap is not 65,536 of anything. This step
  // posts an ISSUE BODY, and that surface is MEASURED, in UTF-8
  // BYTES: 262,144 bytes stored, 262,145 refused — bisected to one
  // byte on objectstack#18793, and restated as `ISSUE_BODY_LIMIT` in
  // scripts/pm/check-half-states.mjs. ⛔ Do not re-derive 65,536 from
  // a refusal message: GitHub's own 422 text still says "maximum is
  // 65536 characters" and is false in both unit and value —
  // objectstack#18826 stored a 262,144-CHARACTER comment. ⚠️ And on
  // this surface the refusal is not a 422 at all: an oversized issue
  // body is answered 200 with the OLD body kept and nothing reported
  // (#18793), so a body that outgrows the cap vanishes silently.
  // The run link carries the whole log anyway.
  const tails = [];
  const reportsDir = path.join(env.RUNNER_TEMP, 'nightly-reports');
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'log-tail.txt') tails.push({ shard: path.basename(dir), text: fs.readFileSync(p, 'utf8') });
    }
  };
  walk(reportsDir);
  // BUDGET is a READING budget, ⛔ not a platform bound, and it is
  // deliberately NOT re-sized now that the cap above is known to be
  // four times what this file used to assert. 40,000 is about as much
  // log tail as a person reads off a card before clicking through,
  // and the run link carries every byte elided here — so this number
  // is sized against the reader, and a correction to the cap moves a
  // reading, never a licence to print more. It is counted in the unit
  // the slice below uses (JS string length, i.e. UTF-16 code units),
  // because nothing judges it against the byte cap: even as bytes of
  // CJK prose it stays far under 262,144.
  const BUDGET = 40000;
  const perTail = Math.max(2000, Math.floor(BUDGET / Math.max(1, tails.length)));
  const tailBlocks = tails.sort((a, b) => a.shard.localeCompare(b.shard)).flatMap(({ shard, text }) => [
    `### ${shard} — last lines of the test log`,
    '',
    '```',
    text.length > perTail ? `… (${text.length - perTail} chars elided) …\n${text.slice(-perTail)}` : text,
    '```',
    '',
  ]);

  // The cadence that makes the `Swept` line below decidable (#17720).
  // `PATROL_SCHEDULE` is this workflow's own `cron:`, restated in the
  // `env:` block beside the other single-sourced card strings.
  // ⛔ Only the daily `M H * * *` form is computed; anything else says
  // so in the body rather than publishing a deadline derived from a
  // schedule this did not read.
  const sweptAt = now();
  const schedule = String(env.PATROL_SCHEDULE ?? '').trim();
  const cronFields = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule);
  let expectation = `⚠️ expected cadence UNSTATED — PATROL_SCHEDULE is \`${schedule}\`, which is not the daily \`M H * * *\` form this step computes a deadline from`;
  if (cronFields && Number(cronFields[1]) <= 59 && Number(cronFields[2]) <= 23) {
    const next = new Date(sweptAt);
    next.setUTCHours(Number(cronFields[2]), Number(cronFields[1]), 0, 0);
    if (next <= sweptAt) next.setUTCDate(next.getUTCDate() + 1);
    expectation = `expected every 24h while this card stands (cron \`${schedule}\` UTC) · next by ${next.toISOString().slice(0, 16)}Z`;
  }

  const filesSection = failing.length > 0
    ? ['## Failing files', '', ...failing.map((f) => `- \`${f}\``), '']
    : extractorExit !== '0'
      ? ['## Failing files', '', `⚠️ The report reader exited ${extractorExit}; no per-file verdict is available. Read the run log.`, '']
      : ['## Failing files', '', '⚠️ No vitest report named a failing nightly-tier file, yet the tiers job did not succeed — the run died before or outside vitest (a build failure, a stall kill, a cancelled shard). Read the run log.', ''];

  const body = [
    `${marker} — machine-findable marker for this generated card. ⛔ Do not delete this line: it is how the nightly finds this card instead of filing a new one every night.`,
    '',
    `# ${title}`,
    '',
    `_Swept ${sweptAt.toISOString()} · ${expectation} · [run log](${runUrl}) · commit \`${env.GITHUB_SHA}\` · trigger \`${context.eventName}\` · tiers job result \`${result}\`._`,
    '',
    'The `Swept` line above is this nightly\'s heartbeat, and it states the cadence that makes',
    '「stalled」 decidable: while the tiers stay red this card is refreshed on that schedule, so a',
    'timestamp still sitting there past the `next by` deadline means either the standing caller',
    'died or the nightly went green — nothing here files or closes anything on green, so both',
    'readings end at this card. ⛔ Do not carry a cadence over from a sibling patrol anchor: they',
    'differ by up to 4× and each states its own.',
    '',
    'The `e2e` and `live` test tiers — the files named `*.e2e.test.*` and `*.live.test.*` — run here',
    'nightly on `main` under `OS_TEST_TIERS=nightly` and nowhere else (the per-PR and merge-queue',
    'Test Core runs under `queue`). A red here is a real suite that no pull request will red on;',
    'this card is the channel that sees it. Nothing is blocked by it.',
    '',
    '⛔ The remedy is never to rename, skip or delete the failing test to make the nightly green.',
    'Reproduce locally with `OS_TEST_TIERS=nightly pnpm --filter <pkg> test`, fix what it names, and',
    'let the next nightly refresh this card.',
    '',
    ...filesSection,
    ...tailBlocks,
    '_Filed by `.github/workflows/test-nightly-tiers.yml`. Generated by [Claude Code](https://claude.ai/code)_',
  ].join('\n');

  // ── De-dup: the OPEN cards carrying the title prefix ─────────────
  // Repo-scoped REST, this workflow's token, bounded pages; a
  // truncated scan cannot establish ABSENCE, and filing on an
  // unestablished absence is how a nightly mints a duplicate a day.
  const isThisCard = (i) => !i.pull_request
    && (String(i.title ?? '').startsWith(title) || String(i.body ?? '').includes(marker));
  const MAX_PAGES = 10;
  const candidates = [];
  let scanComplete = true;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await github.rest.issues.listForRepo({
      owner, repo, state: 'open', sort: 'created', direction: 'asc', per_page: 100, page,
    });
    candidates.push(...res.data.filter(isThisCard));
    if (res.data.length < 100) break;
    if (page === MAX_PAGES) scanComplete = false;
  }
  if (!scanComplete) {
    throw new Error(`the open-issue scan hit its ${MAX_PAGES}-page bound without completing — absence is NOT established, so nothing was filed. The failing files are in this run's summary.`);
  }

  // The OLDEST open card wins — that is the one any duplicates were
  // closed against.
  const existing = candidates.sort((a, b) => a.number - b.number)[0] ?? null;

  if (existing) {
    // Rewritten in place, never a comment per run. ⛔ Labels are NOT
    // rewritten — grading is the devx seat's and a refresh must not
    // undo it.
    await github.rest.issues.update({ owner, repo, issue_number: existing.number, body });
    core.info(`refreshed nightly-tiers card #${existing.number} (${body.length} chars, tiers ${result})`);
    core.notice(`nightly tiers are red on main — card #${existing.number} refreshed.`);
    return;
  }

  const created = await github.rest.issues.create({
    owner, repo, title, body,
    // Additive on create; ⛔ nothing here ever replaces a whole label
    // set (`check:whole-set-label-write` refuses that verb outright).
    labels,
  });
  core.info(`filed nightly-tiers card #${created.data.number} (${body.length} chars, tiers ${result})`);
  core.notice(`nightly tiers are red on main — card #${created.data.number} filed.`);
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// The report step only writes on a red nightly on `main`, so no pull request
// exercises it. Each case below lays out a `$RUNNER_TEMP` the way the steps
// before it do, drives `fileNightlyCard` under doubles, and pins the API calls
// (in order, parameters without the body), the body (SHA-256 of the bytes the
// inline step wrote for the same inputs; a mismatch prints the new body), the
// `core` reports, and the refusal when the de-dup scan cannot establish
// absence. An API a case does not model is recorded and fails the case: the
// step has no `catch` around its writes today, and a call the doubles answer
// by accident would still pass over a branch the case never meant to take.

const OWNER_REPO = { owner: 'objectstack-ai', repo: 'objectstack' };
const FIXED_NOW = new Date('2026-10-27T01:00:00.000Z');
const CARD_TITLE = 'nightly-tiers: red on main';
const BASE_ENV = {
  CARD_TITLE,
  CARD_MARKER: 'os-nightly-tiers',
  CARD_LABELS: 'bug,domain:devx,priority:p1',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_RUN_ID: '777',
  GITHUB_SHA: 'c'.repeat(40),
  PATROL_SCHEDULE: '29 5 * * *',
};
const others = (n, extra = []) => ({
  data: [...Array.from({ length: n }, (_, i) => ({ number: 1000 + i, title: `other ${i}`, body: '' })), ...extra],
});
const scan = (page) => ({
  api: 'issues.listForRepo',
  params: { ...OWNER_REPO, state: 'open', sort: 'created', direction: 'asc', per_page: 100, page },
});
const create = { api: 'issues.create', params: { ...OWNER_REPO, title: CARD_TITLE, labels: ['bug', 'domain:devx', 'priority:p1'] } };
const update = (n) => ({ api: 'issues.update', params: { ...OWNER_REPO, issue_number: n } });
const filed = (n, result = 'failure') => [
  { info: `filed nightly-tiers card #${n} (BODY chars, tiers ${result})` },
  { notice: `nightly tiers are red on main — card #${n} filed.` },
];
const refreshed = (n) => [
  { info: `refreshed nightly-tiers card #${n} (BODY chars, tiers failure)` },
  { notice: `nightly tiers are red on main — card #${n} refreshed.` },
];
// A shard's log tail as the step finds it under $RUNNER_TEMP, joined rather
// than spelled so the gate derivation does not read it as a tracked path.
const tailFixture = (shard) => ['nightly-reports', shard, 'log-tail.txt'].join('/');

const SELF_TEST_CASES = [
  {
    label: 'a red night with failing files and two log tails files one card, the long tail elided to its share',
    env: { TIERS_RESULT: 'failure', FAILING_FILES_EXIT: '0' },
    files: {
      'failing-files.txt': 'packages/a/x.e2e.test.ts\npackages/b/y.live.test.ts\n',
      [tailFixture('shard-2')]: 'short tail',
      [tailFixture('shard-1')]: `${'L'.repeat(25000)}END`,
    },
    api: { 'issues.listForRepo': async () => others(3), 'issues.create': async () => ({ data: { number: 601 } }) },
    calls: [scan(1), create],
    bodySha256: '17de61d1831a2ee0b42f8a0b492a92b15d4ccb2e8a27eb0cead86a1748c5d777',
    bodyIncludes: ['- `packages/a/x.e2e.test.ts`', '… (5003 chars elided) …', '### shard-1 — last lines', 'next by 2026-10-27T05:29Z'],
    reports: filed(601),
  },
  {
    label: 'a report reader that exited non-zero is stated as no per-file verdict, never as no failures',
    env: { TIERS_RESULT: 'failure', FAILING_FILES_EXIT: '2' },
    files: {},
    api: { 'issues.listForRepo': async () => others(0), 'issues.create': async () => ({ data: { number: 602 } }) },
    calls: [scan(1), create],
    bodySha256: '10a130fd879d079963a596090b9ea145eb25d3ab6c2f7b2150292323404ef8ad',
    bodyIncludes: ['⚠️ The report reader exited 2; no per-file verdict is available.'],
    reports: filed(602),
  },
  {
    label: 'a red run with no failing file named says the run died outside vitest',
    env: { TIERS_RESULT: 'cancelled', FAILING_FILES_EXIT: '0' },
    files: { 'failing-files.txt': '\n' },
    api: { 'issues.listForRepo': async () => others(0), 'issues.create': async () => ({ data: { number: 603 } }) },
    calls: [scan(1), create],
    bodySha256: '711ef6e45703db790d277fb01bd61252f56c12cf7605ff8c304908bc00723c0f',
    bodyIncludes: ['the run died before or outside vitest', 'tiers job result `cancelled`'],
    reports: filed(603, 'cancelled'),
  },
  {
    label: 'the oldest open card wins, found by title or marker, and a pull request is never the card',
    env: { TIERS_RESULT: 'failure', FAILING_FILES_EXIT: '0' },
    files: { 'failing-files.txt': 'packages/a/x.e2e.test.ts\n' },
    api: {
      'issues.listForRepo': async () => others(2, [
        { number: 90, title: CARD_TITLE, body: '' },
        { number: 40, title: 'renamed', body: 'os-nightly-tiers — marker' },
        { number: 30, title: CARD_TITLE, pull_request: {} },
      ]),
      'issues.update': async () => ({ data: {} }),
    },
    calls: [scan(1), update(40)],
    bodySha256: '6ce0a0a0079c5b1273c0ad3f317a1d7025b00ffc994f0dffe286dd0ff3c6d7a9',
    bodyIncludes: [],
    reports: refreshed(40),
  },
  {
    label: 'a scan that hits its page bound refuses to file: absence is not established',
    env: { TIERS_RESULT: 'failure', FAILING_FILES_EXIT: '0' },
    files: {},
    api: { 'issues.listForRepo': async () => others(100) },
    calls: Array.from({ length: 10 }, (_, i) => scan(i + 1)),
    throws: 'the open-issue scan hit its 10-page bound without completing — absence is NOT established, so nothing was filed.',
    reports: [],
  },
  {
    label: 'a schedule that is not the daily form says the cadence is unstated instead of publishing a deadline',
    env: { TIERS_RESULT: 'failure', FAILING_FILES_EXIT: '0', PATROL_SCHEDULE: '0 */6 * * *' },
    files: {},
    api: { 'issues.listForRepo': async () => others(0), 'issues.create': async () => ({ data: { number: 606 } }) },
    calls: [scan(1), create],
    bodySha256: '9be29186b1274a9891cb83c03dde001e9aaad90150b45ffe51fa166d024c0996',
    bodyIncludes: ['⚠️ expected cadence UNSTATED — PATROL_SCHEDULE is `0 */6 * * *`'],
    reports: filed(606),
  },
  {
    label: 'the scan pages until a short page, and a card on page three is still found',
    env: { TIERS_RESULT: 'failure', FAILING_FILES_EXIT: '0' },
    files: {},
    api: {
      'issues.listForRepo': async (p) => (p.page < 3 ? others(100) : others(1, [{ number: 77, title: 'x', body: 'os-nightly-tiers' }])),
      'issues.update': async () => ({ data: {} }),
    },
    calls: [scan(1), scan(2), scan(3), update(77)],
    bodySha256: '399186fb122a9b3e0c1852d5ce08ad080132473d7790034d15c35fcccc0551f6',
    bodyIncludes: [],
    reports: refreshed(77),
  },
];

// The roster is a LITERAL the table is checked against (the table-driven shape
// of scripts/check-agent-model-declared.mjs): each row label is a battery with
// a floor of 1, so a deleted or renamed row names itself at the floor.
const SELF_TEST_BATTERIES = Object.freeze({
  'a red night with failing files and two log tails files one card, the long tail elided to its share': 1,
  'a report reader that exited non-zero is stated as no per-file verdict, never as no failures': 1,
  'a red run with no failing file named says the run died outside vitest': 1,
  'the oldest open card wins, found by title or marker, and a pull request is never the card': 1,
  'a scan that hits its page bound refuses to file: absence is not established': 1,
  'a schedule that is not the daily form says the cadence is unstated instead of publishing a deadline': 1,
  'the scan pages until a short page, and a card on page three is still found': 1,
});
// Deleting a roster entry silences its floor as surely as zeroing it.
const SELF_TEST_BATTERY_FLOOR = 7;

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
  };
  return { github: { rest }, context: { repo: OWNER_REPO, eventName: 'schedule' }, core, calls, reports, unmodelled };
}

let selfTestReachedVerdict = false;

async function selfTest() {
  const failures = [];
  const seen = new Map();
  const fail = (label, message) => failures.push(`${label}: ${message}`);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  for (const c of SELF_TEST_CASES) {
    // Registered FIRST, before anything that can `continue`, so the floor
    // measures reach.
    seen.set(c.label, (seen.get(c.label) ?? 0) + 1);
    const runnerTemp = fs.mkdtempSync(path.join(tmpdir(), 'nightly-card-'));
    try {
      for (const [rel, text] of Object.entries(c.files)) {
        fs.mkdirSync(path.dirname(path.join(runnerTemp, rel)), { recursive: true });
        fs.writeFileSync(path.join(runnerTemp, rel), text);
      }
      const d = doubles(c);
      let threw = null;
      try {
        await fileNightlyCard({
          github: d.github, context: d.context, core: d.core,
          env: { ...BASE_ENV, ...c.env, RUNNER_TEMP: runnerTemp },
          now: () => FIXED_NOW,
        });
      } catch (error) {
        threw = String(error?.message ?? error);
      }
      if (d.unmodelled.length > 0) fail(c.label, `called unmodelled API(s) ${d.unmodelled.join(', ')}`);
      if (c.throws ? !threw?.startsWith(c.throws) : threw !== null) {
        fail(c.label, `expected ${c.throws ? `a refusal starting "${c.throws}"` : 'no throw'}, got ${threw === null ? 'none' : `"${threw}"`}`);
      }
      const gotCalls = d.calls.map(({ api, params }) => ({ api, params }));
      if (!same(gotCalls, c.calls)) {
        fail(c.label, `API calls\n    expected ${JSON.stringify(c.calls)}\n    actual   ${JSON.stringify(gotCalls)}`);
      }
      const written = d.calls.filter((x) => x.api === 'issues.create' || x.api === 'issues.update');
      if (c.bodySha256) {
        const body = written[0]?.body ?? '';
        const sha = createHash('sha256').update(body).digest('hex');
        if (written.length !== 1) fail(c.label, `expected exactly one card write, got ${written.length}`);
        else if (sha !== c.bodySha256) {
          fail(c.label, `the card body changed (sha256 ${sha}, pinned ${c.bodySha256}). If the change is intended, `
            + `re-pin it and say so in the PR body. The body now reads:\n${body}`);
        }
        for (const needle of c.bodyIncludes) if (!body.includes(needle)) fail(c.label, `the body no longer carries ${JSON.stringify(needle)}`);
        const gotReports = d.reports.map((r) => (r.info ? { info: r.info.replace(`(${body.length} chars`, '(BODY chars') } : r));
        if (!same(gotReports, c.reports)) {
          fail(c.label, `core reports\n    expected ${JSON.stringify(c.reports)}\n    actual   ${JSON.stringify(gotReports)}`);
        }
      } else if (written.length !== 0 || d.reports.length !== 0) {
        fail(c.label, `a refusal must write nothing and report nothing, got ${written.length} write(s) and ${d.reports.length} report(s)`);
      }
    } finally {
      fs.rmSync(runnerTemp, { recursive: true, force: true });
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
    console.error(`✗ nightly-tiers-card --self-test: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(`✓ nightly-tiers-card --self-test: ${SELF_TEST_CASES.length} cases over the nightly card step.`);
  selfTestReachedVerdict = true;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    await selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ nightly-tiers-card self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else {
    console.error('usage: node scripts/ci/nightly-tiers-card.mjs --self-test\n'
      + '(the step itself runs through `fileNightlyCard`, imported by test-nightly-tiers.yml)');
    process.exit(2);
  }
}
