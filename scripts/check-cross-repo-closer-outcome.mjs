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
// Re-measured for #9643 later the same day over the 1176 most recently UPDATED
// merged PRs (a different window of the same size, 14 qualified same-repo
// references in it): still **zero** foreign. Two independent windows agree,
// which is why the coverage in this file matters more than the behaviour it
// pins -- reading is the only thing that has ever found a defect here.
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
// not, that a same-repo reference is skipped), the target KIND (#9711: a pull
// request is also an issue to `issues.get`, so `owner/repo#N` naming a PR
// reaches the loop like anything else -- the scenarios pin that it is REFUSED
// rather than closed, and that the refusal happens before the already-closed
// branch can leave a comment on somebody else's pull request), and the OUTCOME
// of every exit --
// which of `core.setFailed` / `core.warning` / a job summary fires, and which
// API calls were made. Those are the properties both cards are about.
//
// Also asserted, since #9643: that every API the script calls is one this
// harness MODELS. That is not pedantry -- it is the failure this file walked
// into. Adding `listComments` to the shipped script moved real behaviour and
// all 52 assertions stayed green, because the unstubbed method threw a
// `TypeError` INSIDE the script's own `try` and was absorbed by the very
// degradation branch the new code had just added. A harness whose stubs lag
// the script does not under-report; it reports a pass about a path the script
// no longer takes. So the guard records the access out-of-band and `judge`
// fails the scenario on the record, whatever that scenario's own assertions
// say.
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
// guards. `--self-test` mutates the extracted source and requires the battery
// to go RED for each mutation, naming the scenario it expects.
//
// What the mutations cover is written here as CLASSES, and their number is not
// written here at all (#9917). The list this paragraph used to carry named ten
// of them and was never updated again; the same habit in lint.yml's step
// comment was counting seven when there were fifteen. A prose class survives
// the next mutation being added, a hand-count does not, and `--self-test`
// prints its own total on every run. The classes: a verdict DOWNGRADED (red
// becomes a warning, or an info line nothing annotates), the loop's
// BOOKKEEPING deleted (which keys failed, which half was lost, which target
// was refused -- each one lets a run report green about work it did not do),
// ISOLATION abandoned mid-loop, the TARGET PARSE narrowed (the keyword set,
// the optional colon, the same-repo skip), a GUARD removed (already-closed,
// triage, pull-request), and IDEMPOTENCY eroded (the backlink marker dropped,
// or a blind post where a skip belongs).
//
// Each mutation also asserts its own anchor was PRESENT before substituting: a
// mutation that silently matched nothing would leave the battery green and
// read exactly like a passing self-test.
//
// One scenario (L11) is driven TWICE, the second run's world built out of the
// first run's calls. Re-run idempotency is a property of the PAIR, and a
// fixture that hand-writes the marker proves each half while leaving the two
// runs free to disagree about its spelling -- which is the only way the
// property can actually break.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMap, isSeq, parseDocument } from 'yaml';
import { isEntrypoint } from './invoked-as.mjs';

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

/** The `github.rest.issues.*` methods this harness models. See the `guard` in `makeDoubles`. */
const MODELLED_ISSUE_METHODS = new Set(['get', 'createComment', 'update', 'listComments']);

/**
 * `github` / `context` / `core` doubles plus a call log.
 *
 * `issues` maps `owner/repo#number` to a fixture: `{ state, stateReason,
 * comments }` describes the issue, and `{ getError, listError, commentError,
 * updateError }` refuses one specific call on it -- so a scenario can break one
 * target and leave the rest reachable, which is the whole point of the
 * isolation the loop must keep.
 */
