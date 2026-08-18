#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-cross-repo-closer-outcome -- run the SHIPPED cross-repo-issue-closer
// script under doubles and hold its OUTCOMES to contract.
//
//   node scripts/check-cross-repo-closer-outcome.mjs             # judge the shipped script
//   node scripts/check-cross-repo-closer-outcome.mjs --self-test # prove the battery can go red
//   node scripts/check-cross-repo-closer-outcome.mjs --list      # the scenario table
//
// ## Why this file exists (#9595, and #9575 before it)
//
// `.github/workflows/cross-repo-issue-closer.yml` carries ~150 lines of inline
// `actions/github-script`, and that script is CODE NOBODY HAS EVER SEEN RUN.
// Measured 2026-08-18 over the 1176 most recently merged pull requests (12
// pages of the closed-PR listing, the workflow's own regex applied to each
// body): **zero** carry a qualified cross-repo closing keyword. Twenty-five
// carry the qualified SAME-repo spelling, which the loop skips. So the branch
// this repo maintains for the occasion it exists for has, in that window,
// never once had a target to close.
//
// Two consequences, and this file answers both:
//
//   1. The defects in it are found by reading, one card at a time -- #9575 for
//      the notice, #9595 for the loop's verdict -- and each fix lands as more
//      unexercised code. PR #9594 validated its half by extracting the script
//      and driving it under stubs, which was the right method and was thrown
//      away with the session. This makes that harness a repo artifact.
//   2. Nothing catches a script that does not even COMPILE. It has happened:
//      on 2026-08-02 the job failed twice with `SyntaxError: Identifier
//      'octokit' has already been declared`, because github-script compiles the
//      whole block as one `AsyncFunction` body. Assertion 0 below is that
//      compile, on the real text.
//
// ## The method: the shipped bytes, never a copy
//
// The script is read out of the YAML with a real parser (`jobs ->
// close-foreign-issues -> steps[github-script] -> with.script`) and executed
// the way the action executes it:
//
//     new AsyncFunction('github', 'context', 'core', ..., source)
//
// A copy of the script pasted into this file would be a test of the copy. The
// extraction is therefore load-bearing, and every failure to extract is a
// FAILURE rather than a skip (#4690): a workflow that has been renamed, a step
// that no longer uses github-script, an empty `script:` -- all of them exit
// non-zero here, because a harness that could not find its subject has verified
// nothing at all.
//
// ## What is asserted, and what is deliberately not
//
// Asserted: the target parse (which keyword spellings qualify, which forms do
// not, that a same-repo reference is skipped), and the OUTCOME of every exit --
// which of `core.setFailed` / `core.warning` / a job summary fires, and which
// API calls were made. Those are the properties both cards are about.
//
// NOT asserted: the step's `retries:` / `retry-exempt-status-codes:` inputs.
// They are consumed by the ACTION, not by the script, so no stub of `github`
// can exercise them; their acceptance on the pinned action version is evidenced
// by the action echoing its own defaults into every run of this job.
//
// NOT asserted either: that GitHub's own keyword parser agrees with the regex.
// That is a property of GitHub, and the only honest evidence for it is the
// 25 same-repo qualified references measured above, which GitHub did close.
//
// ## The self-test, and why it is not optional
//
// A battery of assertions over a script that is already correct is green on day
// one and green forever, including the day someone deletes the thing it
// guards. `--self-test` mutates the extracted source -- drop the `setFailed`,
// stop collecting failed keys, `break` out of the loop instead of isolating,
// disable the same-repo skip, narrow the keyword set, disable the
// already-closed skip -- and requires the battery to go RED for each, naming
// the scenario it expects. Each mutation also asserts its own anchor was
// PRESENT before substituting: a mutation that silently matched nothing would
// leave the battery green and read exactly like a passing self-test.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMap, isSeq, parseDocument } from 'yaml';

const WORKFLOW = '.github/workflows/cross-repo-issue-closer.yml';
const JOB = 'close-foreign-issues';
const SELF = 'scripts/check-cross-repo-closer-outcome.mjs';
const THIS_REPO = { owner: 'objectstack-ai', repo: 'objectstack' };

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
    const uses = String(step.get('uses') ?? '');
    return uses.startsWith('actions/github-script@');
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

