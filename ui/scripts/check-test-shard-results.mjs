#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-test-shard-results -- the `Test` aggregator's verdict, taken one shard
 * at a time instead of from the matrix rollup.
 *
 *   node scripts/check-test-shard-results.mjs --shards 16 --job-name 'Test'
 *   node scripts/check-test-shard-results.mjs --shards 16 --fixture <path>
 *
 * Exit: 0 = a reading was taken and every shard reported `success`
 *       2 = the reading COULD NOT BE TAKEN -- never a pass
 *       3 = BREACH: a shard is missing, or did not report `success`
 *
 * ## Why this exists (objectui#9499, director ruling letter C)
 *
 * `.github/workflows/ci.yml`'s `test` job is a matrix, and until this file the
 * repository's required-check set named its legs one by one -- `Test (shard
 * 1/4)` … `Test (shard 4/4)`. That welds the SHARD COUNT to repository
 * settings: changing 4 to 8 renames four live required contexts, every pull
 * request then blocks forever on a check that can no longer report, and every
 * queue build burns the ruleset's 60-minute status-check timeout. One
 * aggregator context instead lets the matrix width move without a settings
 * edit -- which is what objectui#9499 needed, because at four shards the job
 * had grown into its own `timeout-minutes: 20` and was being CANCELLED.
 *
 * ## ⛔ The rollup is not the reading, and that is this file's whole subject
 *
 * The obvious aggregator asserts `needs.test.result == 'success'`. That
 * expression is a single ROLLUP over every leg of the matrix, and a rollup
 * cannot distinguish "all eight ran green" from "five ran green and three were
 * SKIPPED". A shard dropped from the matrix, or given a job-level `if:` that
 * is false, would therefore leave the one required test context GREEN while a
 * fraction of the suite never ran -- the objectui#8857 / objectui#3523 shape, a
 * check reporting success having run nothing.
 *
 * So the verdict is taken from the Actions API instead: this run's own job
 * list, each expected shard found BY NAME, and each one's OWN `conclusion`
 * read. `skipped` is not `success` here, which is the acceptance the ruling
 * names.
 *
 * ## An unreadable answer is never a pass
 *
 * A missing token, a 401 or 403, any other 4xx, a truncated page: all exit 2
 * and a red context. The missing token is refused before any request is sent;
 * until objectui#13064 this line claimed that and nothing enforced it, and the
 * request simply went out without an `authorization` header.
 * ⛔ And a verdict is refused entirely over a job list that does not contain
 * the aggregator's OWN job -- the control that the reading reached this run at
 * all. `GET /actions/runs/{id}/attempts/{n}/jobs` answers 200 with an empty
 * list for a run id that does not exist, so "no shards found" is otherwise
 * indistinguishable from "every shard was removed", and the second reading is
 * exactly the breach this gate is for.
 *
 * ## A transient read is asked again, bounded and logged (objectui#13064)
 *
 * Recorded twice in one hour: pull-request run 39276047959 (attempt 1) and
 * merge-group run 39276560990 each read `…/attempts/1/jobs` as HTTP 502 once,
 * exited 2, and the second ejected an all-green merge group. A 5xx, a
 * connection that fails before any answer, and a request that outlives
 * `REQUEST_TIMEOUT_MS` are the platform not answering, not an answer, so the
 * gate's reads ask again, at most `TRANSIENT_RETRY_LIMIT` times and
 * `TRANSIENT_RETRY_WAIT_MS` apart, logging each retry. ⛔ Nothing else is
 * retried. A 4xx is an answer and exits 2 at once. A body that does not parse
 * (a page cut short mid-read) exits 2 at once: it is read outside the retry on
 * purpose. A transient answer still standing after the last retry exits 2,
 * exactly as one did before. A retry only ever produces another READING; every
 * verdict is still taken from a 200 body, so no path here passes on an
 * unread answer.
 *
 * The shapes the classifier keys on were measured on Node 22's `fetch`. A
 * connection reset before any response rejects with `TypeError: fetch failed`
 * (cause code `ECONNRESET`). A request cut by `AbortSignal.timeout` rejects
 * with a `TimeoutError`. A body cut mid-read rejects later, from `res.json()`,
 * as `TypeError: terminated`, and never reaches the classifier. Retries are
 * opt-in per call: `scripts/shard-headroom.mjs` reads `fetchRunJobs()` with
 * no options and keeps its single attempt, now bounded by the request timeout.
 *
 * ## A re-run attempt is judged with the attempts before it (objectui#13064)
 *
 * "Re-run failed jobs" starts attempt N+1 holding only the jobs it re-runs.
 * The jobs it does not re-run are copied into it LATER. Measured on run
 * 39276047959: every attempt-2 copy carries a job id above the attempt-2
 * `Test` job's, and the two skipped coverage copies a `started_at` after that
 * job had finished. So when this gate reads `attempts/{N+1}/jobs`, every shard
 * the re-run left alone is ABSENT, and the one remedy a seat has for a
 * platform red reds again as "matrix drift".
 *
 * A shard absent from the current attempt is therefore looked up in the
 * earlier attempts, latest first, and judged by the conclusion it had there.
 * Each earlier attempt is read on its own `attempts/{k}/jobs` route, so where
 * a record came from is the URL's word; a record whose own `run_attempt`
 * disagrees with that URL is refused. Read after the fact on the same run, the
 * two run-level spellings serve this less well. `?filter=all` returns every
 * attempt mixed together, attributable only by that per-job field.
 * `?filter=latest`, which is also the run-level default, returns the current
 * attempt alone, and that attempt is the problem. ⛔ A shard found in no
 * attempt stays ABSENT and red. A carried `failure`, `cancelled` or `skipped`
 * stays red. The own-job control is read from the current attempt only, and
 * nothing is carried into a reading that fails it.
 *
 * ## A present shard with NO conclusion is re-read, and only that shard (objectui#10931)
 *
 * The job list can answer a shard that has finished without its conclusion.
 * Recorded once: merge_group run 36042402511 read `Test (shard 6/8)` as
 * present with no conclusion at least 49 s after that job's `completed_at`, while
 * `needs.test.result` in the same step printed `success` and two shards that
 * completed LATER read `success`. The same endpoint now answers `success` for
 * it. Not pagination: the read printed 16 jobs, one page of 100. Not
 * `filter=latest`: this file never sends it, and the endpoint is attempt-scoped.
 * So the jobs API served one job's record stale, and a gate that counts
 * null as not-success turned that into a false red that ejected an all-green
 * merge group. Those readings are the card's, taken by hand, and nothing
 * here re-derives them.
 *
 * The repair re-reads ONLY the shards the first read found present with a
 * null conclusion, one job at a time by id, a bounded number of times
 * (`REREAD_LIMIT`, `REREAD_WAIT_MS`). ⛔ A shard that answered anything,
 * `failure`, `cancelled` and `skipped` included, is never re-read: waiting out
 * an answer is the blanket retry that would mask a real failure. ⛔ A shard
 * still without a conclusion after the last re-read is not success, exactly as
 * before. An absent shard is matrix drift, not a late answer, and is not
 * re-read either. The worst-case wait is pinned against the job's own
 * `timeout-minutes` in the test file.
 *
 * ## Staleness past that bound, when the rollup reads success (objectui#13064)
 *
 * Recorded on merge-group run 39286083342. The first read found nine shards
 * with no conclusion, three of them reading `queued`, all minutes after their
 * `completed_at`. Seven settled during the eight re-reads. Two still read
 * `in_progress` at the last one, 6 min 22 s and 4 min 35 s after their
 * `completed_at`, and the gate ejected an all-green merge group again. The
 * rollup printed in the same step read `success`. These readings are the
 * card's and the job log's, taken by hand; nothing here re-derives them.
 *
 * So the re-read gets a second, longer stretch, and only for that case. When
 * the matrix rollup (`needs.test.result`, handed in by `ci.yml` as
 * `TEST_MATRIX_ROLLUP`) reads `success`, and the only disagreement left after
 * `REREAD_LIMIT` re-reads is shards that are present without a conclusion,
 * the re-read goes on `STALE_REREAD_LIMIT` more times, `STALE_REREAD_WAIT_MS`
 * apart. ⛔ The rollup decides only whether to wait longer, never whether to
 * pass: the verdict is still every shard's OWN conclusion. A `completed_at`
 * without a conclusion is not one. Any shard that answers anything else, or is
 * absent, ends the extension at once, because there is nothing left for
 * waiting to fix.
 *
 * ## A shard the jobs API serves without a conclusion is asked of its own check run (objectui#13327)
 *
 * Recorded three times on 2026-10-22, the third ejecting an all-green merge
 * group again: run 39799233894, run 39799289611 and merge-group run
 * 39812942829 each read shards as `in_progress` or `queued`, with no
 * conclusion, through both re-read stretches and the whole of
 * `GATE_BUDGET_MS`, the single-job endpoint answering exactly as the list
 * did. The longest still had no conclusion 7 min 46 s after its own
 * `completed_at`, when the gate gave up. Outwaiting that would need a budget
 * past the job's `timeout-minutes`. These readings are the card's and the job
 * logs', taken by hand; nothing here re-derives them.
 *
 * GitHub Actions publishes every job as a check run with the job's own id
 * (the job record's `check_run_url` names it). That is a second record of the
 * same job, kept by the Checks API rather than the Actions one. So every shard
 * the jobs API serves present without a conclusion is also read on
 * `GET /check-runs/{id}`: once before any wait, and again after each re-read
 * that still finds it without one. When the check run reads `completed`, its
 * conclusion is the shard's.
 *
 * ⛔ It is that very job's OWN conclusion, never a rollup and never a guess. A
 * check run is refused unless its id, its name, its app (`github-actions`) and
 * its `html_url` are the job record's own. The id and the URL are per job and
 * per attempt: a shard re-run in attempt N is asked by attempt N's job id, so
 * the check run of the attempt before it can never stand in for it. A refused
 * check run is a reading that could not be taken (exit 2), exactly as a re-read
 * about another job is. ⛔ Only a shard with no conclusion is asked: an answer
 * the jobs API gave is never replaced, so a `failure` there stays a failure. A
 * check run that reads `failure`, `cancelled` or `skipped` is that, and red. One
 * with no conclusion either leaves the shard to the re-reads above, unchanged.
 * An absent shard is not asked: drift is not lateness. A check run that cannot
 * be read is a request like any other here: a 4xx is exit 2 at once, a 5xx is
 * retried and then exit 2.
 *
 * ## That second reader is exercised on every run, not only in the lag it is for
 *
 * A read taken only while the jobs API lags would be a path no green run ever
 * walks: a lost permission or a moved route would surface only in the next
 * platform lag, as a red nobody can act on. So every run also reads THIS job's
 * own check run once, before judging, and refuses it on the same four keys. ⛔
 * Nothing is judged from it. Whether this job's token may read check runs is
 * deliberately not written here: this read re-derives it on every run, and a
 * red is its answer.
 *
 * ## One budget for the whole gate
 *
 * Every wait above (a retry, a re-read) starts only if it and one more full
 * request fit before `GATE_BUDGET_MS` from the gate's start, and each
 * request's timeout is cut to what is left. So the step cannot outlive its
 * job. A gate killed by `timeout-minutes` reports `cancelled`, which the queue
 * reads exactly as it reads a red, while explaining less. The test file pins
 * the budget, the two re-read stretches and the recorded staleness against the
 * job's `timeout-minutes`.
 *
 * ## The shard COUNT is passed in, and pinned against the matrix
 *
 * `--shards` is the one number this file does not derive. Deriving it from the
 * workflow would mean a second YAML parser answering a question
 * `scripts/__tests__/workflow-checks.ts` already answers; instead
 * `scripts/__tests__/check-test-shard-results.test.ts` pins the argument
 * written in `ci.yml` against that same file's `shard: [...]` matrix, so the
 * two declarations cannot drift apart silently.
 */

import fs from 'node:fs';

import { isEntrypoint } from './invoked-as.mjs';

export const EXIT_OK = 0;
export const EXIT_CANNOT_RUN = 2;
export const EXIT_BREACHED = 3;

/** Verdicts, in the order they are decided. */
export const VERDICTS = Object.freeze(['unreadable', 'breached', 'intact']);

/**
 * The re-read bound for a present shard answered without a conclusion. The
 * worst case waits `REREAD_LIMIT * REREAD_WAIT_MS` before such a shard counts
 * as not-success, and the test file pins that product inside the
 * `test-aggregate` job's `timeout-minutes`.
 */
export const REREAD_LIMIT = 8;
export const REREAD_WAIT_MS = 15_000;

/**
 * The second, longer re-read stretch, taken only when the rollup reads
 * `success` and the only disagreement is shards without a conclusion. The two
 * stretches together must outlast the 6 min 22 s recorded on run 39286083342,
 * even for a shard that completed the moment this gate started, and must
 * still fit inside `GATE_BUDGET_MS`. The test file pins both directions.
 */
export const STALE_REREAD_LIMIT = 9;
export const STALE_REREAD_WAIT_MS = 30_000;

/**
 * A transient read (a 5xx, a connection that fails before any answer, a
 * request past `REQUEST_TIMEOUT_MS`) is asked again at most this many times,
 * this far apart.
 */
export const TRANSIENT_RETRY_LIMIT = 3;
export const TRANSIENT_RETRY_WAIT_MS = 10_000;

/** One request's own bound; a request that outlives it counts as a transient failure. */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * The whole gate's wall-clock bound, from its start. No retry or re-read starts
 * unless it and one more full request fit inside it. The test file pins it,
 * plus the following report-only step's one request, inside the
 * `test-aggregate` job's `timeout-minutes` with room for the checkout.
 */
export const GATE_BUDGET_MS = 450_000;

/** The app whose check runs are Actions jobs. A check run any other app posted is not a job's. */
export const ACTIONS_CHECK_RUN_APP = 'github-actions';

/**
 * The check-run names the `test` matrix produces at a given width.
 *
 * One spelling of `Test (shard N/M)` lives here and one lives in `ci.yml`'s
 * `name:`; the test file pins them against each other.
 *
 * @param {number} shards
 * @returns {string[]}
 */
export function shardContexts(shards) {
  if (!Number.isInteger(shards) || shards < 1) {
    throw new Error(`--shards must be a positive integer, got ${JSON.stringify(shards)}`);
  }
  return Array.from({ length: shards }, (_, i) => `Test (shard ${i + 1}/${shards})`);
}

/**
 * The job names in an answer, read the way `evaluate` reads them: a job whose
 * `name` is not a string is not seen.
 *
 * @param {unknown[]} jobs
 */
function namesIn(jobs) {
  const names = new Set();
  for (const job of jobs) {
    const name = job && typeof job === 'object' ? /** @type {{ name?: unknown }} */ (job).name : undefined;
    if (typeof name === 'string') names.add(name);
  }
  return names;
}

/**
 * The expected shard names an answer does not hold.
 *
 * @param {unknown[]} jobs
 * @param {number} shards
 */
export function absentShards(jobs, shards) {
  const names = namesIn(jobs);
  return shardContexts(shards).filter((name) => !names.has(name));
}

/**
 * Add to `jobs` each expected shard it does not hold that the earlier attempt
 * `from` does. Pure. Where the record came from is the attempt whose route it
 * was read on; a record whose own `run_attempt` names another attempt is not
 * about that attempt, and is refused rather than carried. The current
 * attempt's records are never replaced: a shard it re-ran is judged by its
 * re-run.
 *
 * @param {{ jobs: unknown[], from: { attempt: number, jobs: unknown }, shards: number }} input
 * @returns {unknown[]}
 */
export function carryForward({ jobs, from, shards }) {
  if (!Array.isArray(from.jobs)) {
    throw new Error(`attempt ${from.attempt}'s jobs endpoint answered ${typeof from.jobs}, not an array of jobs`);
  }
  const earlier = /** @type {unknown[]} */ (from.jobs);
  /** @type {unknown[]} */
  const carried = [];
  for (const name of absentShards(jobs, shards)) {
    const record = earlier.find((job) => job && typeof job === 'object' && /** @type {{ name?: unknown }} */ (job).name === name);
    if (!record) continue;
    const said = /** @type {{ run_attempt?: unknown }} */ (record).run_attempt;
    if (said !== undefined && said !== from.attempt) {
      throw new Error(`attempt ${from.attempt}'s job list answered ${name} as attempt ${JSON.stringify(said)}, which is not that attempt`);
    }
    carried.push({ .../** @type {object} */ (record), run_attempt: from.attempt });
  }
  return [...jobs, ...carried];
}

