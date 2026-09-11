#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * report-unmeasured-gate-tail -- turn `Lint & Repo Gates`' abort into a NUMBER.
 *
 *   node scripts/report-unmeasured-gate-tail.mjs              # in-job, on failure
 *   node scripts/report-unmeasured-gate-tail.mjs --self-test  # offline, no token
 *
 * ## What this is for
 *
 * The `lint` job in `.github/workflows/lint.yml` runs its gates as a sequence of
 * separate Actions steps and stops at the first non-zero exit. That is
 * DELIBERATE and adjudicated -- see the `GATE ORDER IS DELIBERATE` note above
 * `jobs:` in that file, which also names the quantity it is tuned to shrink:
 * "the unmeasured tail". This script is the thing that finally prints that
 * quantity.
 *
 * The consequence of aborting is not a smaller signal, it is a DIFFERENT one:
 *
 *   one red gate is a LOWER BOUND on the number of problems in the tree,
 *   never a count.
 *
 * A gate that never executed produced no output, and no output is the shape a
 * passing gate also has. Reading the tail as "the rest passed" is the zero this
 * repo keeps refusing elsewhere: a probe that cannot answer "yes" returns NOT
 * MEASURED, not "none".
 *
 * ## The premise this was built on, measured on three surfaces
 *
 * The originating card said the abort is invisible -- that "nothing in the
 * output says they did not run". Measured against run 34468505490 (job
 * 102842713265, `Lint & Repo Gates`, failed at step #55 of 169), that claim is
 * TOO STRONG in one place and exactly right in two:
 *
 *   Actions Web UI / jobs API `steps[]`
 *       SAYS IT, one row at a time: 115 entries came back with
 *       `conclusion: "skipped"`. It does NOT count them, and `"skipped"` is the
 *       same word the API uses for a step its own `if:` turned off -- so the
 *       surface that does say it cannot tell the two apart. A reader wanting
 *       the number counts grey rows by hand.
 *
 *   check-run `output`
 *       SAYS NOTHING: `output.title`, `output.summary` and `output.text` were
 *       all null; the only content was `annotations_count: 1`, the failing
 *       gate's own annotation. `GITHUB_STEP_SUMMARY` appears zero times in
 *       lint.yml, so there is no writer for that surface at all.
 *
 *   job log (what an API/agent reader consumes)
 *       SAYS NOTHING: the log ends with the failing gate's output, then
 *       `Process completed with exit code 1`, then `Post job cleanup`. Not one
 *       line about the 115 steps behind it.
 *
 * So the narrowed, honest defect is: **no surface anywhere carries a COUNT, and
 * the two surfaces read by API and by agents carry nothing at all.** This script
 * writes the count to all three.
 *
 * ## Why it reads the API instead of counting locally
 *
 * The tail's size is `declared - reached`, and only the runner knows `reached`.
 * Nothing inside a step exposes which step index is executing, so the count has
 * to come from the jobs API for this run. The job therefore needs
 * `actions: read`, which is the one permission this adds.
 *
 * The pre/post boundary in that response is the reading already pinned by
 * `scripts/pm/ci-failure.mjs` (`stepsIntegrity`): a job's `steps[]` carries ONE
 * numbering gap, at the transition into the runner's reserved `Post <action>`
 * block, and that gap is the normal shape rather than truncation. This file
 * re-spells the boundary rather than importing it, to keep the lint job's
 * failure reporter off the PM tooling's import graph -- `ci-failure.mjs` pulls
 * in `check-governed-merges.mjs`, and a reporter that runs on every red run
 * should not go dark because a PM tool moved.
 *
 * ## What it deliberately does NOT do
 *
 *   * It does not make the skipped gates run. That would undo the adjudicated
 *     fail-fast ordering and, worse, is the shape that produces cascading false
 *     reds if the gates ever do depend on each other.
 *   * It does not use `continue-on-error`, on itself or on anything else.
 *     Trading a red for a warning is the failure mode this whole idea exists to
 *     avoid; the job's conclusion is untouched.
 *   * It never fails the job. It runs only when the job is ALREADY failed, so
 *     its own non-zero exit could only add a second, misleading annotation. When
 *     it cannot measure, it says NOT MEASURED and names the reason -- which is
 *     the whole point -- and still exits 0.
 *   * It emits exactly ONE `notice` annotation, never a `warning` and never an
 *     `error`. A notice on an already-failed check cannot be read as a claim
 *     that something passed, and cannot be read as a downgrade of the red.
 *
 * ## Cost on a green run
 *
 * Zero. The step carries `if: failure()`, so on a green head it is skipped: no
 * log bytes, no summary bytes, no annotation. The only residue is one more row
 * in the job's step list, which is a property of the job, not of its output.
 */