/** An octokit-shaped rejection: `status` is what the script's `describe` reads. */
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * `github` / `context` / `core` doubles plus a call log.
 *
 * `issues` maps `owner/repo#number` to `{ state }` or to a `{ throwOn }`
 * instruction, so a scenario can refuse one specific target and leave the rest
 * reachable -- which is the whole point of the isolation the loop must keep.
 */
function makeDoubles({ body, token, issues = {}, prCommentError = null, summaryError = null }) {
  const calls = { get: [], comment: [], update: [], prComment: [] };
  const log = { info: [], warning: [], failed: [], summary: [] };
  let summaryBuffer = [];

  const target = (o, r, n) => issues[`${o}/${r}#${n}`] ?? {};

  const github = {
    rest: {
      issues: {
        async get({ owner, repo, issue_number: n }) {
          calls.get.push(`${owner}/${repo}#${n}`);
          const t = target(owner, repo, n);
          if (t.getError) throw t.getError;
          return { data: { state: t.state ?? 'open' } };
        },
        async createComment({ owner, repo, issue_number: n, body: text }) {
          const key = `${owner}/${repo}#${n}`;
          const isThisPr = owner === THIS_REPO.owner && repo === THIS_REPO.repo;
          if (isThisPr && prCommentError) {
            calls.prComment.push({ key, attempted: true, delivered: false });
            throw prCommentError;
          }
          if (isThisPr) {
            calls.prComment.push({ key, attempted: true, delivered: true, body: text });
            return { data: {} };
          }
          const t = target(owner, repo, n);
          if (t.commentError) throw t.commentError;
          calls.comment.push({ key, body: text });
          return { data: {} };
        },
        async update({ owner, repo, issue_number: n, state, state_reason: reason }) {
          const key = `${owner}/${repo}#${n}`;
          const t = target(owner, repo, n);
          if (t.updateError) throw t.updateError;
          calls.update.push({ key, state, reason });
          return { data: {} };
        },
      },
    },
  };

  const summary = {
    addRaw(text) {
      summaryBuffer.push(text);
      return summary;
    },
    async write() {
      if (summaryError) throw summaryError;
      log.summary.push(summaryBuffer.join(''));
      summaryBuffer = [];
      return summary;
    },
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
      pull_request: {
        body,
        html_url: 'https://github.com/objectstack-ai/objectstack/pull/1234',
        number: 1234,
      },
    },
  };

  return { github, context, core, calls, log, token };
}

/** Anything github-script hands the script that this harness does not model. */
function unstubbed(name) {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(
          `${SELF}: the shipped script now uses \`${name}\`, which this harness does not stub. ` +
            'Model it here rather than deleting the assertion that found it.',
        );
      },
    },
  );
}

/**
 * Run the script exactly as `actions/github-script` does: as the body of an
 * AsyncFunction whose scope carries the action's argument set.
 */
async function runScript(source, scenario) {
  const doubles = makeDoubles(scenario);
  const args = {
    github: doubles.github,
    context: doubles.context,
    core: doubles.core,
    exec: unstubbed('exec'),
    glob: unstubbed('glob'),
    io: unstubbed('io'),
    fetch: unstubbed('fetch'),
    require: createRequire(import.meta.url),
    __original_require__: createRequire(import.meta.url),
  };
  const fn = new AsyncFunction(...Object.keys(args), source);

  const before = Object.hasOwn(process.env, 'CROSS_REPO_TOKEN')
    ? { present: true, value: process.env.CROSS_REPO_TOKEN }
    : { present: false };
  if (scenario.token === undefined) delete process.env.CROSS_REPO_TOKEN;
  else process.env.CROSS_REPO_TOKEN = scenario.token;

  let threw = null;
  try {
    await fn(...Object.values(args));
  } catch (err) {
    // github-script routes a throw to `main().catch(handleError)` -> setFailed,
    // so an escape is not automatically wrong -- but it IS a different outcome
    // from a deliberate verdict, and scenarios say which one they expect.
    threw = err;
  } finally {
    if (before.present) process.env.CROSS_REPO_TOKEN = before.value;
    else delete process.env.CROSS_REPO_TOKEN;
  }

  return { ...doubles, threw };
}