/**
 * Judge one reading. Pure: no clock, no network, no process exit.
 *
 * `attempt` is the run attempt the gate is running in, when it knows it; a
 * shard whose record names an earlier attempt was carried from there by
 * `carryForward`, and the log line says so. No verdict reads it.
 *
 * @param {{ jobs: unknown, shards: number, selfJobName: string, attempt?: number|null }} input
 */
export function evaluate({ jobs, shards, selfJobName, attempt = null }) {
  if (!Array.isArray(jobs)) {
    throw new Error(`the jobs endpoint answered ${typeof jobs}, not an array of jobs`);
  }
  if (!selfJobName) {
    throw new Error('selfJobName is required: it is the control that the reading reached this run');
  }

  /** @type {Map<string, { conclusion: string|null, status: string|null, jobId: number|null, attempt: number|null, fromCheckRun: boolean }>} */
  const byName = new Map();
  for (const job of jobs) {
    if (!job || typeof job !== 'object') continue;
    const { name, conclusion, status, id, run_attempt: runAttempt, conclusion_from: conclusionFrom } =
      /** @type {{ name?: unknown, conclusion?: unknown, status?: unknown, id?: unknown, run_attempt?: unknown, conclusion_from?: unknown }} */ (job);
    // ⛔ Never fall back to a neighbouring field. A job whose `name` this
    // cannot read is a job this gate did not see, and counting it as seen is
    // how a membership test goes vacuous.
    if (typeof name !== 'string') continue;
    byName.set(name, {
      conclusion: typeof conclusion === 'string' ? conclusion : null,
      // Carried for the re-read and its log line only; no verdict reads them.
      status: typeof status === 'string' ? status : null,
      jobId: typeof id === 'number' ? id : null,
      attempt: typeof runAttempt === 'number' ? runAttempt : null,
      fromCheckRun: conclusionFrom === 'check-run',
    });
  }

  const expected = shardContexts(shards);
  const observed = expected.map((name) => {
    const seen = byName.get(name);
    const from = seen?.attempt ?? null;
    return {
      name,
      present: seen !== undefined,
      conclusion: seen?.conclusion ?? null,
      status: seen?.status ?? null,
      jobId: seen?.jobId ?? null,
      carriedFrom: attempt !== null && from !== null && from < attempt ? from : null,
      fromCheckRun: seen?.fromCheckRun ?? false,
    };
  });
  const missing = observed.filter((s) => !s.present).map((s) => s.name);
  const notSuccess = observed.filter((s) => s.present && s.conclusion !== 'success').map((s) => `${s.name} (${s.conclusion ?? 'no conclusion'})`);

  const selfSeen = byName.has(selfJobName);
  const verdict = !selfSeen ? 'unreadable' : missing.length > 0 || notSuccess.length > 0 ? 'breached' : 'intact';

  const reading = { verdict, shards, selfJobName, selfSeen, attempt, jobCount: byName.size, observed, missing, notSuccess };
  assertGrounded(reading);
  return reading;
}