import process from 'node:process';
import { appendFileSync } from 'node:fs';

import { isEntrypoint } from './invoked-as.mjs';

/** The verdict `selfTest()` returns when it reached its own end. */
const SELF_TEST_VERDICT = 'report-unmeasured-gate-tail:self-test:complete';

/**
 * Steps the RUNNER injects, which are not gates and must not be counted as
 * such. `Set up job` opens every job; the `Post <action>` block plus
 * `Complete job` closes it. No declared step in the `lint` job collides with
 * either spelling -- asserted in the self-test.
 */
const INJECTED_HEAD = 'Set up job';
const POST_STEP = /^Post /;

/**
 * Split one job's `steps[]` into the declared region and the runner's tail
 * block.
 *
 * The boundary is the first `Post <action>` step; `Complete job` sits behind it
 * and so needs no rule of its own. Returning the index rather than a filtered
 * array keeps the caller's positions aligned with the API's `number` field.
 *
 * @param {Array<Record<string, unknown>>} steps
 * @returns {{ declared: Array<Record<string, unknown>>, postIndex: number }}
 */
export function declaredRegion(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const postIndex = list.findIndex((s) => POST_STEP.test(String(s?.name ?? '')));
  const end = postIndex === -1 ? list.length : postIndex;
  const declared = list.slice(0, end).filter((s) => String(s?.name ?? '') !== INJECTED_HEAD);
  return { declared, postIndex };
}

/**
 * Count the tail, from one job's `steps[]`.
 *
 * Pure, so `--self-test` drives the real decision over recorded API responses
 * rather than over an imitation of it.
 *
 * The three populations are kept apart on purpose, because collapsing them is
 * the defect this reports on:
 *
 *   ran                  executed, and said something
 *   skippedByCondition   turned off by its OWN `if:` BEFORE the failure -- a
 *                        deliberate, paid-for absence (the gate-family
 *                        selector), not an unmeasured one
 *   neverRan             behind the failure. Once the job is over the API calls
 *                        these "skipped" too, which is precisely why a reader
 *                        of that surface cannot tell them from the line above.
 *
 * ## Behind the failure, POSITION is the authority, not `conclusion`
 *
 * ⚠️ Measured, and it cost a wrong number once: this runs while the job is still
 * in progress, and the runner stamps `skipped` on the steps behind the failure
 * PROGRESSIVELY. In run 34583803573 of this workflow -- a deliberate
 * double-failure probe -- the completed job ended with 161 skipped declared
 * steps, but at the instant this step read the API only 12 of them carried that
 * word. Counting `conclusion === 'skipped'` therefore reported `never_ran=12`
 * for a tail of 161: a lower bound on a lower bound, and a number that reads as
 * precise.
 *
 * So the tail is counted by POSITION -- every declared step behind the failing
 * one -- and `conclusion` is used only to SUBTRACT the steps that demonstrably
 * did run (an `if: always()`/`if: failure()` step, and this reporter itself,
 * which is the one step in `in_progress` while this executes). A step the runner
 * has not reached yet is not evidence of anything, and is not read as one.
 *
 * @param {Array<Record<string, unknown>>} steps a job's `steps[]` from the API
 * @returns {{
 *   measured: boolean, reason?: string, total: number, failedNumber: number|null,
 *   failedName: string|null, ran: number, skippedByCondition: string[],
 *   neverRan: string[], alsoFailed: string[], inFlight: string[],
 * }}
 */
