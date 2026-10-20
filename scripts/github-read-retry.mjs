// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * github-read-retry -- ONE retry policy for a read of the GitHub REST API,
 * shared by every instrument that refuses when GitHub cannot be read.
 *
 * Two consumers, each measured red on a single transient answer before it
 * took this policy:
 *
 *   scripts/check-issue-citations.mjs   every board read (#23361): one HTTP
 *                                       500 ejected a PR from the merge queue.
 *   scripts/ci/scheduled-full-run.mjs   `readRuns`, the release gate's listing
 *                                       of full-battery runs (#24741): one HTTP
 *                                       502 on `lint.yml`'s `schedule` listing
 *                                       refused a publish as NOT MEASURED
 *                                       (release run 39230668843), and the
 *                                       version shipped only after a manual
 *                                       re-run and a second `release` approval.
 *
 * The policy was written for the first consumer, so its docblock below still
 * speaks in that gate's words ("board", "lint lane", exit 3). What carries
 * over unchanged is the rule: a 5xx or a named connection failure is retried
 * inside a per-read ladder and a per-RUN budget, and everything else is an
 * answer. A consumer creates ONE `boardReadBudget()` per run and hands it to
 * every read that run makes; a budget created per read, or per page, is the
 * unbounded run this policy exists to rule out.
 *
 * ⛔ No imports, on purpose. release.yml's `full-battery` job runs
 * `scheduled-full-run.mjs --release-gate` straight off `actions/checkout` and
 * `setup-node`, with no install step, and `scheduled-full-run-card.yml` imports
 * that file from a bare checkout too; whatever this module loads, those jobs
 * load. A dependency added here breaks the publish lane at load time, on the
 * one run that cannot be repeated cheaply.
 *
 * ⛔ A copy of any of this in a third file is the drift this module exists to
 * end: import it.
 */

/**
 * ⭐ A RETRYABLE BOARD READ (#23361). One HTTP 500 from GitHub used to end the
 * run as PREREQUISITE NOT MET: measured on a merge-queue group whose lint lane
 * went red on `GET issues/4045 -> HTTP 500`, and on a local re-run that died on
 * the head probe instead, while plain reads of both answered 200 that minute.
 * A server error is retryable by definition, so a board read now gets a short,
 * bounded ladder before the gate concludes the board cannot be read.
 *
 * What is retried -- a closed set, each member named:
 *
 *   HTTP 5xx        any status 500..599 the board answers.
 *   ECONNRESET      the peer reset the connection. node's fetch throws a
 *                   `TypeError` (`fetch failed`, or `terminated` when the reset
 *                   lands while the body streams) whose `cause.code` is this.
 *   UND_ERR_SOCKET  the peer closed the socket before the answer was whole
 *                   (`other side closed`) -- the same failure without the RST.
 *
 * MEASURED on node 22.22.0 against a local socket server, directly and through
 * a CONNECT proxy under `--use-env-proxy`: a reset before the answer and one
 * mid-body arrive as those two codes on the cause chain, nowhere else. Because
 * a reset can land while the body streams, the unit retried is the request AND
 * its JSON body, never the request alone.
 *
 * ⛔ What is NOT retried, each an answer rather than a blip: any 4xx (a 404 is
 * this gate's "absent" and keeps that meaning; a 401/403/429 is about the
 * credential or the rate limit, and asking again does not change it); any other
 * thrown error -- `ECONNREFUSED`, `ENOTFOUND`, a proxy that refuses the tunnel
 * (`UND_ERR_ABORTED`, measured), a body that is not JSON. Those reach the
 * caller unchanged, on the exit path they always had.
 *
 * ⛔ NOT A WEAKER GATE. A retry only ever buys another attempt at the same read;
 * a read still failing after its ladder is handed back as the failure it is,
 * and every caller turns that into `prerequisiteRefusal` -- exit 3, never 0.
 * The refusal text names the attempt count, so a red in the queue says it was
 * not one blip.
 *
 * The budget is bounded per READ and per RUN, so a lint lane never trades a
 * fast exit 3 for a slow one:
 *
 *   a board that stays down   the first read spends its ladder (500 + 1000 ms
 *                             of sleep, 2 extra requests) and the run refuses --
 *                             however many numbers the change cites, because the
 *                             first failed read ends the board build.
 *   a board that flaps        `retriesPerRun` caps the whole run at 4 retries,
 *                             so at most 2 full ladders: 3000 ms of sleep and 4
 *                             extra requests, whether the run probes 1 number or
 *                             400 or enumerates 159 pages. Past the budget the
 *                             next 5xx is final.
 *
 * Request latency itself is not bounded here (no read in this file sets a
 * timeout, before or after this change).
 */
export const BOARD_READ_RETRY = Object.freeze({
  /** One read plus up to two retries. */
  attemptsPerRead: 3,
  /** The sleep before retry 1, retry 2. One entry per retry a read may take. */
  backoffMs: Object.freeze([500, 1000]),
  /** Retries the whole run may spend, across every read it makes. */
  retriesPerRun: 4,
});

/** The connection failures a read is retried on. ⛔ Closed: a code not here is an answer. */
export const RETRYABLE_NETWORK_CODES = Object.freeze(['ECONNRESET', 'UND_ERR_SOCKET']);

/** The named connection failure on `err`'s cause chain, or `null` when there is none. */
export function retryableNetworkCode(err) {
  for (let e = err, depth = 0; e && depth < 4; e = e.cause, depth += 1) {
    if (typeof e.code === 'string' && RETRYABLE_NETWORK_CODES.includes(e.code)) return e.code;
  }
  return null;
}

export const sleepMs = (ms) => new Promise((done) => { setTimeout(done, ms); });

/**
 * One RUN's retry budget, shared by every board read the run makes -- the
 * per-run half of the bound above. `sleep` is injectable so `--self-test`
 * spends no wall time on a backoff it only needs to observe.
 */
export function boardReadBudget({ policy = BOARD_READ_RETRY, sleep = sleepMs } = {}) {
  return { policy, sleep, retriesSpent: 0 };
}

/**
 * One board read -- the request and, when it is answered OK, its JSON body --
 * retried on a 5xx or a named connection failure while both the read's ladder
 * and the run's budget allow.
 *
 * Always resolves to a result; never decides a verdict. `ok`/`status`/`body`
 * are the LAST attempt's, `status` is `null` when that attempt threw, and
 * `stoppedBy` says why there was no further attempt:
 *
 *   'answer'    the read was answered with something that is not retried;
 *   'attempts'  the read spent its own ladder;
 *   'budget'    the run's retry budget was already spent.
 *
 * ⛔ An error that is not a named connection failure is rethrown unchanged.
 */
export async function readBoard(fetchImpl, url, init, budget) {
  const { policy } = budget;
  for (let attempt = 1; ; attempt += 1) {
    let read;
    try {
      const res = await fetchImpl(url, init);
      read = { ok: res.ok, status: res.status, headers: res.headers, body: null, code: null, cause: null, attempts: attempt };
      if (res.ok) read.body = await res.json();
    } catch (err) {
      const code = retryableNetworkCode(err);
      if (!code) throw err;
      read = { ok: false, status: null, headers: null, body: null, code, cause: err, attempts: attempt };
    }
    const retryable = read.status === null || (read.status >= 500 && read.status <= 599);
    if (!retryable) return { ...read, stoppedBy: 'answer' };
    if (attempt >= policy.attemptsPerRead) return { ...read, stoppedBy: 'attempts' };
    if (budget.retriesSpent >= policy.retriesPerRun) return { ...read, stoppedBy: 'budget' };
    budget.retriesSpent += 1;
    await budget.sleep(policy.backoffMs[attempt - 1]);
  }
}

/** The error a failed read becomes. Its text names the attempts -- never a tracker number. */
export function readFailure(label, read, policy = BOARD_READ_RETRY) {
  const answer = read.status === null ? read.code : `HTTP ${read.status}`;
  const tries = `after ${read.attempts} attempt${read.attempts === 1 ? '' : 's'}`;
  const why = {
    answer: 'not retried: only a 5xx or a connection reset is',
    attempts: 'every attempt one read is allowed, so not one blip',
    budget: `this run's budget of ${policy.retriesPerRun} retries is spent`,
  }[read.stoppedBy];
  return new Error(`${label} -> ${answer} ${tries} (${why})`, read.cause ? { cause: read.cause } : undefined);
}