/**
 * Refuse a verdict the reading underneath it does not support. The direction
 * that matters is `intact`: a clean verdict over a job list this gate could not
 * find itself in is the silent pass it exists to make impossible.
 *
 * @param {ReturnType<typeof evaluate>} reading
 */
export function assertGrounded(reading) {
  if (!VERDICTS.includes(reading.verdict)) {
    throw new Error(`ungrounded: unknown verdict ${JSON.stringify(reading.verdict)}`);
  }
  if (reading.verdict === 'intact') {
    if (!reading.selfSeen) throw new Error('ungrounded: an intact verdict over a job list this job is not in');
    if (reading.observed.length === 0) throw new Error('ungrounded: an intact verdict over zero shards');
    if (reading.missing.length > 0 || reading.notSuccess.length > 0) {
      throw new Error('ungrounded: an intact verdict with a shard missing or not green');
    }
  }
  if (reading.verdict === 'breached' && reading.missing.length === 0 && reading.notSuccess.length === 0) {
    throw new Error('ungrounded: a breach with nothing missing and nothing red');
  }
}

/** @param {ReturnType<typeof evaluate>} reading */
export function exitCodeFor(reading) {
  if (reading.verdict === 'intact') return EXIT_OK;
  if (reading.verdict === 'unreadable') return EXIT_CANNOT_RUN;
  return EXIT_BREACHED;
}