export function judge(steps) {
  const empty = {
    measured: false,
    total: 0,
    failedNumber: null,
    failedName: null,
    ran: 0,
    skippedByCondition: [],
    neverRan: [],
    alsoFailed: [],
    inFlight: [],
  };

  const list = Array.isArray(steps) ? steps : [];
  if (list.length === 0) {
    return { ...empty, reason: 'the jobs API returned no steps for this job' };
  }

  const { declared } = declaredRegion(list);
  if (declared.length === 0) {
    return { ...empty, reason: 'the jobs API returned no declared steps for this job' };
  }

  const failedIdx = declared.findIndex((s) => String(s?.conclusion ?? '') === 'failure');
  if (failedIdx === -1) {
    return {
      ...empty,
      total: declared.length,
      reason:
        'no step in this job reported conclusion "failure", so there is no point to measure the tail from',
    };
  }

  const nameOf = (s) => String(s?.name ?? '(unnamed step)');
  const conclusionOf = (s) => String(s?.conclusion ?? '');
  /** The two conclusions that PROVE a step executed. Everything else does not. */
  const EXECUTED = new Set(['success', 'failure']);

  const before = declared.slice(0, failedIdx);
  const after = declared.slice(failedIdx + 1);

  // The only step that can be `in_progress` behind the failure is this reporter,
  // because it is the one running right now. Held apart so it is never counted
  // as an unmeasured gate.
  const inFlight = after.filter((s) => String(s?.status ?? '') === 'in_progress').map(nameOf);

  return {
    measured: true,
    total: declared.length,
    failedNumber: Number(declared[failedIdx]?.number ?? 0) || null,
    failedName: nameOf(declared[failedIdx]),
    // Before the failure every conclusion is already final, so it can be read.
    ran: before.filter((s) => conclusionOf(s) !== 'skipped').length,
    skippedByCondition: before.filter((s) => conclusionOf(s) === 'skipped').map(nameOf),
    // Behind it, none of them are. Position decides; `conclusion` only subtracts.
    neverRan: after
      .filter((s) => String(s?.status ?? '') !== 'in_progress' && !EXECUTED.has(conclusionOf(s)))
      .map(nameOf),
    alsoFailed: after.filter((s) => conclusionOf(s) === 'failure').map(nameOf),
    inFlight,
  };
}

/** The one machine-readable line. Stable key=value, one line, easy to grep. */
export function machineLine(v) {
  if (!v.measured) return 'unmeasured-gate-tail: measured=no never_ran=NOT_MEASURED';
  return (
    'unmeasured-gate-tail: measured=yes' +
    ` never_ran=${v.neverRan.length}` +
    ` failed=${1 + v.alsoFailed.length}` +
    ` ran=${v.ran}` +
    ` skipped_by_condition=${v.skippedByCondition.length}` +
    ` declared=${v.total}` +
    ` failed_at_step=${v.failedNumber ?? 'unknown'}`
  );
}

/**
 * The human half, for the job log and the job summary.
 *
 * The un-run gates are listed in FULL and never truncated: a report about an
 * unmeasured tail that itself ends in "... and 94 more" has reproduced the
 * defect one level up.
 */