// ── Scenarios ───────────────────────────────────────────────────────────────

const FIXED = httpError(503, 'No server is currently available to service your request.');
const DENIED = httpError(404, 'Not Found');
const UNAUTHORIZED = httpError(401, 'Bad credentials');

/** A body carrying the three keyword shapes plus three that must NOT qualify. */
const MIXED_BODY = [
  'Fixes objectstack-ai/objectui#456',
  'CLOSES my-org/some.repo#22',
  'resolved third/party#7',
  '',
  'Part of objectstack-ai/objectui#999 -- a reference, not a close.',
  'Fixes #321 -- bare form, GitHub already handles it.',
  'Fixes objectstack-ai/objectstack#5 -- same repo, GitHub already closed it.',
].join('\n');

const FOREIGN = ['objectstack-ai/objectui#456', 'my-org/some.repo#22', 'third/party#7'];

/**
 * Each scenario names the exit path it walks and asserts the OUTCOME of it.
 * `check` returns an array of failure strings.
 */
export const SCENARIOS = [
  {
    id: 'P0',
    name: 'no cross-repo keywords -- nothing to do, and nothing said about it',
    scenario: () => ({ body: 'Fixes #12\n\nRefs objectstack-ai/objectui#9 (not a keyword).', token: 'pat' }),
    check: (r, t) => [
      t(r.log.failed.length === 0, `P0 stays green, got setFailed: ${r.log.failed[0]}`),
      t(r.calls.get.length === 0, `P0 calls no API, got ${r.calls.get.length} get(s)`),
      t(r.log.info.some((m) => /No cross-repository closing keywords/.test(m)), 'P0 says why it did nothing'),
    ],
  },
  {
    id: 'P1',
    name: 'the target parse: which spellings qualify, and which must not',
    scenario: () => ({ body: MIXED_BODY, token: 'pat' }),
    check: (r, t) => {
      const line = r.log.info.find((m) => m.startsWith('Cross-repo targets:')) ?? '';
      const listed = line.replace('Cross-repo targets: ', '').split(', ').filter(Boolean);
      return [
        t(listed.length === 3, `P1 finds exactly the three qualified foreign targets, got ${listed.length}: ${line}`),
        ...FOREIGN.map((k) => t(listed.includes(k), `P1 recognises ${k}`)),
        t(!line.includes('#999'), 'P1 does not treat `Part of` as a closing keyword'),
        t(!line.includes('#321'), 'P1 does not act on the bare `#N` form GitHub already handles'),
        t(!line.includes('objectstack-ai/objectstack#5'), 'P1 skips the qualified SAME-repo reference'),
        t(!r.calls.get.includes('objectstack-ai/objectstack#5'), 'P1 never calls the API for the same-repo reference'),
      ];
    },
  },
  {
    id: 'N1',
    name: 'token absent, notice delivered -- green, and the PR carries the work order',
    scenario: () => ({ body: MIXED_BODY, token: undefined }),
    check: (r, t) => [
      t(r.log.failed.length === 0, `N1 stays green, got setFailed: ${r.log.failed[0]}`),
      t(r.calls.prComment.length === 1 && r.calls.prComment[0].delivered, 'N1 posts the notice on this PR'),
      t(FOREIGN.every((k) => (r.calls.prComment[0]?.body ?? '').includes(k)), 'N1 notice lists every target'),
      t(
        r.log.warning.some((w) => FOREIGN.every((k) => w.message.includes(k))),
        'N1 announces the work order as an annotation too (#9575)',
      ),
      t(r.calls.update.length === 0, 'N1 closes nothing -- it has no credential to close with'),
    ],
  },
  {
    id: 'N2',
    name: 'token absent, notice refused -- summary keeps it, job goes red (#9594)',
    scenario: () => ({ body: MIXED_BODY, token: undefined, prCommentError: FIXED }),
    check: (r, t) => [
      t(r.log.failed.length === 1, `N2 fails the job exactly once, got ${r.log.failed.length}`),
      t(FOREIGN.every((k) => (r.log.failed[0] ?? '').includes(k)), 'N2 setFailed names every unclosed target'),
      t(/HTTP 503/.test(r.log.failed[0] ?? ''), 'N2 setFailed names the refusal'),
      t(r.log.summary.length === 1, 'N2 reproduces the whole notice in the job summary'),
      t(r.threw === null, 'N2 does not let the throw escape the script'),
    ],
  },
  {
    id: 'N3',
    name: 'token absent, notice refused AND the summary unwritable -- still red',
    scenario: () => ({ body: MIXED_BODY, token: undefined, prCommentError: FIXED, summaryError: new Error('EACCES') }),
    check: (r, t) => [
      t(r.log.failed.length === 1, 'N3 still fails the job when the richer channel is gone'),
      t(FOREIGN.every((k) => (r.log.failed[0] ?? '').includes(k)), 'N3 setFailed still names every target'),
      t(r.threw === null, 'N3 does not let the summary failure escape'),
    ],
  },
  {
    id: 'L1',
    name: 'token present, every target closed -- comment then close, and green',
    scenario: () => ({ body: MIXED_BODY, token: 'pat' }),
    check: (r, t) => [
      t(r.log.failed.length === 0, `L1 stays green, got setFailed: ${r.log.failed[0]}`),
      t(r.calls.get.length === 3, `L1 reads all three targets, got ${r.calls.get.length}`),
      t(r.calls.comment.length === 3, `L1 leaves the PR link on all three, got ${r.calls.comment.length}`),
      t(r.calls.update.length === 3, `L1 closes all three, got ${r.calls.update.length}`),
      t(
        r.calls.update.every((u) => u.state === 'closed' && u.reason === 'completed'),
        'L1 closes as `completed`, not as `not_planned`',
      ),
      t(
        r.calls.comment.every((c) => c.body.includes('https://github.com/objectstack-ai/objectstack/pull/1234')),
        'L1 comment carries the PR link -- the backlink is half the point of the workflow',
      ),
      t(r.log.warning.length === 0, 'L1 warns about nothing'),
    ],
  },
  {
    id: 'L2',
    name: 'a target that is already closed is skipped, not re-commented (re-run safety)',
    scenario: () => ({
      body: MIXED_BODY,
      token: 'pat',
      issues: { 'objectstack-ai/objectui#456': { state: 'closed' } },
    }),
    check: (r, t) => [
      t(r.log.failed.length === 0, 'L2 stays green'),
      t(!r.calls.comment.some((c) => c.key === 'objectstack-ai/objectui#456'), 'L2 does not re-comment on a closed issue'),
      t(!r.calls.update.some((u) => u.key === 'objectstack-ai/objectui#456'), 'L2 does not re-close a closed issue'),
      t(r.calls.update.length === 2, `L2 still closes the other two, got ${r.calls.update.length}`),
    ],
  },
  {
    id: 'L3',
    name: 'ONE target refused -- the rest still close (isolation) AND the job goes red (#9595)',
    scenario: () => ({
      body: MIXED_BODY,
      token: 'pat',
      issues: { 'objectstack-ai/objectui#456': { getError: DENIED } },
    }),
    check: (r, t) => [
      t(r.calls.get.length === 3, `L3 still visits every target after the refusal, got ${r.calls.get.length}`),
      t(r.calls.update.length === 2, `L3 still closes the two reachable targets, got ${r.calls.update.length}`),
      t(
        r.log.warning.some((w) => w.message.includes('objectstack-ai/objectui#456') && /HTTP 404/.test(w.message)),
        'L3 warns naming the target and the refusal',
      ),
      t(r.log.failed.length === 1, `L3 FAILS the job -- the defect this card is about; got ${r.log.failed.length}`),
      t((r.log.failed[0] ?? '').includes('objectstack-ai/objectui#456'), 'L3 setFailed names the target left open'),
      t(
        !(r.log.failed[0] ?? '').includes('my-org/some.repo#22'),
        'L3 setFailed names ONLY what failed -- a verdict that lists the successes teaches nobody',
      ),
      t(r.log.summary.length === 1, 'L3 writes the list into the job summary'),
      t(r.threw === null, 'L3 does not let the refusal escape the script'),
    ],
  },
  {
    id: 'L4',
    name: 'every target refused (an expired credential) -- all named, none lost',
    scenario: () => ({
      body: MIXED_BODY,
      token: 'expired-pat',
      issues: Object.fromEntries(FOREIGN.map((k) => [k, { getError: UNAUTHORIZED }])),
    }),
    check: (r, t) => [
      t(r.calls.get.length === 3, `L4 attempts every target, got ${r.calls.get.length}`),
      t(r.log.failed.length === 1, 'L4 fails the job once, after the loop -- not once per target'),
      t(FOREIGN.every((k) => (r.log.failed[0] ?? '').includes(k)), 'L4 setFailed names every target left open'),
      t(/HTTP 401/.test(r.log.summary[0] ?? ''), 'L4 summary carries the reason, so the credential is the obvious suspect'),
    ],
  },
  {
    id: 'L5',
    name: 'a target refused AND the summary unwritable -- still red',
    scenario: () => ({
      body: MIXED_BODY,
      token: 'pat',
      issues: { 'third/party#7': { updateError: DENIED } },
      summaryError: new Error('EACCES'),
    }),
    check: (r, t) => [
      t(r.log.failed.length === 1, 'L5 still fails the job when the richer channel is gone'),
      t((r.log.failed[0] ?? '').includes('third/party#7'), 'L5 setFailed still names the target'),
      t(r.threw === null, 'L5 does not let the summary failure escape'),
      t(
        r.calls.comment.some((c) => c.key === 'third/party#7'),
        'L5 fixture is honest: the comment landed and only the close was refused',
      ),
    ],
  },
];

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
    // Assertion 0. github-script compiles the whole block as one function body;
    // this is the 2026-08-02 failure class, and no scenario can run past it.
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
    let result;
    try {
      result = await runScript(source, s.scenario());
    } catch (err) {
      failures.push({ id: s.id, message: `the harness itself threw -- ${err.message}` });
      continue;
    }
    for (const f of s.check(result, t)) if (f) failures.push(f);
  }

  return { failures, checked };
}