/**
 * The shards a re-read is for: present in the job list, with no conclusion.
 * Only these. A shard that answered has answered, whatever it said; an absent
 * shard is drift, not lateness; and a reading that is not about this run
 * (`unreadable`) has nothing in it to re-read.
 *
 * @param {ReturnType<typeof evaluate>} reading
 */
export function unconcludedShards(reading) {
  if (reading.verdict === 'unreadable') return [];
  return reading.observed.filter((s) => s.present && s.conclusion === null);
}

/**
 * Whether the only thing between this reading and `intact` is shards that are
 * present without a conclusion: nothing absent, nothing that answered anything
 * but `success`. The one case the stale-API extension is for.
 *
 * @param {ReturnType<typeof evaluate>} reading
 */
export function onlyUnconcluded(reading) {
  return (
    reading.verdict === 'breached' &&
    reading.missing.length === 0 &&
    reading.observed.every((s) => s.conclusion === 'success' || s.conclusion === null)
  );
}

/**
 * Refuse a check run that is not this job record's own: its id, its name, its
 * app and its `html_url` must all be the record's. The id and the URL are per
 * job and so per attempt, which is what keeps an earlier attempt's check run
 * from standing in for a re-run shard. Throws; a record without an
 * `html_url` to compare against is refused too, never waved through.
 *
 * @param {unknown} job the jobs-API record the check run was read for
 * @param {unknown} checkRun the answer of `GET /check-runs/{id}`
 */
export function assertOwnCheckRun(job, checkRun) {
  const record = /** @type {{ id?: unknown, name?: unknown, html_url?: unknown }} */ (job && typeof job === 'object' ? job : {});
  const answer = /** @type {{ id?: unknown, name?: unknown, html_url?: unknown, app?: unknown }} */ (
    checkRun && typeof checkRun === 'object' ? checkRun : {}
  );
  const app = answer.app && typeof answer.app === 'object' ? /** @type {{ slug?: unknown }} */ (answer.app).slug : undefined;
  const own =
    typeof record.html_url === 'string' &&
    answer.id === record.id &&
    answer.name === record.name &&
    app === ACTIONS_CHECK_RUN_APP &&
    answer.html_url === record.html_url;
  if (!own) {
    throw new Error(
      `the check run read for job ${String(record.id)} (${String(record.name)}) answered ` +
        `${JSON.stringify({ id: answer.id, name: answer.name, app, html_url: answer.html_url })}, which is not that job's own`,
    );
  }
}