function makeDoubles({ body, token, issues = {}, prCommentError = null, summaryError = null }) {
  const calls = { get: [], list: [], comment: [], update: [], prComment: [] };
  const log = { info: [], warning: [], failed: [], summary: [] };
  const unstubbedCalls = [];
  let summaryBuffer = [];

  const target = (o, r, n) => issues[`${o}/${r}#${n}`] ?? {};

  const issuesApi = {
    async get({ owner, repo, issue_number: n }) {
      calls.get.push(`${owner}/${repo}#${n}`);
      const t = target(owner, repo, n);
      if (t.getError) throw t.getError;
      // `state_reason` is nullable BY CONTRACT on this endpoint -- the API
      // states a reason when it has one and promises nothing otherwise -- so
      // the default models `null` rather than inventing a value the API does
      // not promise. Modelled, not sampled, and that distinction is load
      // bearing here: the citation that stood on this line named a foreign
      // number as a closed issue answering `null` and it was a pull request
      // (#9917). L9 carries the reason a sampled specimen is the wrong kind of
      // evidence for THIS default in particular.
      //
      // `pull_request` is how the same endpoint says the number is a PULL
      // REQUEST, and it is modelled as ABSENCE rather than as `undefined`
      // because that is what was measured: objectstack-ai/objectstack#9716 (a
      // PR) answers `{ url, html_url, diff_url, patch_url, merged_at }`, and
      // #9711 (an issue) carries no such key at all. A fixture that always
      // spelled the key would let a truthiness test pass here that the real
      // API would fail. (#9711)
      return {
        data: {
          state: t.state ?? 'open',
          state_reason: t.stateReason ?? null,
          ...(t.pullRequest ? { pull_request: t.pullRequest } : {}),
        },
      };
    },
    async listComments({ owner, repo, issue_number: n }) {
      const key = `${owner}/${repo}#${n}`;
      calls.list.push(key);
      const t = target(owner, repo, n);
      if (t.listError) throw t.listError;
      return { data: (t.comments ?? []).map((text) => ({ body: text })) };
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
  };

  // An unmodelled API call must be LOUD, and a throw alone is not loud enough
  // here: every call in the loop sits inside the script's own `try`, so a
  // `TypeError` from an unstubbed method is caught by the script and absorbed
  // into whichever degradation that `catch` implements -- leaving the battery
  // green over a behaviour it never exercised. Measured, on the #9643 change
  // itself: adding `listComments` to the shipped script moved real behaviour
  // and all 52 assertions stayed green, because the missing stub landed in the
  // script's own "could not read the comments" branch. So the access is
  // RECORDED as well as thrown, and `judge` fails the scenario on the record.
  //
  // The guard is applied at every level of `github`, not just to the issues
  // methods: `github.paginate`, `github.request` and `github.graphql` are all
  // reachable from a github-script body and all three would otherwise be
  // `undefined`, i.e. the identical silent-absorption bug one level up.
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

  const github = guard(
    { rest: guard({ issues: guard(issuesApi, 'github.rest.issues', MODELLED_ISSUE_METHODS) }, 'github.rest', new Set(['issues'])) },
    'github',
    new Set(['rest']),
  );

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

  return { github, context, core, calls, log, token, unstubbedCalls };
}

/**
 * Anything github-script hands the script that this harness does not model.
 *
 * Records into the same sink as the `github` guard before throwing, for the
 * same reason: a throw raised inside the script's own `try` is caught by the
 * script, and a scenario then reports a pass about a degradation path.
 */
function unstubbed(name, sink) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        sink.push(typeof prop === 'string' ? `${name}.${prop}` : name);
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
    exec: unstubbed('exec', doubles.unstubbedCalls),
    glob: unstubbed('glob', doubles.unstubbedCalls),
    io: unstubbed('io', doubles.unstubbedCalls),
    fetch: unstubbed('fetch', doubles.unstubbedCalls),
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

/**
 * A body carrying the three keyword shapes plus four that must NOT qualify.
 *
 * `CLOSES:` carries the OPTIONAL COLON deliberately, and it is one of the three
 * targets rather than a fourth (#9755): the colon is therefore load-bearing for
 * this body's target ARITY, so dropping `:?` from the shipped regex takes P1
 * from three targets to two instead of leaving the count intact. M15 is that
 * mutation. Before #9755 this fixture used only the space-separated spelling,
 * and the consequence was measured rather than assumed -- adding `:?` to the
 * shipped script moved real behaviour and all 105 assertions stayed green,
 * because no scenario had ever put a colon in front of a qualified reference.
 *
 * That the colon is GitHub's syntax and not a typo is measured too, and in this
 * repository: PR #10241 merged 2026-08-20T15:10:06Z carrying `Filed, not fixed:
 * #10240`, and #10240 closed `completed` at 15:10:08Z with its own
 * `closed_by_pull_requests` naming #10241. So a body spelled this way is a real
 * closing declaration, and a cross-repo target inside one is a target.
 */
const MIXED_BODY = [
  'Fixes objectstack-ai/objectui#456',
  'CLOSES: my-org/some.repo#22',
  'resolved third/party#7',
  '',
  'Part of objectstack-ai/objectui#999 -- a reference, not a close.',
  'Fixes #321 -- bare form, GitHub already handles it.',
  'Closes: #4500 -- bare form WITH the colon; still GitHub\'s own job, not this one.',
  'Fixes objectstack-ai/objectstack#5 -- same repo, GitHub already closed it.',
].join('\n');

const FOREIGN = ['objectstack-ai/objectui#456', 'my-org/some.repo#22', 'third/party#7'];

/** The target the already-closed scenarios (L2, L6-L9) work on. */
const CLOSED_TARGET = 'objectstack-ai/objectui#456';

/** The target the PULL REQUEST scenarios (L12, L13) work on (#9711). */
const PR_TARGET = 'my-org/some.repo#22';

/**
 * The `pull_request` key GitHub returns when an issue number is a pull request.
 *
 * Copied from a real response rather than invented: `GET /repos/
 * objectstack-ai/objectstack/issues/9716` answers exactly these five fields,
 * and `.../issues/9711` -- an issue -- answers with the key absent. The loop
 * reads only its truthiness, but the shape is pinned so that a change in what
 * the script reads out of it (`html_url` reaches the job summary) fails here
 * instead of printing `undefined` into somebody's run.
 */
const PR_KEY = {
  url: 'https://api.github.com/repos/my-org/some.repo/pulls/22',
  html_url: 'https://github.com/my-org/some.repo/pull/22',
  diff_url: 'https://github.com/my-org/some.repo/pull/22.diff',
  patch_url: 'https://github.com/my-org/some.repo/pull/22.patch',
  merged_at: null,
};
const PR_URL = 'https://github.com/objectstack-ai/objectstack/pull/1234';

/**
 * The backlink marker the shipped script is expected to write, spelled out.
 *
 * It is pinned as a LITERAL rather than recomputed from the script, because
 * that is what makes the pair of assertions mean something: L1 asserts the
 * script writes this exact string on the close path, and L6 seeds this exact
 * string as an existing comment to prove the re-run path recognises it. Change
 * the marker's shape in the workflow and L1 goes red -- which is the honest
 * failure, because the two runs of a re-run must agree on one spelling and a
 * harness that derived it from the script could never catch them disagreeing.
 */
const MARKER = '<!-- cross-repo-issue-closer:objectstack-ai/objectstack#1234 -->';

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
        // The colon half, named separately so a red says WHICH spelling was
        // lost rather than only that the count moved (#9755). The target above
        // is reached through `CLOSES:`; this asserts the separator, and the two
        // negatives below assert the colon widens the SEPARATOR only and not
        // the reference scope.
        t(listed.includes(PR_TARGET), `P1 recognises the optional-colon spelling (\`CLOSES: ${PR_TARGET}\`)`),
        t(!line.includes('#4500'), 'P1 does not act on the bare `#N` form when it carries the colon either'),
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
        r.calls.comment.every((c) => c.body.includes(PR_URL)),
        'L1 comment carries the PR link -- the backlink is half the point of the workflow',
      ),
      t(
        r.calls.comment.every((c) => c.body.includes(MARKER)),
        'L1 comment carries the per-PR marker, so a LATER run can tell this backlink is already there (#9643)',
      ),
      t(r.log.warning.length === 0, 'L1 warns about nothing'),
    ],
  },
  {
    id: 'L2',
    name: 'already closed by a human -- the backlink still lands, the close does not (#9643)',
    scenario: () => ({
      body: MIXED_BODY,
      token: 'pat',
      // Closed, `completed`, and carrying no backlink from this PR: the
      // ordinary sequence the file's header is about -- the fix shipped,
      // somebody tidied the tracker, then the merge happened.
      issues: { [CLOSED_TARGET]: { state: 'closed', stateReason: 'completed', comments: [] } },
    }),
    check: (r, t) => {
      const posted = r.calls.comment.find((c) => c.key === CLOSED_TARGET);
      return [
        t(r.log.failed.length === 0, `L2 stays green, got setFailed: ${r.log.failed[0]}`),
        t(r.calls.list.includes(CLOSED_TARGET), 'L2 reads the comments before posting -- the re-run guard'),
        t(Boolean(posted), 'L2 LEAVES THE BACKLINK on the already-closed issue -- the defect this card is about'),
        t((posted?.body ?? '').includes(PR_URL), 'L2 backlink names the PR that fixed it'),
        t((posted?.body ?? '').includes(MARKER), 'L2 backlink carries the marker, so a re-run recognises it'),
        t(
          !r.calls.update.some((u) => u.key === CLOSED_TARGET),
          'L2 does NOT re-close it -- the close is the half that really was redundant',
        ),
        t(r.calls.update.length === 2, `L2 still closes the other two, got ${r.calls.update.length}`),
        t(r.log.warning.length === 0, 'L2 warns about nothing -- leaving a backlink is the normal outcome, not a degradation'),
      ];
    },
  },
  {
    id: 'L6',
    name: 'already closed AND already linked (a re-run) -- nothing is posted twice (#9643)',
    scenario: () => ({
      body: MIXED_BODY,
      token: 'pat',
      issues: {
        [CLOSED_TARGET]: {
          state: 'closed',
          stateReason: 'completed',
          // What an earlier run of THIS job left behind. The marker is the only
          // thing that separates this case from L2: `closed_by` is a login and
          // every seat in this org shares one identity.
          comments: ['已由 objectstack-ai/objectstack 的 ' + PR_URL + ' 修复并合并。\n\n' + MARKER],
        },
      },
    }),
    check: (r, t) => [
      t(r.log.failed.length === 0, 'L6 stays green'),
      t(r.calls.list.includes(CLOSED_TARGET), 'L6 reads the comments'),
      t(
        !r.calls.comment.some((c) => c.key === CLOSED_TARGET),
        'L6 posts NO second backlink -- re-running this job must be idempotent (#9643 H2)',
      ),
      t(!r.calls.update.some((u) => u.key === CLOSED_TARGET), 'L6 does not re-close it either'),
      t(r.calls.update.length === 2, `L6 still closes the other two, got ${r.calls.update.length}`),
    ],
  },
  {
    id: 'L7',
    name: 'already closed as not_planned -- no backlink, because it would contradict the triage (#9643)',
    scenario: () => ({
      body: MIXED_BODY,
      token: 'pat',
      issues: { [CLOSED_TARGET]: { state: 'closed', stateReason: 'not_planned', comments: [] } },
    }),
    check: (r, t) => [
      t(r.log.failed.length === 0, 'L7 stays green -- a disagreement between two humans is not a job failure'),
      t(
        !r.calls.comment.some((c) => c.key === CLOSED_TARGET),
        'L7 posts NO backlink -- a comment saying this PR fixed a not_planned issue would be actively wrong',
      ),
      t(!r.calls.update.some((u) => u.key === CLOSED_TARGET), 'L7 does not reopen or re-close it'),
      t(
        !r.calls.list.includes(CLOSED_TARGET),
        'L7 does not even list the comments -- the triage reason settles it before idempotency matters',
      ),
      t(
        r.log.warning.some((w) => w.message.includes(CLOSED_TARGET) && /not_planned/.test(w.message)),
        'L7 ANNOUNCES the contradiction rather than skipping silently -- only a human can settle it',
      ),
      t(r.calls.update.length === 2, `L7 still closes the other two, got ${r.calls.update.length}`),
    ],
  },
  {
    id: 'L8',
    name: 'already closed but the comment listing is refused -- skip AT MOST ONCE, and say so (#9643)',
    scenario: () => ({
      body: MIXED_BODY,
      token: 'pat',
      issues: { [CLOSED_TARGET]: { state: 'closed', stateReason: 'completed', listError: FIXED } },
    }),
    check: (r, t) => [
      t(r.log.failed.length === 0, `L8 stays green, got setFailed: ${r.log.failed[0]}`),
      t(
        !r.calls.comment.some((c) => c.key === CLOSED_TARGET),
        'L8 does NOT post blind -- the marker is stable, so a blind post strands a permanent duplicate '
          + "on another repo's closed issue (merge-queue-triage.yml chooses the opposite, from a per-RUN marker)",
      ),
      t(
        r.log.warning.some((w) => w.message.includes(CLOSED_TARGET) && /HTTP 503/.test(w.message)),
        'L8 names the target AND the refusal -- a skip with a stated reason, not a silent one',
      ),
      t(r.calls.update.length === 2, `L8 still closes the other two -- one bad listing isolates, got ${r.calls.update.length}`),
    ],
  },
  {
    id: 'L9',
    name: 'already closed with a NULL state_reason -- read as completed, so the backlink lands (#9643)',
    scenario: () => ({
      body: MIXED_BODY,
      token: 'pat',
      // MODELLED FROM THE CONTRACT, deliberately not sampled. `issues.get`
      // declares `state_reason` nullable and promises no reason on a closed
      // issue, so a fix that keys on the reason has to say what null means, and
      // this pins the answer -- the shipped script's own reading of it, "no
      // objection recorded", is stated on the already-closed branch of
      // .github/workflows/cross-repo-issue-closer.yml, which is the subject
      // this scenario drives.
      //
      // A SAMPLED citation stood here and was withdrawn (#9917): it named
      // objectui#4478 as a closed issue answering `null`, and that number is a
      // PULL REQUEST. Read that as the trap it is rather than as one bad
      // lookup -- the objects that most dependably answer `state: 'closed'`
      // with `state_reason: null` ARE pull requests, so hunting a specimen for
      // this fixture walks straight into L13's subject, and the file then
      // offers ONE observation as evidence for two opposite scenarios. L9 and
      // L13 are kept on separate footings on purpose: L9 models the contract
      // and cites nothing, L13 cites a measured pull request
      // (objectstack-ai/objectstack#9143). Do not "improve" this by finding a
      // real issue to name.
      issues: { [CLOSED_TARGET]: { state: 'closed', stateReason: null, comments: [] } },
    }),
    check: (r, t) => [
      t(r.log.failed.length === 0, 'L9 stays green'),
      t(
        r.calls.comment.some((c) => c.key === CLOSED_TARGET),
        'L9 treats a null reason as "no objection recorded" and leaves the backlink',
      ),
      t(!r.calls.update.some((u) => u.key === CLOSED_TARGET), 'L9 still does not re-close it'),
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
  {
    id: 'L10',
    name: 'the BACKLINK is refused on an already-closed target -- red, and the verdict says which half was lost',
    scenario: () => ({
      body: MIXED_BODY,
      token: 'pat',
      issues: {
        [CLOSED_TARGET]: { state: 'closed', stateReason: 'completed', comments: [], commentError: DENIED },
      },
    }),
    check: (r, t) => [
      t(r.log.failed.length === 1, `L10 fails the job -- half the deliverable was lost; got ${r.log.failed.length}`),
      t((r.log.failed[0] ?? '').includes(CLOSED_TARGET), 'L10 setFailed names the target'),
      t(r.calls.update.length === 2, `L10 still closes the other two, got ${r.calls.update.length}`),
      t(
        /backlink/.test(r.log.summary[0] ?? ''),
        'L10 summary says the BACKLINK was lost, not the close -- reporting "still open" about a closed '
          + 'issue sends the reader to do the one thing that is already done',
      ),
      t(
        !/close and backlink/.test(r.log.summary[0] ?? ''),
        'L10 does not claim the close was lost too -- the issue was already closed before this run',
      ),
      t(r.threw === null, 'L10 does not let the refusal escape the script'),
    ],
  },
  {
    id: 'L11',
    name: 'the ROUND TRIP: re-running the job after a clean close posts no second backlink (#9643 H2)',
    scenario: () => ({ body: MIXED_BODY, token: 'pat' }),
    // Run 2 sees exactly the world run 1 left behind: every target closed, each
    // carrying the very comment run 1 posted. Nothing is hand-written -- the
    // marker travels from run 1's OUTPUT into run 2's INPUT, so this is the one
    // assertion that fails if the two runs ever disagree on its spelling.
    rerun: (first) => ({
      body: MIXED_BODY,
      token: 'pat',
      issues: Object.fromEntries(
        first.calls.comment.map((c) => [c.key, { state: 'closed', stateReason: 'completed', comments: [c.body] }]),
      ),
    }),
    check: (r, t, first) => [
      t(first.calls.comment.length === 3, `L11 run 1 comments on all three, got ${first.calls.comment.length}`),
      t(first.calls.update.length === 3, `L11 run 1 closes all three, got ${first.calls.update.length}`),
      t(r.calls.list.length === 3, `L11 run 2 checks all three for an existing backlink, got ${r.calls.list.length}`),
      t(
        r.calls.comment.length === 0,
        `L11 run 2 posts NOTHING -- \`pull_request_target: [closed]\` can be replayed by a re-run, and this `
          + `workflow's own job summary tells people to do exactly that; got ${r.calls.comment.length} duplicate(s)`,
      ),
      t(r.calls.update.length === 0, `L11 run 2 re-closes nothing, got ${r.calls.update.length}`),
      t(r.log.failed.length === 0, `L11 run 2 stays green, got setFailed: ${r.log.failed[0]}`),
      t(r.log.warning.length === 0, 'L11 run 2 warns about nothing -- an idempotent re-run is a normal outcome'),
    ],
  },
  {
    id: 'L12',
    name: 'the target is an OPEN pull request -- refused out loud, never closed (#9711)',
    scenario: () => ({
      body: MIXED_BODY,
      token: 'pat',
      issues: { [PR_TARGET]: { state: 'open', pullRequest: PR_KEY } },
    }),
    check: (r, t) => [
      t(r.calls.get.includes(PR_TARGET), 'L12 reads the target -- the kind is only knowable from the response'),
      t(
        !r.calls.update.some((u) => u.key === PR_TARGET),
        "L12 does NOT close the pull request -- GitHub's own keyword parser never closes one, and this "
          + 'workflow exists to carry that behaviour across repos, not to exceed it. A closed PR also loses '
          + 'its merge-queue membership and any armed auto-merge in the same step, and neither returns by itself',
      ),
      t(!r.calls.comment.some((c) => c.key === PR_TARGET), 'L12 posts nothing on the foreign pull request either'),
      t(
        !r.calls.list.includes(PR_TARGET),
        'L12 does not even list its comments -- the target KIND settles it before idempotency can matter',
      ),
      t(
        r.log.warning.some((w) => w.message.includes(PR_TARGET) && /PULL REQUEST/.test(w.message)),
        'L12 ANNOUNCES the refusal and names the target -- a quiet `continue` here would have been the '
          + "eleventh silent exit in a file whose ten known ones were each found by somebody reading it",
      ),
      t(
        r.log.failed.length === 1,
        `L12 fails the job: the merged body declares a close that can never fire, and this run is the only `
          + `thing that will ever know; got ${r.log.failed.length}`,
      ),
      t((r.log.failed[0] ?? '').includes(PR_TARGET), 'L12 setFailed names the malformed target'),
      t(
        !/re-run this job once the cause is cleared/.test(r.log.failed[0] ?? ''),
        'L12 verdict does not send the reader to re-run -- unlike every other red path here the refusal is '
          + 'deterministic, and only the PR body can change it',
      ),
      t((r.log.summary[0] ?? '').includes(PR_TARGET), 'L12 summary carries it too, with the PR url'),
      t(r.calls.update.length === 2, `L12 still closes the other two targets -- isolation holds; got ${r.calls.update.length}`),
      t(r.threw === null, 'L12 does not let anything escape the script'),
    ],
  },
  {
    id: 'L13',
    name: 'the target is a MERGED pull request -- refused BEFORE the already-closed branch comments on it (#9711)',
    scenario: () => ({
      body: MIXED_BODY,
      token: 'pat',
      // A merged pull request answers `state: 'closed'` with
      // `state_reason: null` from the issues endpoint -- measured on
      // objectstack-ai/objectstack#9143. That is the very fixture SHAPE L9 uses
      // to prove a closed ISSUE gets its backlink -- the shape, not the
      // observation: L9 models its null from the contract and cites no object,
      // precisely so that this measured pull request stays evidence for THIS
      // scenario only (#9917). The shared shape is what makes this the ORDERING
      // test: a `pull_request` guard placed after the state branch would sail
      // past it and comment on somebody else's pull request.
      issues: {
        [PR_TARGET]: {
          state: 'closed',
          stateReason: null,
          comments: [],
          pullRequest: { ...PR_KEY, merged_at: '2026-08-16T14:56:58Z' },
        },
      },
    }),
    check: (r, t) => [
      t(
        !r.calls.comment.some((c) => c.key === PR_TARGET),
        'L13 leaves NO backlink on a merged pull request -- the path L9 pins for a closed issue must not be reached here',
      ),
      t(
        !r.calls.list.includes(PR_TARGET),
        'L13 never reaches the idempotency check, which is what proves the kind guard runs FIRST',
      ),
      t(!r.calls.update.some((u) => u.key === PR_TARGET), 'L13 does not touch its state'),
      t(r.log.failed.length === 1, `L13 fails the job for the same reason L12 does, got ${r.log.failed.length}`),
      t((r.log.failed[0] ?? '').includes(PR_TARGET), 'L13 setFailed names it'),
      t(r.calls.update.length === 2, `L13 still closes the other two, got ${r.calls.update.length}`),
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
    let first = null;
    try {
      result = await runScript(source, s.scenario());
      // A scenario with `rerun` is driven TWICE, the second run's world built
      // from the first run's output. That is the only way to prove the two runs
      // agree on one marker spelling -- a fixture that hand-writes the marker
      // proves each half separately and the round trip not at all.
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
    // notice it. See the guard in `makeDoubles`.
    for (const name of new Set([...(first?.unstubbedCalls ?? []), ...result.unstubbedCalls])) {
      checked++;
      failures.push({
        id: s.id,
        message: `the shipped script called \`${name}()\`, which this harness does not model -- `
          + "the script's own catch absorbed it, so this scenario verified a degradation path rather "
          + 'than the behaviour it names. Model the call in `makeDoubles`.',
      });
    }
    for (const f of s.check(result, t, first)) if (f) failures.push(f);
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
    from: "core.setFailed(verdict.join(' '));",
    to: "core.warning(verdict.join(' '));",
    // Since #9711 the verdict carries both red classes, so this one mutation
    // now has to be caught by an API refusal AND by a malformed target.
    expect: ['L3', 'L4', 'L5', 'L12', 'L13'],
  },
  {
    id: 'M2',
    what: 'the loop stops collecting the keys it could not close',
    from: 'failures.push({ key, reason, lost });',
    to: '',
    expect: ['L3', 'L4', 'L5'],
  },
  {
    id: 'M3',
    what: 'the loop stops isolating and breaks out on the first refusal',
    from: 'failures.push({ key, reason, lost });',
    to: 'failures.push({ key, reason, lost }); break;',
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
    id: 'M15',
    what: 'the optional colon is dropped, so `Fixes: owner/repo#N` stops being a target (the #9755 defect, restored)',
    // The anchor is the SEPARATOR alone, not the whole pattern: the reference
    // half of this regex is the closer's own scope decision (qualified only)
    // and is pinned by the negatives in P1, while this half is the one that has
    // to keep agreeing with duplicate-fix-guard.yml. Restoring it to `\\s+` is
    // exactly the text that shipped before #9755.
    from: ':?\\\\s+([\\\\w.-]+)',
    to: '\\\\s+([\\\\w.-]+)',
    expect: ['P1'],
  },
  {
    id: 'M6',
    what: 'the already-closed branch is removed, so a closed issue is commented on AND re-closed',
    from: "if (issue.state === 'closed') {",
    to: 'if (false) {',
    // L2/L9 lose the "does not re-close it" half; L6 re-comments on a target
    // that already carries the backlink; L7 posts a "fixed by" comment on a
    // not_planned issue; L8 posts blind. Every already-closed scenario.
    expect: ['L2', 'L6', 'L7', 'L8', 'L9'],
  },
  {
    id: 'M8',
    what: 'the backlink loses its per-PR marker, so a re-run cannot tell its own comment is already there',
    from: '---\\n_Generated by [Claude Code](https://claude.ai/code)_\\n\\n${backlinkMarker}',
    to: '---\\n_Generated by [Claude Code](https://claude.ai/code)_',
    // L1 and L2 catch it on the comments the script POSTS; L11 catches the
    // consequence, by feeding run 1's output into run 2 and finding a duplicate.
    expect: ['L1', 'L2', 'L11'],
  },
  {
    id: 'M9',
    what: 'the triage guard is dropped, so a not_planned issue gets a comment claiming this PR fixed it',
    from: "if (issue.state_reason === 'not_planned' || issue.state_reason === 'duplicate') {",
    to: 'if (false) {',
    expect: ['L7'],
  },
  {
    id: 'M10',
    what: 'an unreadable comment listing degrades to posting BLIND instead of skipping (a stranded duplicate)',
    from: '{ title: \'Cross-repo backlink skipped, not confirmed\' },\n        );\n        continue;',
    to: "{ title: 'Cross-repo backlink skipped, not confirmed' },\n        );",
    expect: ['L8'],
  },
  {
    id: 'M11',
    what: 'the loop stops recording WHICH half it lost, so the verdict cannot tell a lost close from a lost backlink',
    from: 'failures.push({ key, reason, lost });',
    to: 'failures.push({ key, reason });',
    expect: ['L10'],
  },
  {
    id: 'M12',
    what: 'the pull-request guard is dropped, so a keyword aimed at a foreign PR comments on it and CLOSES it (#9711)',
    from: 'if (issue.pull_request) {',
    to: 'if (false) {',
    expect: ['L12', 'L13'],
  },
  {
    id: 'M13',
    what: 'a refused pull-request target stops being recorded, so the run refuses it and still reports green',
    from: 'malformed.push({ key, url: issue.pull_request.html_url });',
    to: '',
    expect: ['L12', 'L13'],
  },
  {
    id: 'M14',
    what: 'the refusal is downgraded to an info line, so nothing annotates the run it happened in',
    from: 'core.warning(\n        `${key} is a PULL REQUEST',
    to: 'core.info(\n        `${key} is a PULL REQUEST',
    expect: ['L12'],
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
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) await selfTest();
  else if (process.argv.includes('--list')) list();
  else await main();
}