export function renderReport(v) {
  const out = [];
  out.push('');
  out.push('--- UNMEASURED GATE TAIL ------------------------------------------');
  out.push('');
  out.push('This job stops at the first non-zero exit, deliberately (see the GATE');
  out.push('ORDER note in .github/workflows/lint.yml). So the red above is a LOWER');
  out.push('BOUND on the number of problems in this tree, not a count.');
  out.push('');

  if (!v.measured) {
    out.push(`  NOT MEASURED: ${v.reason}.`);
    out.push('');
    out.push('  A tail of unknown size is still a tail. Do not read the gates behind');
    out.push('  the failure as passing -- nothing here says they ran.');
    out.push('');
    out.push(`  ${machineLine(v)}`);
    out.push('');
    return out.join('\n');
  }

  out.push(`  failed at step #${v.failedNumber}: ${v.failedName}`);
  out.push(`  declared steps in this job:            ${v.total}`);
  out.push(`  ran before the failure:                ${v.ran}`);
  out.push(`  turned off by their own condition:     ${v.skippedByCondition.length}`);
  out.push(`  NEVER RAN (the unmeasured tail):       ${v.neverRan.length}`);
  if (v.alsoFailed.length > 0) {
    out.push(`  further steps that also FAILED:        ${v.alsoFailed.length}`);
  }
  out.push('');

  if (v.neverRan.length === 0) {
    out.push('  The tail is empty: every other gate in this job reported. For THIS');
    out.push('  run the red count above is a count, not a lower bound.');
  } else {
    out.push(`  These ${v.neverRan.length} gate(s) produced no output because they never executed.`);
    out.push('  That is NOT MEASURED, not "passed". Fix the failure above and re-run');
    out.push('  to find out what they would have said:');
    out.push('');
    for (const name of v.neverRan) out.push(`    - ${name}`);
  }

  if (v.skippedByCondition.length > 0) {
    out.push('');
    out.push('  Turned off by their own condition (a deliberate absence, not this');
    out.push('  tail) -- the jobs API reports these with the same "skipped" word:');
    for (const name of v.skippedByCondition) out.push(`    - ${name}`);
  }

  out.push('');
  out.push(`  ${machineLine(v)}`);
  out.push('');
  return out.join('\n');
}

/** The same verdict as GitHub-flavoured markdown, for the job summary. */
export function renderSummary(v) {
  const lines = ['## Unmeasured gate tail', ''];
  if (!v.measured) {
    lines.push(`**NOT MEASURED** — ${v.reason}.`, '', '```', machineLine(v), '```', '');
    return lines.join('\n');
  }
  lines.push(
    `This job aborts at the first non-zero exit, so the red is a **lower bound**, not a count.`,
    '',
    `| | |`,
    `|:--|--:|`,
    `| failed at step #${v.failedNumber} | \`${v.failedName}\` |`,
    `| ran before the failure | ${v.ran} |`,
    `| turned off by their own condition | ${v.skippedByCondition.length} |`,
    `| **never ran (unmeasured tail)** | **${v.neverRan.length}** |`,
    '',
  );
  if (v.neverRan.length > 0) {
    lines.push('<details><summary>The gates that never ran</summary>', '');
    for (const name of v.neverRan) lines.push(`- ${name}`);
    lines.push('', '</details>', '');
  }
  lines.push('```', machineLine(v), '```', '');
  return lines.join('\n');
}

// -- the live half ----------------------------------------------------------

/**
 * Fetch every job of this run, following pagination.
 *
 * @param {{ repository: string, runId: string, token: string, apiUrl: string, fetchImpl?: typeof fetch }} opts
 */
export async function fetchRunJobs({ repository, runId, token, apiUrl, fetchImpl }) {
  const doFetch = fetchImpl ?? fetch;
  const jobs = [];
  for (let page = 1; page <= 10; page++) {
    const url = `${apiUrl}/repos/${repository}/actions/runs/${runId}/jobs?per_page=100&page=${page}`;
    const res = await doFetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
    const body = await res.json();
    const batch = Array.isArray(body?.jobs) ? body.jobs : [];
    jobs.push(...batch);
    if (batch.length < 100) break;
  }
  return jobs;
}

/**
 * Pick THIS job out of the run's jobs.
 *
 * Matched on `runner_name`, which the runner also exports as `RUNNER_NAME`, so
 * nothing here hardcodes the job's `name:` -- that literal is the required
 * status-check context (lint.yml's own note), and a reporter that silently
 * stopped matching when it was renamed would be the same class of defect this
 * file exists to remove. The in-progress filter breaks the tie if a runner name
 * is ever reused inside one run.
 *
 * @param {Array<Record<string, unknown>>} jobs
 * @param {string} runnerName
 */