/**
 * A job record the jobs API served without a conclusion, concluded by its own
 * check run when that has one. Pure. The record comes back unchanged when the
 * check run has no conclusion either, and when the record already has one: an
 * answer the jobs API gave is never replaced. A check run that is not the
 * record's own throws (`assertOwnCheckRun`).
 *
 * @param {unknown} job
 * @param {unknown} checkRun
 * @returns {unknown}
 */
export function concludeFromCheckRun(job, checkRun) {
  assertOwnCheckRun(job, checkRun);
  if (typeof /** @type {{ conclusion?: unknown }} */ (job).conclusion === 'string') return job;
  const { status, conclusion } = /** @type {{ status?: unknown, conclusion?: unknown }} */ (checkRun);
  if (status !== 'completed' || typeof conclusion !== 'string') return job;
  return { .../** @type {object} */ (job), status, conclusion, conclusion_from: 'check-run' };
}

/**
 * The record with the given id in a job list, or `undefined`.
 *
 * @param {unknown[]} jobs
 * @param {number} id
 */
const recordWithId = (jobs, id) => jobs.find((job) => job && typeof job === 'object' && /** @type {{ id?: unknown }} */ (job).id === id);

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Judge the first answer, then re-read ONLY the shards it found present with
 * no conclusion, each by its job id, at most `limit` times and `waitMs` apart.
 * Every other shard keeps the conclusion the first read gave it. The verdict
 * is `evaluate`'s over the patched list, so a shard still null after the last
 * re-read is judged exactly as a null shard always was: not success.
 *
 * Past `limit`, and only while `rollup` is `success` and `onlyUnconcluded`
 * holds, the re-read goes on up to `staleLimit` more times, `staleWaitMs`
 * apart. Every re-read starts only if its wait and one more full request
 * (`requestTimeoutMs`) fit before `deadline`.
 *
 * With `readCheckRun`, every shard still present without a conclusion is
 * also asked of its own check run (`concludeFromCheckRun`): once before the
 * first wait, and again after each re-read. Like a re-read, that read starts
 * only if one more full request fits before `deadline`.
 *
 * A re-read or a check run that answers about a different job, or a shard
 * with no id to read it by, throws: the caller reports that as a reading that
 * could not be taken, never as a pass.
 *
 * @param {{
 *   jobs: unknown,
 *   shards: number,
 *   selfJobName: string,
 *   rereadJob: (jobId: number) => Promise<unknown>,
 *   readCheckRun?: ((jobId: number) => Promise<unknown>)|null,
 *   attempt?: number|null,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   now?: () => number,
 *   deadline?: number,
 *   log?: (line: string) => void,
 *   limit?: number,
 *   waitMs?: number,
 *   rollup?: string|null,
 *   staleLimit?: number,
 *   staleWaitMs?: number,
 *   requestTimeoutMs?: number,
 * }} input
 */