// ── Reporting ───────────────────────────────────────────────────────────────

function reportProblems(problems) {
  console.error(`check-cross-repo-closer-outcome: ${problems.length} input problem(s) -- the run is NOT a pass\n`);
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

  const { failures, checked } = await judge(source);
  if (failures.length === 0) {
    console.log(
      `check-cross-repo-closer-outcome: OK (${checked} assertions over ${SCENARIOS.length} scenarios, ` +
        `driving the ${source.length}-char script extracted from ${WORKFLOW}).`,
    );
    process.exit(0);
  }

  console.error(`check-cross-repo-closer-outcome: ${failures.length} failed assertion(s) over the SHIPPED script\n`);
  for (const f of failures) console.error(`  • [${f.id}] ${f.message}`);
  console.error(`
The subject is the inline script in ${WORKFLOW}, run
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
//
// Each mutation states the anchor it needs. A mutation whose anchor is absent
// is a FAILURE here, not a skip: the substitution would then be a no-op, the
// battery would stay green, and the self-test would report a detector it never
// exercised. That is the same #4690 shape the extraction guards against, one
// level in.

const MUTATIONS = [
  {
    id: 'M1',
    what: 'the post-loop verdict is downgraded back to a warning (the #9595 defect, restored)',
    from: 'core.setFailed(\n  `${failures.length} of ${targets.size}',
    to: 'core.warning(\n  `${failures.length} of ${targets.size}',
    expect: ['L3', 'L4', 'L5'],
  },
  {
    id: 'M2',
    what: 'the loop stops collecting the keys it could not close',
    from: 'failures.push({ key, reason });',
    to: '',
    expect: ['L3', 'L4', 'L5'],
  },
  {
    id: 'M3',
    what: 'the loop stops isolating and breaks out on the first refusal',
    from: 'failures.push({ key, reason });',
    to: 'failures.push({ key, reason }); break;',
    expect: ['L3'],
  },
  {
    id: 'M4',
    what: 'the same-repo reference is no longer skipped',
    from: "if (`${owner}/${repo}`.toLowerCase() === thisRepo.toLowerCase()) continue;",
    to: '',
    expect: ['P1'],
  },
  {
    id: 'M5',
    what: 'the keyword set is narrowed, so `Fixes` and `resolved` stop qualifying',
    from: "const KEYWORDS = 'close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved';",
    to: "const KEYWORDS = 'close';",
    expect: ['P1'],
  },
  {
    id: 'M6',
    what: 'the already-closed skip is removed, so a re-run re-comments',
    from: "if (issue.state === 'closed') {",
    to: 'if (false) {',
    expect: ['L2'],
  },
  {
    id: 'M7',
    what: 'the notice path loses its verdict (the #9594 half, restored to its defect)',
    from: 'core.setFailed(\n      `${targets.size} cross-repo issue(s) were left open',
    to: 'core.warning(\n      `${targets.size} cross-repo issue(s) were left open',
    expect: ['N2', 'N3'],
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
  const assert = (cond, msg) => {
    checked++;
    if (!cond) failures.push(msg);
  };

  // 1. The unmutated shipped script must be green -- otherwise every red below
  //    proves nothing about the mutation.
  const clean = await judge(source);
  assert(
    clean.failures.length === 0,
    `the shipped script is green before any mutation, got: ${clean.failures.map((f) => `[${f.id}] ${f.message}`).join(' | ')}`,
  );

  // 2. Every mutation must be REACHED and must turn the battery red, in the
  //    scenarios it names.
  for (const m of MUTATIONS) {
    assert(source.includes(m.from), `${m.id}: its anchor is present in the shipped script (a no-op mutation proves nothing)`);
    if (!source.includes(m.from)) continue;
    const mutated = source.replace(m.from, m.to);
    assert(mutated !== source, `${m.id}: the substitution changed the source`);
    const red = await judge(mutated);
    assert(red.failures.length > 0, `${m.id}: ${m.what} -- the battery goes RED`);
    for (const id of m.expect) {
      assert(
        red.failures.some((f) => f.id === id),
        `${m.id}: scenario ${id} is the one that catches it, got [${red.failures.map((f) => f.id).join(', ')}]`,
      );
    }
  }

  // 3. A script that does not compile is caught before any scenario runs -- the
  //    2026-08-02 failure class, which no outcome assertion could ever see.
  const broken = await judge(`${source}\nconst github = 1;`);
  assert(broken.failures.length === 1 && broken.failures[0].id === 'C0', 'a non-compiling script is reported as C0, once');

  // 4. Missing input is a failure, never a pass (#4690).
  const gone = extractScript(join(root, 'scripts'));
  assert(gone.source === null && gone.problems.length === 1, 'a missing workflow file is an input problem, not a pass');

  // 5. Wiring. A check nobody runs is the #4449 shape this repo keeps paying
  //    for, so the step that invokes it is pinned here.
  const lint = join(root, '.github', 'workflows', 'lint.yml');
  assert(existsSync(lint), 'wiring: .github/workflows/lint.yml exists -- it is where this check runs');
  if (existsSync(lint)) {
    const body = readFileSync(lint, 'utf8');
    assert(body.includes(SELF), `wiring: lint.yml still invokes ${SELF}`);
    assert(body.includes(`${SELF} --self-test`), 'wiring: lint.yml runs the --self-test half too');
  }

  if (failures.length) {
    console.error(`✗ check-cross-repo-closer-outcome --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ check-cross-repo-closer-outcome --self-test: ${checked} assertions, ` +
      `${MUTATIONS.length} mutations of the shipped script each driven to red.`,
  );
}

// The CLI dispatch is guarded so that IMPORTING this module is inert. The
// reverse-verification route needs `extractScript` / `judge` pointed at another
// tree (a pre-fix checkout), and a module that runs its gate on import would
// silently judge THIS repo instead and print a pass about the wrong subject.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--self-test')) await selfTest();
  else if (process.argv.includes('--list')) list();
  else await main();
}