export function pickOwnJob(jobs, runnerName) {
  const list = Array.isArray(jobs) ? jobs : [];
  const byRunner = list.filter((j) => String(j?.runner_name ?? '') === runnerName && runnerName !== '');
  if (byRunner.length === 1) return byRunner[0];
  const running = (byRunner.length > 1 ? byRunner : list).filter(
    (j) => String(j?.status ?? '') === 'in_progress',
  );
  if (running.length === 1) return running[0];
  return null;
}

async function main() {
  const env = process.env;
  const token = env.GITHUB_TOKEN ?? '';
  const repository = env.GITHUB_REPOSITORY ?? '';
  const runId = env.GITHUB_RUN_ID ?? '';
  const apiUrl = env.GITHUB_API_URL ?? 'https://api.github.com';
  const runnerName = env.RUNNER_NAME ?? '';

  const missing = [
    ['GITHUB_TOKEN', token],
    ['GITHUB_REPOSITORY', repository],
    ['GITHUB_RUN_ID', runId],
  ]
    .filter(([, value]) => value === '')
    .map(([key]) => key);

  /** @type {ReturnType<typeof judge>} */
  let verdict;
  if (missing.length > 0) {
    verdict = judge([]);
    verdict.reason = `${missing.join(', ')} not set, so this run's steps could not be read`;
  } else {
    try {
      const jobs = await fetchRunJobs({ repository, runId, token, apiUrl });
      const own = pickOwnJob(jobs, runnerName);
      if (own === null) {
        verdict = judge([]);
        verdict.reason =
          `none of the ${jobs.length} job(s) in run ${runId} could be identified as this one ` +
          `(runner ${runnerName || 'unnamed'})`;
      } else {
        verdict = judge(own.steps);
      }
    } catch (err) {
      verdict = judge([]);
      verdict.reason = `the jobs API could not be read: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  console.log(renderReport(verdict));

  // The annotation surface. `notice` on purpose: a check-run that is already
  // failed keeps its conclusion, and a notice can be read neither as a pass nor
  // as a downgrade of the red.
  console.log(`::notice title=Unmeasured gate tail::${machineLine(verdict)}`);

  const summaryPath = env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      appendFileSync(summaryPath, `${renderSummary(verdict)}\n`, 'utf8');
    } catch (err) {
      console.log(`  (job summary not written: ${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // Always 0. This step runs only when the job has ALREADY failed; a non-zero
  // exit here would add a second failure annotation that points at the reporter
  // instead of at the gate, and would say nothing the job's conclusion does not
  // already say.
  process.exit(0);
}

// -- self-test --------------------------------------------------------------

/**
 * Recorded `steps[]` shapes, abbreviated from real jobs of this repo.
 *
 * `lintFailedEarly` is job 102842713265 of run 34468505490 reduced to its
 * shape: `Set up job`, then declared steps, one of which failed, then skipped
 * steps, then the reserved post block with its numbering gap.
 */
function fixtures() {
  const step = (number, name, conclusion, status = 'completed') => ({ number, name, conclusion, status });
  const lintFailedEarly = [
    step(1, INJECTED_HEAD, 'success'),
    step(2, 'Checkout repository', 'success'),
    step(3, 'Install dependencies', 'success'),
    step(4, 'Slot-lookup ratchet', 'skipped'),
    step(5, 'Docs anchors resolve to real headings', 'success'),
    step(6, 'Doc/skill authoring guard', 'failure'),
    step(7, 'Docs frontmatter parses', 'skipped'),
    step(8, 'One `<h1>` per docs page', 'skipped'),
    step(9, 'Report the unmeasured gate tail', null, 'in_progress'),
    step(332, 'Post Setup pnpm cache', 'skipped'),
    step(333, 'Post Checkout repository', 'success'),
    step(334, 'Complete job', 'success'),
  ];
  const lintFailedLast = [
    step(1, INJECTED_HEAD, 'success'),
    step(2, 'Checkout repository', 'success'),
    step(3, 'ESLint', 'success'),
    step(4, 'Duration-shaped spec keys carry their unit in the key name', 'failure'),
    step(5, 'Report the unmeasured gate tail', null, 'in_progress'),
    step(336, 'Post Checkout repository', 'success'),
    step(337, 'Complete job', 'success'),
  ];
  const green = [
    step(1, INJECTED_HEAD, 'success'),
    step(2, 'Checkout repository', 'success'),
    step(3, 'ESLint', 'success'),
    step(336, 'Post Checkout repository', 'success'),
    step(337, 'Complete job', 'success'),
  ];
  // The shape this actually runs against, and the one that produced a wrong
  // number before the rule above existed: the job is still in progress, so the
  // runner has stamped `skipped` on only the first slice of the tail and has
  // written nothing at all for the rest.
  const midRun = [
    step(1, INJECTED_HEAD, 'success'),
    step(2, 'Checkout repository', 'success'),
    step(3, 'Docs anchors resolve to real headings', 'failure'),
    step(4, 'ESLint', 'skipped'),
    step(5, 'Raw control-byte guard', 'skipped'),
    step(6, 'Slot-lookup ratchet', null, 'queued'),
    step(7, 'ADR anchors + number uniqueness', null, 'queued'),
    step(8, 'Duration-shaped spec keys carry their unit in the key name', null, 'queued'),
    step(9, 'Report how many gates never ran', null, 'in_progress'),
    step(340, 'Post Checkout repository', 'success'),
    step(341, 'Complete job', 'success'),
  ];
  return { lintFailedEarly, lintFailedLast, green, midRun };
}

function selfTest() {
  const failures = [];
  let checked = 0;
  const t = (label, actual, expected) => {
    checked++;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
  };

  const { lintFailedEarly, lintFailedLast, green, midRun } = fixtures();

  // -- the boundary: the post block is not part of the population ------------
  t('declaredRegion drops the runner head and the whole post block',
    declaredRegion(lintFailedEarly).declared.map((s) => s.name),
    ['Checkout repository', 'Install dependencies', 'Slot-lookup ratchet',
      'Docs anchors resolve to real headings', 'Doc/skill authoring guard',
      'Docs frontmatter parses', 'One `<h1>` per docs page',
      'Report the unmeasured gate tail']);
  t('the numbering gap before the post block is NOT read as truncation',
    declaredRegion(lintFailedEarly).postIndex, 9);

  // -- the three populations stay apart --------------------------------------
  const early = judge(lintFailedEarly);
  t('an early failure is measured', early.measured, true);
  t('...names the failing step', [early.failedNumber, early.failedName], [6, 'Doc/skill authoring guard']);
  t('...counts the tail behind the failure', early.neverRan,
    ['Docs frontmatter parses', 'One `<h1>` per docs page']);
  t('...keeps an `if:`-skipped step OUT of the tail', early.skippedByCondition, ['Slot-lookup ratchet']);
  t('...counts what actually ran', early.ran, 3);
  t('...never counts this reporter itself as an unmeasured gate', early.inFlight,
    ['Report the unmeasured gate tail']);

  // The point of the whole exercise: the two "skipped" populations are the same
  // word on the API surface and MUST NOT be the same number here.
  t('a deliberate skip and an unmeasured one are different numbers',
    [early.skippedByCondition.length, early.neverRan.length], [1, 2]);

  // -- mid-run: a not-yet-stamped step is part of the tail, not evidence ------
  // The regression this pins: counting `conclusion === 'skipped'` answered 12
  // on a live job whose real tail was 161, because the runner had not reached
  // the rest yet. Position decides; `conclusion` may only subtract.
  const mid = judge(midRun);
  t('a step the runner has not reached yet is counted in the tail',
    mid.neverRan,
    ['ESLint', 'Raw control-byte guard', 'Slot-lookup ratchet',
      'ADR anchors + number uniqueness',
      'Duration-shaped spec keys carry their unit in the key name']);
  t('...so the tail is the POSITION count, not the stamped-skipped count',
    [mid.neverRan.length, midRun.filter((x) => x.conclusion === 'skipped').length], [5, 2]);
  t('...and this reporter, the one step in flight, is never in it',
    [mid.inFlight, mid.neverRan.includes('Report how many gates never ran')],
    [['Report how many gates never ran'], false]);

  // -- an empty tail is a real, different answer ------------------------------
  const last = judge(lintFailedLast);
  t('a failure in the last gate reports an EMPTY tail rather than staying silent',
    [last.measured, last.neverRan.length], [true, 0]);
  t('...and says so in words', renderReport(last).includes('The tail is empty'), true);

  // -- NOT MEASURED is never rendered as zero --------------------------------
  const noFailure = judge(green);
  t('a job with no failed step is NOT MEASURED, not a tail of 0', noFailure.measured, false);
  t('...and its machine line says NOT_MEASURED rather than 0',
    machineLine(noFailure), 'unmeasured-gate-tail: measured=no never_ran=NOT_MEASURED');
  t('an empty steps array is NOT MEASURED too', judge([]).measured, false);
  t('a null steps value is NOT MEASURED too', judge(null).measured, false);

  // -- the machine-readable line ---------------------------------------------
  t('the machine line carries every count',
    machineLine(early),
    'unmeasured-gate-tail: measured=yes never_ran=2 failed=1 ran=3 skipped_by_condition=1 declared=8 failed_at_step=6');

  // -- the report never truncates the list it is about ------------------------
  const manyNames = Array.from({ length: 120 }, (_, i) => `gate ${i}`);
  const manyRendered = renderReport({ ...early, neverRan: manyNames });
  t('every un-run gate is named, with nothing elided',
    manyNames.every((n) => manyRendered.includes(`    - ${n}`)), true);

  // -- output must not mint workflow commands of its own ---------------------
  // `check:self-test-workflow-commands` reads this file's self-test output; a
  // legacy `##[` token is parsed ANYWHERE in a line and a `::` form at line
  // start, so neither may appear in anything rendered here.
  // The two tokens are BUILT rather than written, so that a failing assertion
  // here cannot print the very thing it refuses.
  const legacyToken = `${'#'.repeat(2)}[`;
  const modernToken = ':'.repeat(2);
  const renderedLines = [
    renderReport(early),
    renderReport(noFailure),
    renderSummary(early),
    renderSummary(noFailure),
  ]
    .join('\n')
    .split('\n');
  t('no rendered line carries the legacy command token, which parses anywhere in a line',
    renderedLines.some((l) => l.includes(legacyToken)), false);
  t('no rendered line starts with the modern command token, which parses at line start',
    renderedLines.some((l) => l.startsWith(modernToken)), false);

  // -- picking this job out of the run ---------------------------------------
  const jobs = [
    { name: 'Type Check', runner_name: 'GitHub Actions 1', status: 'completed', steps: [] },
    { name: 'Lint & Repo Gates', runner_name: 'GitHub Actions 2', status: 'in_progress', steps: lintFailedEarly },
  ];
  t('this job is found by runner name, with no job `name:` literal anywhere',
    pickOwnJob(jobs, 'GitHub Actions 2')?.name, 'Lint & Repo Gates');
  t('an unknown runner falls back to the single in-progress job',
    pickOwnJob(jobs, 'GitHub Actions 999')?.name, 'Lint & Repo Gates');
  t('an unidentifiable job is null, never a guess',
    pickOwnJob([jobs[0]], 'GitHub Actions 999'), null);

  if (failures.length) {
    console.error(`x report-unmeasured-gate-tail --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `+ report-unmeasured-gate-tail --self-test: ${checked} assertions over recorded jobs-API shapes ` +
      '(real judge()/renderReport() path; the two "skipped" populations, the empty tail, ' +
      'NOT MEASURED vs zero, and the no-truncation rule)',
  );
  return SELF_TEST_VERDICT;
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module -- expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
  if (selfTest() !== SELF_TEST_VERDICT) {
    console.error(
      '\nx report-unmeasured-gate-tail self-test: selfTest() returned without reaching its\n' +
        'verdict, so no success line was printed. Exiting 0 here would report a self-test\n' +
        'that never finished as a self-test that passed.\n',
    );
    process.exit(1);
  }
} else {
  await main();
}