export async function settleReading({
  jobs,
  shards,
  selfJobName,
  rereadJob,
  readCheckRun = null,
  attempt = null,
  sleep = defaultSleep,
  now = Date.now,
  deadline,
  log = () => {},
  limit = REREAD_LIMIT,
  waitMs = REREAD_WAIT_MS,
  rollup = null,
  staleLimit = STALE_REREAD_LIMIT,
  staleWaitMs = STALE_REREAD_WAIT_MS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const end = deadline ?? now() + GATE_BUDGET_MS;
  let reading = evaluate({ jobs, shards, selfJobName, attempt });
  let current = /** @type {unknown[]} */ (jobs);
  let rereads = 0;
  let stale = 0;
  let checkRunReads = 0;
  let budgetSpent = false;

  /** Ask every shard still present without a conclusion of its own check run, and judge the list again. */
  const askCheckRuns = async () => {
    const pending = unconcludedShards(reading);
    if (!readCheckRun || pending.length === 0) return;
    if (now() + requestTimeoutMs > end) {
      budgetSpent = true;
      log("not asking the check runs: one more request would run past the gate's budget");
      return;
    }
    /** @type {Map<number, unknown>} */
    const concluded = new Map();
    for (const shard of pending) {
      if (shard.jobId === null) throw new Error(`${shard.name} has no job id to read its check run by`);
      const record = recordWithId(current, shard.jobId);
      checkRunReads += 1;
      const answer = concludeFromCheckRun(record, await readCheckRun(shard.jobId));
      if (answer === record) continue;
      concluded.set(shard.jobId, answer);
      log(
        `${shard.name} (job ${shard.jobId}): the jobs API serves no conclusion (status ${shard.status ?? 'unknown'}); ` +
          `its own check run reads ${/** @type {{ conclusion: string }} */ (answer).conclusion}`,
      );
    }
    if (concluded.size === 0) return;
    current = current.map((job) => {
      const id = job && typeof job === 'object' ? /** @type {{ id?: unknown }} */ (job).id : undefined;
      return typeof id === 'number' && concluded.has(id) ? concluded.get(id) : job;
    });
    reading = evaluate({ jobs: current, shards, selfJobName, attempt });
  };

  await askCheckRuns();
  for (let pending = unconcludedShards(reading); pending.length > 0; pending = unconcludedShards(reading)) {
    const base = rereads < limit;
    const extend = !base && stale < staleLimit && rollup === 'success' && onlyUnconcluded(reading);
    if (!base && !extend) break;
    const wait = base ? waitMs : staleWaitMs;
    if (now() + wait + requestTimeoutMs > end) {
      budgetSpent = true;
      log(`not re-reading again: another ${wait / 1000}s wait and one more request would run past the gate's budget`);
      break;
    }
    rereads += 1;
    const which = pending.map((s) => `${s.name} (job ${s.jobId ?? 'without an id'}, status ${s.status ?? 'unknown'})`).join(', ');
    if (base) {
      log(`re-read ${rereads}/${limit} in ${waitMs / 1000}s, only the shard(s) with no conclusion yet: ${which}`);
    } else {
      stale += 1;
      log(
        `re-read ${rereads} (past the ${limit}-re-read bound, ${stale}/${staleLimit}) in ${staleWaitMs / 1000}s: ` +
          `needs.test.result reads success and the only disagreement is shard(s) the jobs API still serves without a conclusion: ${which}`,
      );
    }
    await sleep(wait);

    /** @type {Map<number, unknown>} */
    const fresh = new Map();
    for (const shard of pending) {
      if (shard.jobId === null) throw new Error(`${shard.name} has no job id to re-read it by`);
      const answer = await rereadJob(shard.jobId);
      const { id, name } = /** @type {{ id?: unknown, name?: unknown }} */ (answer && typeof answer === 'object' ? answer : {});
      if (id !== shard.jobId || name !== shard.name) {
        throw new Error(
          `re-reading job ${shard.jobId} (${shard.name}) answered ${JSON.stringify({ id, name })}, which is not that job`,
        );
      }
      fresh.set(shard.jobId, answer);
    }
    current = current.map((job) => {
      const id = job && typeof job === 'object' ? /** @type {{ id?: unknown }} */ (job).id : undefined;
      if (typeof id !== 'number' || !fresh.has(id)) return job;
      // A carried record keeps the attempt it was carried from: the single-job
      // answer is about the same job, and that job belongs to that attempt.
      const said = /** @type {{ run_attempt?: unknown }} */ (job).run_attempt;
      const answer = /** @type {object} */ (fresh.get(id));
      return said === undefined ? answer : { run_attempt: said, ...answer };
    });
    reading = evaluate({ jobs: current, shards, selfJobName, attempt });
    await askCheckRuns();
  }
  return { reading, rereads, stale, budgetSpent, checkRunReads };
}

/**
 * The lines a reading prints. Every shard is named with its own conclusion,
 * green or not: a verdict nobody can check against the run it judges is the
 * thing that sends a reader to the jobs API by hand.
 *
 * @param {ReturnType<typeof evaluate>} reading
 * @param {number} [rereads] how many re-reads `settleReading` took before this reading
 * @param {{ stale?: number, budgetSpent?: boolean }} [settled] how many of them were past the first bound, and whether the budget ended them
 */
export function renderReading(reading, rereads = 0, { stale = 0, budgetSpent = false } = {}) {
  const carried = reading.observed.filter((s) => s.carriedFrom !== null).length;
  const lines = [
    carried > 0
      ? `read ${reading.jobCount - carried} job(s) from attempt ${reading.attempt} of this run, and ${carried} shard(s) ` +
        `it did not re-run from the attempt(s) before it; expecting ${reading.shards} test shard(s)`
      : `read ${reading.jobCount} job(s) from ${reading.attempt !== null && reading.attempt > 1 ? `attempt ${reading.attempt} of ` : ''}this run; ` +
        `expecting ${reading.shards} test shard(s)`,
  ];
  for (const shard of reading.observed) {
    const answer = shard.conclusion ?? `no conclusion (status ${shard.status ?? 'unknown'})`;
    const from = shard.carriedFrom !== null ? `  (attempt ${shard.carriedFrom}; not re-run in attempt ${reading.attempt})` : '';
    const source = shard.fromCheckRun ? '  (from its own check run; the jobs API served no conclusion)' : '';
    lines.push(`  ${shard.present ? answer : 'ABSENT'}  ${shard.name}${from}${source}`);
  }
  if (rereads > 0) {
    const still = unconcludedShards(reading).map((s) => s.name);
    const extended = stale > 0 ? ` (${stale} of them past the first bound, because needs.test.result read success)` : '';
    const ended = budgetSpent ? '; the gate budget ended the re-reads' : '';
    lines.push(`re-read ${rereads} time(s)${extended}${ended}; still without a conclusion: ${still.length > 0 ? still.join(', ') : 'none'}`);
  }
  if (reading.verdict === 'unreadable') {
    lines.push(
      `::error title=Test::could not take a reading -- this run's job list does not contain ` +
        `'${reading.selfJobName}', so the answer is not about this run. Refusing to report a verdict.`,
    );
  }
  if (reading.missing.length > 0) {
    const where = reading.attempt !== null && reading.attempt > 1 ? ` in attempt ${reading.attempt} or any attempt before it` : '';
    lines.push(
      `::error title=Test::${reading.missing.length} test shard(s) produced no job at all${where}: ` +
        `${reading.missing.join(', ')}. The matrix in ci.yml and the --shards argument to this ` +
        `gate have come apart; a shard nobody ran is a quarter of the suite nothing judged.`,
    );
  }
  if (reading.notSuccess.length > 0) {
    lines.push(
      `::error title=Test::${reading.notSuccess.length} test shard(s) did not report success: ` +
        `${reading.notSuccess.join(', ')}. ⛔ 'skipped' is not a pass here -- that is the whole ` +
        `reason this gate reads each shard instead of the matrix rollup (objectui#9499).`,
    );
  }
  if (reading.verdict === 'intact') lines.push(`all ${reading.shards} shards reported success`);
  return lines.join('\n');
}

/**
 * How a read reaches the API, and how hard it tries. Every field is optional;
 * the defaults are one attempt per request, bounded by `REQUEST_TIMEOUT_MS`,
 * with no deadline beyond that.
 *
 * @typedef {{
 *   token?: string,
 *   apiUrl?: string,
 *   repository?: string,
 *   fetchImpl?: typeof fetch,
 *   retries?: number,
 *   retryWaitMs?: number,
 *   timeoutMs?: number,
 *   deadline?: number,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   log?: (line: string) => void,
 * }} ReadOptions
 */

/**
 * Every job of one workflow run ATTEMPT. The attempt is named explicitly: a
 * re-run creates a second attempt, and the run-level endpoint answers with the
 * jobs of the latest one, which on a re-run of a subset is not the set this
 * job is a member of.
 *
 * @param {ReadOptions & { runId?: string, attempt?: string }} [input]
 */
export async function fetchRunJobs({
  token = process.env.GITHUB_TOKEN ?? '',
  apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com',
  repository = process.env.GITHUB_REPOSITORY ?? '',
  runId = process.env.GITHUB_RUN_ID ?? '',
  attempt = process.env.GITHUB_RUN_ATTEMPT ?? '1',
  fetchImpl = globalThis.fetch,
  ...transport
} = {}) {
  if (!repository) throw new Error('GITHUB_REPOSITORY is not set');
  if (!runId) throw new Error('GITHUB_RUN_ID is not set');

  /** @type {Array<object>} */
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const route = `/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`;
    const body = await apiGet(route, { ...transport, token, apiUrl, fetchImpl });
    const jobs = body?.jobs ?? [];
    all.push(...jobs);
    if (jobs.length < 100) break;
  }
  return all;
}

/**
 * This run's jobs as the gate judges them: the current attempt's list, plus,
 * on a re-run attempt, each expected shard the current attempt does not hold,
 * taken from the LATEST earlier attempt that does (`carryForward`). Earlier
 * attempts are read only while a shard is still absent, latest first, and not
 * at all when the current attempt's list does not contain `selfJobName`: a
 * reading that is not about this run gets nothing carried into it.
 *
 * @param {ReadOptions & { runId?: string, attempt?: string, shards: number, selfJobName: string }} input
 */
export async function readRunJobs({ shards, selfJobName, attempt = process.env.GITHUB_RUN_ATTEMPT ?? '1', ...read }) {
  const current = Number(attempt);
  if (!Number.isInteger(current) || current < 1) {
    throw new Error(`GITHUB_RUN_ATTEMPT must be a positive integer, got ${JSON.stringify(attempt)}`);
  }
  /** @type {unknown[]} */
  let jobs = await fetchRunJobs({ ...read, attempt: String(current) });
  /** @type {number[]} */
  const consulted = [];
  if (namesIn(jobs).has(selfJobName)) {
    for (let k = current - 1; k >= 1 && absentShards(jobs, shards).length > 0; k -= 1) {
      jobs = carryForward({ jobs, from: { attempt: k, jobs: await fetchRunJobs({ ...read, attempt: String(k) }) }, shards });
      consulted.push(k);
    }
  }
  return { attempt: current, jobs, consulted };
}

/**
 * One job, by id: the re-read `settleReading` takes of a shard the job list
 * answered without a conclusion. By id, not by name, so the answer is about
 * the very job the first read saw.
 *
 * @param {number} jobId
 * @param {ReadOptions} [input]
 */
export async function fetchJob(
  jobId,
  {
    token = process.env.GITHUB_TOKEN ?? '',
    apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com',
    repository = process.env.GITHUB_REPOSITORY ?? '',
    fetchImpl = globalThis.fetch,
    ...transport
  } = {},
) {
  if (!repository) throw new Error('GITHUB_REPOSITORY is not set');
  return apiGet(`/repos/${repository}/actions/jobs/${jobId}`, { ...transport, token, apiUrl, fetchImpl });
}

/**
 * One job's own check run, by the job's id: the second record of a shard the
 * jobs API serves without a conclusion, and of this job itself
 * (`confirmCheckRunReader`). The caller refuses an answer that is not the
 * job's own (`assertOwnCheckRun`).
 *
 * @param {number} jobId
 * @param {ReadOptions} [input]
 */
export async function fetchCheckRun(
  jobId,
  {
    token = process.env.GITHUB_TOKEN ?? '',
    apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com',
    repository = process.env.GITHUB_REPOSITORY ?? '',
    fetchImpl = globalThis.fetch,
    ...transport
  } = {},
) {
  if (!repository) throw new Error('GITHUB_REPOSITORY is not set');
  return apiGet(`/repos/${repository}/check-runs/${jobId}`, { ...transport, token, apiUrl, fetchImpl });
}

/**
 * Read THIS job's own check run once and refuse it unless it is this job's
 * own, so the second reader is walked on every run and not only in the lag it
 * is for. ⛔ Nothing is judged from the answer. A job list without this job is
 * left alone: `evaluate` reports that reading as `unreadable`, and nothing
 * here would add to it.
 *
 * @param {{ jobs: unknown, selfJobName: string, readCheckRun: (jobId: number) => Promise<unknown> }} input
 * @returns {Promise<string|null>} the line to log, or `null` when there was no own job to read
 */
export async function confirmCheckRunReader({ jobs, selfJobName, readCheckRun }) {
  if (!Array.isArray(jobs)) return null;
  const own = /** @type {{ id?: unknown }|undefined} */ (
    jobs.find((job) => job && typeof job === 'object' && /** @type {{ name?: unknown }} */ (job).name === selfJobName)
  );
  if (!own) return null;
  if (typeof own.id !== 'number') throw new Error(`'${selfJobName}' has no job id to read its check run by`);
  const answer = await readCheckRun(own.id);
  assertOwnCheckRun(own, answer);
  const { status } = /** @type {{ status?: unknown }} */ (answer);
  return `read this job's own check run (job ${own.id}, status ${String(status)}): the check-run reader answers`;
}

/**
 * Why a request got no answer, when the reason is the platform's and asking
 * again is sound; `null` for anything else, which the caller rethrows. The
 * shapes are the ones the header records as measured on Node 22's `fetch`.
 *
 * @param {unknown} error
 * @returns {string|null}
 */
export function transientFailure(error) {
  if (!error || typeof error !== 'object') return null;
  const { name, message, cause } = /** @type {{ name?: unknown, message?: unknown, cause?: unknown }} */ (error);
  if (name === 'TimeoutError') return 'no answer within the request timeout';
  if (error instanceof TypeError && message === 'fetch failed') {
    const code = cause && typeof cause === 'object' ? /** @type {{ code?: unknown }} */ (cause).code : undefined;
    return `the connection failed before any answer${typeof code === 'string' ? ` (${code})` : ''}`;
  }
  return null;
}

/**
 * A 5xx is the platform failing to answer. Every other status is an answer.
 *
 * @param {number} status
 */
export const isTransientStatus = (status) => status >= 500 && status <= 599;

/**
 * One GET, asked again on a transient failure at most `retries` times. The
 * body is parsed OUTSIDE the retry: a page cut short is an answer that could
 * not be read, and it is never asked again.
 *
 * @param {string} route
 * @param {ReadOptions & { token: string, apiUrl: string, fetchImpl: typeof fetch }} input
 */
async function apiGet(
  route,
  {
    token,
    apiUrl,
    fetchImpl,
    retries = 0,
    retryWaitMs = TRANSIENT_RETRY_WAIT_MS,
    timeoutMs = REQUEST_TIMEOUT_MS,
    deadline = Number.POSITIVE_INFINITY,
    now = Date.now,
    sleep = defaultSleep,
    log = () => {},
  },
) {
  for (let retry = 0; ; retry += 1) {
    const left = deadline - now();
    if (left <= 0) throw new Error(`GET ${route}: the gate's budget was spent before this request`);
    /** @type {Response|undefined} */
    let res;
    /** @type {string} */
    let failure;
    try {
      res = await fetchImpl(`${apiUrl}${route}`, {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(Math.min(timeoutMs, left)),
      });
    } catch (error) {
      const why = transientFailure(error);
      if (why === null) throw error;
      failure = why;
    }
    if (res) {
      if (res.ok) return res.json();
      if (!isTransientStatus(res.status)) throw new Error(`GET ${route} -> HTTP ${res.status}`);
      failure = `HTTP ${res.status}`;
    }
    if (retry >= retries) {
      throw new Error(`GET ${route} -> ${failure}${retries > 0 ? `, still after ${retries} retries` : ''}`);
    }
    if (now() + retryWaitMs + timeoutMs > deadline) {
      throw new Error(`GET ${route} -> ${failure}; no further retry fits the gate's budget`);
    }
    log(`transient answer to GET ${route}: ${failure}; retry ${retry + 1}/${retries} in ${retryWaitMs / 1000}s`);
    await sleep(retryWaitMs);
  }
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const shards = Number(at('--shards'));
  return { shards, jobName: at('--job-name') ?? 'Test', fixture: at('--fixture') };
}

/**
 * The whole gate, with everything it touches handed in: the environment, the
 * network, the clock and the two output streams. `main` is this over the real
 * ones; the test file drives it over scripted ones, so the pins exercise the
 * same composition CI runs.
 *
 * @param {string[]} argv
 * @param {{
 *   env?: Record<string, string|undefined>,
 *   fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   now?: () => number,
 *   out?: (line: string) => void,
 *   err?: (line: string) => void,
 * }} [deps]
 */
export async function run(
  argv,
  {
    env = process.env,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    now = Date.now,
    out = (line) => console.log(line),
    err = (line) => console.error(line),
  } = {},
) {
  const { shards, jobName, fixture } = parseArgs(argv);
  if (!Number.isInteger(shards) || shards < 1) {
    err('usage: node scripts/check-test-shard-results.mjs --shards <n> [--job-name <name>] [--fixture <path>]');
    return EXIT_CANNOT_RUN;
  }

  const deadline = now() + GATE_BUDGET_MS;
  /** @type {ReadOptions & { token: string }} */
  const read = {
    token: env.GITHUB_TOKEN ?? '',
    apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com',
    repository: env.GITHUB_REPOSITORY ?? '',
    fetchImpl,
    retries: TRANSIENT_RETRY_LIMIT,
    deadline,
    now,
    sleep,
    log: out,
  };

  /** @type {unknown} */
  let jobs;
  /** @type {number|null} */
  let attempt = null;
  try {
    if (fixture) {
      jobs = JSON.parse(fs.readFileSync(fixture, 'utf8')).jobs;
    } else {
      if (!read.token) throw new Error('GITHUB_TOKEN is not set');
      ({ jobs, attempt } = await readRunJobs({
        ...read,
        runId: env.GITHUB_RUN_ID ?? '',
        attempt: env.GITHUB_RUN_ATTEMPT ?? '1',
        shards,
        selfJobName: jobName,
      }));
    }
  } catch (error) {
    err(`::error title=Test::could not read this run's job list: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_CANNOT_RUN;
  }

  // A fixture is one recorded answer, with no check runs behind it.
  const readCheckRun = fixture ? null : (/** @type {number} */ jobId) => fetchCheckRun(jobId, read);
  if (readCheckRun) {
    try {
      const line = await confirmCheckRunReader({ jobs, selfJobName: jobName, readCheckRun });
      if (line) out(line);
    } catch (error) {
      err(
        `::error title=Test::could not read this job's own check run, the second record a shard the jobs API serves ` +
          `without a conclusion is asked of: ${error instanceof Error ? error.message : String(error)}`,
      );
      return EXIT_CANNOT_RUN;
    }
  }

  /** @type {Awaited<ReturnType<typeof settleReading>>} */
  let settled;
  try {
    settled = await settleReading({
      jobs,
      shards,
      selfJobName: jobName,
      attempt,
      rereadJob: (jobId) => fetchJob(jobId, read),
      readCheckRun,
      // A fixture is one recorded answer; there is no later answer to re-read.
      limit: fixture ? 0 : REREAD_LIMIT,
      staleLimit: fixture ? 0 : STALE_REREAD_LIMIT,
      // ⛔ Read to decide whether to WAIT longer, never whether to pass.
      rollup: env.TEST_MATRIX_ROLLUP ?? null,
      sleep,
      now,
      deadline,
      log: out,
    });
  } catch (error) {
    err(`::error title=Test::could not finish reading this run's job list: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_CANNOT_RUN;
  }

  out(renderReading(settled.reading, settled.rereads, settled));
  return exitCodeFor(settled.reading);
}

/** @param {string[]} argv */
export async function main(argv) {
  return run(argv);
}

if (isEntrypoint(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
