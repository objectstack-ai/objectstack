#!/usr/bin/env node
/**
 * check-merge-queue-head -- the entry at the HEAD of the merge queue must have
 * a `merge_group` build, or nothing behind it can ever land.
 *
 *   node scripts/check-merge-queue-head.mjs               # live read (pnpm check:merge-queue-head)
 *   node scripts/check-merge-queue-head.mjs --json        # the same reading as JSON
 *   node scripts/check-merge-queue-head.mjs --self-test   # offline, no network
 *
 * Exit: 0 = a reading was taken and it is not a wedge (`clear`, `settling`,
 *       `empty`, `undetermined`); 2 = the reading COULD NOT BE TAKEN; 3 = WEDGED.
 *
 * ## The incident class (objectui#7010, four occurrences)
 *
 * A queue entry can sit at the head of the merge queue for which GitHub never
 * dispatches the `merge_group` event at all. Nothing is red, nothing is
 * ejected, and every entry BEHIND it keeps building green and keeps not
 * merging, because a merge queue is strictly ordered: the head cannot merge, so
 * neither can anything behind it. The repository is blocked, repo-wide, across
 * every lane, with no failing check anywhere to point at.
 *
 *   objectui#4968 / #4973   2026-08-17   Dependabot + auto-merge   repo-wide block
 *   #6994 (`streamdown`)    2026-08-31   ~4 hours, cleared by a maintainer dequeue
 *   #6988 (react group)     2026-08-31   ~64 minutes, same remedy
 *   #7283 (`mermaid`)       2026-09-02   ~63 minutes, cleared by the ruleset timeout
 *
 * All four heads were Dependabot pull requests. ⛔ That is a CORRELATION and
 * this gate does not encode it: objectui#7010's 13:12Z comment falsified the
 * universal ("Dependabot entries never get `merge_group` runs" -- `1a4381083` /
 * #5962 merged through this queue on 2026-08-25), so the failure is conditional
 * and nobody has established on WHAT. This patrol therefore judges the head
 * entry whoever opened it, and reads no author.
 *
 * ⛔ WHY GitHub declines the dispatch is NOT answered here and is not
 * answerable from any agent seat -- it is a repository/Actions-settings
 * reading. objectui#7010's triage ruling of 2026-09-04T22:32Z split that half
 * off deliberately so this half could ship. This file is the detection only.
 *
 * ## The two readings that discriminate, and why they are taken on the HEAD
 *
 * Every reading in #7010's first four hours was taken on the entries BEHIND the
 * blocker, which is why everything looked green and nothing explained itself:
 * speculative builds behind a wedged head SHOULD pass. The head entry is the
 * subject.
 *
 *   wedged head    zero `merge_group` runs, of ANY workflow, indefinitely
 *   healthy head   the full set, dispatched within seconds of the entry
 *
 * ⭐ The absence rules out a great deal by itself: a workflow-level `if:` still
 * creates a run and marks it `skipped`, so ZERO runs across every workflow is
 * not a condition inside any workflow -- the event was never dispatched for
 * that entry at all, which is upstream of every check. That is why no check
 * ever fails during one of these.
 *
 * ## ⚠️ The confounder that makes "zero runs" unsafe anywhere but the head
 *
 * Measured on this repository 2026-09-05T23:3xZ, over the 18 most recent queue
 * entries: seventeen dispatched their runs 3-24 seconds after their queue
 * commit, and ONE -- `pr-7815`, the sixth entry of a six-deep chain formed in
 * one burst -- waited 877 seconds. It was not wedged. It was outside the
 * queue's speculative BUILD WINDOW (GitHub builds only the first N entries),
 * and its runs appeared the moment the chain in front of it drained.
 *
 * ⇒ "zero `merge_group` runs" is the NORMAL state of a queue entry deep enough
 * in the queue, and a patrol that judged every entry would report a wedge on
 * every healthy busy queue. The head is at position 1, therefore always inside
 * the build window, therefore the one entry for which zero runs is anomalous.
 * ⛔ Do not widen this gate to the entries behind the head.
 *
 * ## How the head is identified -- and why it is never constructed
 *
 * A queue entry is a real branch, `gh-readonly-queue/<base>/pr-<N>-<base_sha>`,
 * and `<base_sha>` is the commit that entry is stacked on. The head entry is the
 * one stacked on the CURRENT TIP of the base branch; every other entry is
 * stacked on the entry in front of it.
 *
 * ⛔ The ref is taken VERBATIM from `git/matching-refs`, never assembled from a
 * pull-request number and a sha. That is not style. `GET /actions/runs?branch=`
 * answers `total_count: 0` with HTTP 200 for a branch that does not exist
 * (measured), so a constructed ref with one character wrong reports a wedge on
 * a perfectly healthy queue, with a completely plausible message. Reading the
 * ref out of the refs listing means the branch provably exists.
 *
 * ## What this file will not say
 *
 * ⭐ The verdict is GROUNDED before it is rendered (`assertGrounded`): `clear`
 * cannot be reached without a head entry AND a positive run count, and
 * `wedged` cannot be reached without two zero samples and both clocks past the
 * threshold. A detector that reports "all clear" because it was looking at
 * nothing is the exact failure objectui#7010 is about -- so "I could not
 * identify the head" is its own verdict (`undetermined`) with its own wording,
 * and it is never rendered as a healthy queue. Same rule as
 * `half-state-patrol.yml`'s: could-not-read must never look like clean.
 *
 * Everything the rendered report claims to have checked is built FROM the calls
 * that were made, in `trace`, rather than authored next to them -- a gate whose
 * stated reason is false is worse than no gate.
 */

import { isEntrypoint } from './invoked-as.mjs';

/**
 * @typedef {object} QueueEntry
 * @property {string} ref        the ref, verbatim from the refs listing, without `refs/heads/`
 * @property {string} base       the base branch the entry is queued for
 * @property {number} pull       the pull request the entry is landing
 * @property {string} baseSha    the commit the entry is stacked on
 * @property {string} commitSha  the entry's own queue commit
 */

/**
 * @typedef {object} RunSample
 * @property {string} at
 * @property {number} totalCount
 */

/**
 * @typedef {object} QueueReading
 * @property {'empty'|'undetermined'|'clear'|'settling'|'wedged'} verdict
 * @property {string} baseBranch
 * @property {string} tipSha
 * @property {QueueEntry[]} entries
 * @property {QueueEntry|null} head
 * @property {RunSample[]} samples
 * @property {number|null} baseStaticMs
 * @property {number|null} headAgeMs
 * @property {number} thresholdMs
 * @property {string[]} trace
 * @property {string} repository
 * @property {string} serverUrl
 * @property {string} takenAt
 */

/** The exit contract, named so the header's table is machine-checkable. */
export const EXIT_OK = 0;
export const EXIT_CANNOT_RUN = 2;
export const EXIT_WEDGED = 3;

/** The branch this patrol watches. The queue that blocks the repository is `main`'s. */
export const DEFAULT_BASE_BRANCH = 'main';

/** The ref namespace GitHub creates a merge-queue entry's branch under. */
export const QUEUE_REF_NAMESPACE = 'gh-readonly-queue';

/**
 * How long the head entry may sit with ZERO `merge_group` runs before this
 * patrol calls it wedged. ⭐ One constant, and the two boundary readings it
 * sits between are stated here so the next person retunes it against evidence
 * rather than taste (objectui#7010, lane ruling).
 *
 *   HEALTHY, the lower boundary — 3 to 24 SECONDS.
 *     Measured 2026-09-05T23:3xZ over the 18 most recent `merge_group` entries
 *     of this repository: for every entry that was inside the build window, the
 *     gap between its queue commit and the creation of its first `merge_group`
 *     run was 3s at the fastest and 24s at the slowest, with 17 of the 18 runs
 *     dispatched in one burst per entry.
 *     ⚠️ objectui#7010's 2026-08-31T13:23Z comment records this as "the same
 *     second". That was one entry read to more precision than the population
 *     supports; the figures above replace it. The conclusion is unchanged --
 *     dispatch is prompt, and minutes of silence are not slowness.
 *
 *   SELF-HEAL, the upper boundary — 60 MINUTES.
 *     The branch ruleset's status-check timeout eventually ejects a head that
 *     never reports, and the queue rebuilds. Measured on the 2026-09-02
 *     instance (#7283): the entry formed at ~03:29Z, was ejected between 04:17Z
 *     and 04:32Z, and the queue drained immediately after. ⚠️ Re-enqueueing by
 *     hand was measured INEFFECTIVE on that instance; only the timeout cleared it.
 *
 * 5 minutes is ~12x the slowest healthy dispatch and ~1/12 of the self-heal, so
 * it cannot be reached by a slow dispatch and it leaves most of the wasted hour
 * still recoverable. ⛔ Do not lower it towards the dispatch figures: those are
 * a snapshot of one day's runner load, not a bound.
 */
export const WEDGE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * The gap between the two run-count samples a `wedged` verdict requires.
 *
 * One sample cannot distinguish a wedge from the seconds immediately after a
 * head change: if the entry in front is EJECTED rather than merged, the new
 * head inherits an old `main` clock and an old queue commit, so both threshold
 * clocks read as long even though it has been the head for moments. Two zero
 * samples 60s apart cannot -- 60s is 2.5x the slowest dispatch measured above.
 *
 * ⚠️ Cost is paid only on suspicion: a queue whose head has runs never sleeps.
 */
export const CONFIRMATION_DELAY_MS = 60 * 1000;

/** Every verdict this patrol can reach. Ordered from "nothing to judge" to "wedged". */
export const VERDICTS = Object.freeze(['empty', 'undetermined', 'clear', 'settling', 'wedged']);

/**
 * The pull number, base branch and base sha a merge-queue ref names, or null.
 *
 * Accepts the ref with or without a `refs/heads/` prefix. The base segment is
 * greedy (`.+`) because a base branch may itself contain slashes; the trailing
 * `pr-<n>-<sha>` anchor is what keeps the greedy match honest. The namespace
 * segment is required rather than decorative -- a plain branch called
 * `pr-12-abcdef1` is not a queue entry.
 *
 * @param {string} ref
 * @returns {{ ref: string, base: string, pull: number, baseSha: string } | null}
 */
export function parseQueueRef(ref) {
  const text = String(ref ?? '').replace(/^refs\/heads\//, '');
  const m = new RegExp(`^${QUEUE_REF_NAMESPACE}/(.+)/pr-(\\d+)-([0-9a-f]{7,40})$`).exec(text);
  if (!m) return null;
  return { ref: text, base: m[1], pull: Number(m[2]), baseSha: m[3] };
}

/**
 * Which of `entries` is the head of `baseBranch`'s queue, given the branch's
 * current tip.
 *
 * The head is the entry stacked directly on the tip. ⛔ Never "the first one
 * returned" and never "the oldest": `git/matching-refs` sorts
 * lexicographically, which orders by pull NUMBER, and a re-queued older pull
 * request sits at the head with a larger-numbered entry behind it.
 *
 * @param {{ entries: ReadonlyArray<{ ref: string, base: string, pull: number, baseSha: string }>,
 *          baseBranch: string, tipSha: string }} input
 * @returns {{ ref: string, base: string, pull: number, baseSha: string } | null}
 */
export function selectHeadEntry({ entries = [], baseBranch = DEFAULT_BASE_BRANCH, tipSha = '' } = {}) {
  const tip = String(tipSha).toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(tip)) return null;
  const onBase = entries.filter((e) => e.base === baseBranch);
  // Prefix in the sha's own direction: a ref may carry the full 40 characters
  // while an abbreviated tip is shorter, or the reverse.
  return (
    onBase.find((e) => {
      const a = e.baseSha.toLowerCase();
      return a.startsWith(tip) || tip.startsWith(a);
    }) ?? null
  );
}

/**
 * The verdict over one completed reading. Pure -- every branch is offline-testable.
 *
 * @param {{ entries?: ReadonlyArray<unknown>, head?: { ref: string }|null,
 *           samples?: ReadonlyArray<{ totalCount: number }>, baseStaticMs?: number|null,
 *           headAgeMs?: number|null, thresholdMs?: number }} input
 * @returns {'empty'|'undetermined'|'clear'|'settling'|'wedged'}
 */
export function classifyQueue({
  entries = [],
  head = null,
  samples = [],
  baseStaticMs = null,
  headAgeMs = null,
  thresholdMs = WEDGE_THRESHOLD_MS,
} = {}) {
  if (entries.length === 0) return 'empty';
  if (!head) return 'undetermined';
  if (samples.length === 0) return 'undetermined';

  const last = samples[samples.length - 1];
  if (Number(last.totalCount) > 0) return 'clear';

  // Zero runs. Both clocks must be past the threshold, and both must have been
  // READ -- a clock this run could not take is not a clock that has elapsed.
  const clocks = [baseStaticMs, headAgeMs];
  if (clocks.some((ms) => typeof ms !== 'number' || !Number.isFinite(ms))) return 'undetermined';
  if (clocks.some((ms) => ms < thresholdMs)) return 'settling';

  // The confirmation sample is what separates a wedge from the seconds after a
  // head change; without it the reading is honest but not yet decisive.
  if (samples.length < 2 || samples.some((s) => Number(s.totalCount) !== 0)) return 'settling';
  return 'wedged';
}

/**
 * The refusal that keeps a verdict from outrunning its evidence.
 *
 * ⭐ This is the anti-vacuity leg, in the script rather than only in the pin
 * test: no code path may print a healthy queue without having identified a head
 * entry and counted a positive number of runs on it, and none may print a wedge
 * without two zero samples and both clocks past the threshold. Throwing here is
 * `EXIT_CANNOT_RUN`, which is the correct direction -- "the patrol contradicted
 * itself" must never render as either answer.
 *
 * ⚠️ Typed loosely on purpose: its whole job is to judge a shape that may be
 * wrong, so a parameter type that only admitted well-formed readings would move
 * the check to the compiler and delete it from the runtime.
 *
 * @param {any} reading
 * @returns {void}
 */
export function assertGrounded(reading) {
  const { verdict, entries = [], head = null, samples = [], baseStaticMs, headAgeMs, thresholdMs } = reading ?? {};
  const fail = (why) => {
    throw new Error(`ungrounded verdict '${verdict}': ${why}`);
  };
  if (!VERDICTS.includes(verdict)) fail(`not one of ${VERDICTS.join(', ')}`);
  const last = samples.length ? Number(samples[samples.length - 1].totalCount) : null;

  if (verdict === 'empty' && entries.length !== 0) fail(`${entries.length} queue entries were listed`);
  if (verdict === 'undetermined' && head && samples.length && Number.isFinite(baseStaticMs) && Number.isFinite(headAgeMs)) {
    fail('a head entry, a run count and both clocks were all read — that is a determinable reading');
  }
  if (verdict === 'clear' && !(head && last !== null && last > 0)) {
    fail(`clear requires a head entry with a positive run count, got head=${head ? head.ref : 'null'} runs=${last}`);
  }
  if (verdict === 'settling' && !(head && last === 0)) {
    fail(`settling requires a head entry whose latest sample is 0, got head=${head ? head.ref : 'null'} runs=${last}`);
  }
  if (verdict === 'wedged') {
    if (!head) fail('wedged requires an identified head entry');
    if (samples.length < 2) fail(`wedged requires two samples, got ${samples.length}`);
    if (samples.some((s) => Number(s.totalCount) !== 0)) fail('wedged requires every sample to be zero');
    if (!(baseStaticMs >= thresholdMs && headAgeMs >= thresholdMs)) {
      fail(`wedged requires both clocks past ${thresholdMs}ms, got base=${baseStaticMs} head=${headAgeMs}`);
    }
  }
}

/** A duration as `1h 04m 12s`, for a human reading an alert at 3am. */
export function humanDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'unknown';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * The markdown report. Every heading states what was actually read, and the
 * "What this run checked" block is rendered from `reading.trace`, which the
 * reader below appends to as each call returns -- so the claim cannot describe
 * a call that was not made.
 *
 * @param {QueueReading} reading
 */
export function renderReading(reading) {
  const { verdict, baseBranch, tipSha, entries = [], head, samples = [], baseStaticMs, headAgeMs, trace = [], repository = '', serverUrl = 'https://github.com' } = reading;
  const sha7 = String(tipSha ?? '').slice(0, 7);
  const runs = samples.length ? samples[samples.length - 1].totalCount : null;
  const prUrl = head ? `${serverUrl}/${repository}/pull/${head.pull}` : '';
  const lines = [];

  const heading = {
    wedged: `# ⛔ MERGE QUEUE WEDGED — the head entry has no \`merge_group\` build`,
    clear: `# ✅ Merge queue head is building`,
    settling: `# ⏳ Merge queue head has no build yet — under the ${humanDuration(reading.thresholdMs)} threshold`,
    empty: `# ⏸️ Merge queue is empty — nothing to judge`,
    undetermined: `# ⚠️ NO READING TAKEN — the head entry could not be identified`,
  }[verdict];
  lines.push(heading, '');

  if (verdict === 'wedged') {
    lines.push(
      `**[#${head?.pull}](${prUrl}) is at the head of \`${baseBranch}\`'s merge queue and GitHub has dispatched ` +
        `no \`merge_group\` run for it — not one, of any workflow.** \`${baseBranch}\` has not advanced for ` +
        `**${humanDuration(baseStaticMs)}** and every pull request queued behind #${head?.pull} is blocked ` +
        `behind it, whatever its own checks say.`,
      '',
      '**The remedy is to remove that entry from the merge queue** — the queue page for this repository, not the ' +
        'pull request. Everything behind it lands on its own once the head clears. ⚠️ Re-enqueueing the head was ' +
        'measured INEFFECTIVE on the 2026-09-02 instance (objectui#7010); only removal, or the ruleset\'s ' +
        '60-minute status-check timeout, cleared it.',
      '',
      '⛔ Do not merge anything outside the queue and do not push an empty commit to "kick" it.',
      '',
    );
  } else if (verdict === 'undetermined') {
    lines.push(
      `${entries.length} queue ${entries.length === 1 ? 'entry is' : 'entries are'} live, but none of them is ` +
        `stacked on \`${baseBranch}\`'s current tip \`${sha7}\`, so this run could not tell which entry is the ` +
        `head. **This is not a clean reading and it is not a dirty one — it is no reading at all.** The usual ` +
        `cause is benign: the queue re-forms after every landing, and a run that samples mid-reform sees the ` +
        `old chain. A run that keeps saying this is a defect in the patrol, not in the queue.`,
      '',
    );
  } else if (verdict === 'empty') {
    lines.push(`No \`${QUEUE_REF_NAMESPACE}/${baseBranch}/\` refs exist, so \`${baseBranch}\`'s merge queue holds nothing.`, '');
  } else {
    lines.push(
      `Head entry: **[#${head?.pull}](${prUrl})** — \`${head?.ref}\`, stacked on \`${sha7}\`, ` +
        `${humanDuration(headAgeMs)} old, with **${runs}** \`merge_group\` run${runs === 1 ? '' : 's'}. ` +
        `\`${baseBranch}\` last advanced ${humanDuration(baseStaticMs)} ago.`,
      '',
    );
  }

  if (entries.length > 0) {
    lines.push('| entry | pull | stacked on | head? |', '|:--|--:|:--|:--|');
    for (const e of entries) {
      const isHead = head && e.ref === head.ref;
      lines.push(`| \`${e.ref}\` | #${e.pull} | \`${e.baseSha.slice(0, 7)}\` | ${isHead ? '**yes**' : ''} |`);
    }
    lines.push('');
  }

  lines.push('## What this run checked', '');
  for (const line of trace) lines.push(`- ${line}`);
  lines.push(
    '',
    `⛔ This patrol reads only the head entry. Zero \`merge_group\` runs is the NORMAL state of an entry deep ` +
      `enough in the queue to sit outside GitHub's speculative build window (measured: one healthy entry waited ` +
      `877s for its turn), so the entries behind the head are deliberately not judged.`,
    '',
    `⛔ Why GitHub declines to dispatch \`merge_group\` for such an entry is unestablished and is not answerable ` +
      `from a workflow — it is a repository/Actions-settings reading (objectui#7010, triage 2026-09-04).`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * One line of console output — what a seat sees when running this by hand.
 *
 * @param {QueueReading} reading
 */
export function renderOneLine(reading) {
  const { verdict, baseBranch, head, samples = [], baseStaticMs } = reading;
  const runs = samples.length ? samples[samples.length - 1].totalCount : 'n/a';
  const at = head ? `head #${head.pull} (${head.ref})` : 'head unidentified';
  return `${verdict.toUpperCase()}: ${baseBranch} queue — ${at}, ${runs} merge_group run(s), ${baseBranch} static ${humanDuration(baseStaticMs)}`;
}

/**
 * The REST surface this patrol needs, injectable so tests never reach the
 * network. Read-only: nothing here mutates anything, and the workflow performs
 * the one write it does under an explicit step.
 *
 * Needs `contents: read` (refs, commits) and `actions: read` (workflow runs).
 * A non-2xx throws, which is `EXIT_CANNOT_RUN` — never a pass.
 */
export function createQueueApi({
  token = process.env.GITHUB_TOKEN ?? '',
  apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com',
  repository = process.env.GITHUB_REPOSITORY ?? '',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!repository) throw new Error('GITHUB_REPOSITORY is not set — the patrol must be told which repository it reads');

  const get = async (route) => {
    const res = await fetchImpl(`${apiUrl}${route}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GET ${route} -> HTTP ${res.status}`);
    return res.json();
  };

  return {
    repository,
    /**
     * Every live merge-queue ref for `base`. ⛔ The trailing slash matters in
     * the other direction: `matching-refs/heads/<prefix>/` is rejected with
     * "Request path could not be canonicalized" (measured), so the prefix is
     * passed WITHOUT one and the base segment is re-checked by `parseQueueRef`.
     */
    listQueueRefs: async (base) => {
      const body = await get(`/repos/${repository}/git/matching-refs/heads/${QUEUE_REF_NAMESPACE}/${base}`);
      return (Array.isArray(body) ? body : []).map((r) => ({ ref: String(r?.ref ?? ''), sha: String(r?.object?.sha ?? '') }));
    },
    /**
     * One commit, by branch name or by sha.
     *
     * ⛔ A queue entry is read by its SHA, never by its ref: `/commits/<ref>`
     * answers HTTP 422 for a ref containing slashes, encoded or not (measured),
     * and every queue ref contains three. The sha comes back with the ref from
     * `listQueueRefs`, so this costs no extra call.
     */
    commit: async (rev) => {
      const body = await get(`/repos/${repository}/commits/${rev}`);
      return { sha: String(body?.sha ?? ''), committedAt: body?.commit?.committer?.date ?? null };
    },
    /**
     * When the base branch last actually MOVED, from the newest `push` run on it.
     *
     * ⚠️ Not the tip commit's own timestamp: a queue commit is created when its
     * group forms and lands minutes later, and the two differed by 15m51s on
     * the entry measured 2026-09-05. The push run's `created_at` is the push.
     * `head_sha` comes back with it so the caller can refuse a stale reading.
     */
    lastAdvance: async (base) => {
      const body = await get(`/repos/${repository}/actions/runs?branch=${encodeURIComponent(base)}&event=push&per_page=1`);
      const run = body?.workflow_runs?.[0];
      return run ? { at: run.created_at ?? null, sha: String(run.head_sha ?? '') } : null;
    },
    /** How many `merge_group` runs exist for one queue ref. Zero is a real answer, not an error. */
    countMergeGroupRuns: async (ref) => {
      const body = await get(`/repos/${repository}/actions/runs?event=merge_group&branch=${encodeURIComponent(ref)}&per_page=1`);
      return Number(body?.total_count ?? 0);
    },
  };
}

/**
 * Take one reading. Every call appends to `trace` as it returns, so the report's
 * "what this run checked" is derived from the calls rather than written beside them.
 *
 * @param {{ api: any, baseBranch?: string, thresholdMs?: number, confirmDelayMs?: number,
 *           now?: () => number, sleep?: (ms: number) => Promise<void>, serverUrl?: string }} input
 * @returns {Promise<QueueReading>}
 */
export async function inspectQueue({
  api,
  baseBranch = DEFAULT_BASE_BRANCH,
  thresholdMs = WEDGE_THRESHOLD_MS,
  confirmDelayMs = CONFIRMATION_DELAY_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com',
} = {}) {
  /** @type {string[]} */ const trace = [];
  const at = () => new Date(now()).toISOString();

  const refs = await api.listQueueRefs(baseBranch);
  const entries = refs
    .map((r) => {
      const parsed = parseQueueRef(r?.ref ?? r);
      return parsed ? { ...parsed, commitSha: String(r?.sha ?? '') } : null;
    })
    .filter((e) => e && e.base === baseBranch)
    .map((e) => /** @type {{ ref: string, base: string, pull: number, baseSha: string, commitSha: string }} */ (e));
  trace.push(
    `listed \`refs/heads/${QUEUE_REF_NAMESPACE}/${baseBranch}/*\` — ${refs.length} ref(s), ${entries.length} of them a well-formed queue entry`,
  );

  const tip = await api.commit(baseBranch);
  trace.push(`read the tip of \`${baseBranch}\` — \`${tip.sha.slice(0, 7)}\``);

  const advance = await api.lastAdvance(baseBranch);
  /** @type {number|null} */ let baseStaticMs = null;
  if (!advance?.at) {
    trace.push(`⚠️ found no \`push\` workflow run on \`${baseBranch}\`, so "how long has it been static" was NOT read`);
  } else if (advance.sha && tip.sha && !advance.sha.startsWith(tip.sha) && !tip.sha.startsWith(advance.sha)) {
    trace.push(
      `⚠️ the newest \`push\` run on \`${baseBranch}\` is for \`${advance.sha.slice(0, 7)}\`, not the current tip ` +
        `\`${tip.sha.slice(0, 7)}\` — that clock is stale, so it was NOT used`,
    );
  } else {
    baseStaticMs = now() - Date.parse(advance.at);
    trace.push(`\`${baseBranch}\` last advanced at ${advance.at} (newest \`push\` run) — ${humanDuration(baseStaticMs)} ago`);
  }

  const head = selectHeadEntry({ entries, baseBranch, tipSha: tip.sha });
  /** @type {Array<{ at: string, totalCount: number }>} */ const samples = [];
  /** @type {number|null} */ let headAgeMs = null;

  if (entries.length === 0) {
    trace.push('the queue is empty — no entry to judge, and nothing is being blocked');
  } else if (!head) {
    trace.push(`⛔ no live entry is stacked on \`${tip.sha.slice(0, 7)}\`, so the HEAD of the queue could not be identified`);
  } else {
    const commit = await api.commit(head.commitSha);
    headAgeMs = commit.committedAt ? now() - Date.parse(commit.committedAt) : null;
    trace.push(
      `head entry is \`${head.ref}\` (pull #${head.pull}) — its queue commit \`${commit.sha.slice(0, 7)}\` was ` +
        `created ${commit.committedAt ?? 'at an unreadable time'}${headAgeMs === null ? '' : `, ${humanDuration(headAgeMs)} ago`}`,
    );

    const first = await api.countMergeGroupRuns(head.ref);
    samples.push({ at: at(), totalCount: first });
    trace.push(`counted \`merge_group\` runs on \`${head.ref}\` — **${first}**`);

    const suspicious =
      first === 0 &&
      typeof baseStaticMs === 'number' &&
      typeof headAgeMs === 'number' &&
      baseStaticMs >= thresholdMs &&
      headAgeMs >= thresholdMs;

    if (suspicious) {
      trace.push(
        `both clocks are past the ${humanDuration(thresholdMs)} threshold with zero runs — waiting ` +
          `${humanDuration(confirmDelayMs)} and counting again, because one sample cannot tell a wedge from the ` +
          `seconds after a head change`,
      );
      await sleep(confirmDelayMs);
      const second = await api.countMergeGroupRuns(head.ref);
      samples.push({ at: at(), totalCount: second });
      trace.push(`re-counted \`merge_group\` runs on \`${head.ref}\` — **${second}**`);
    }
  }

  const verdict = classifyQueue({ entries, head, samples, baseStaticMs, headAgeMs, thresholdMs });
  /** @type {QueueReading} */
  const reading = {
    verdict,
    baseBranch,
    tipSha: tip.sha,
    entries,
    head,
    samples,
    baseStaticMs,
    headAgeMs,
    thresholdMs,
    trace,
    repository: api.repository ?? process.env.GITHUB_REPOSITORY ?? '',
    serverUrl,
    takenAt: at(),
  };
  // ⭐ The refusal, on the ONLY path that produces a reading. Deleting this line
  // leaves every case below still green, which is why the pin test greps for it.
  assertGrounded(reading);
  return reading;
}

/**
 * The exit code a verdict maps to. Only a wedge is a finding; the rest are readings.
 *
 * @param {string} verdict
 */
export function exitCodeFor(verdict) {
  return verdict === 'wedged' ? EXIT_WEDGED : EXIT_OK;
}

/**
 * The workflow's entry point. Writes the markdown report to stdout so the caller
 * can redirect it, and the one-line verdict plus any annotation to stderr, so a
 * redirected report is never polluted by them.
 *
 * @param {{ api?: object, env?: Record<string, string|undefined>, argv?: string[] }} [input]
 */
export async function main({ api, env = process.env, argv = process.argv.slice(2) } = {}) {
  const baseBranch = env.QUEUE_BASE_BRANCH || DEFAULT_BASE_BRANCH;
  const reading = await inspectQueue({
    api: api ?? createQueueApi(),
    baseBranch,
    serverUrl: env.GITHUB_SERVER_URL ?? 'https://github.com',
  });

  process.stdout.write(argv.includes('--json') ? `${JSON.stringify(reading, null, 2)}\n` : renderReading(reading));
  console.error(renderOneLine(reading));
  if (reading.verdict === 'wedged') {
    console.error(
      `::error::Merge queue WEDGED: #${reading.head?.pull} is at the head of ${baseBranch}'s queue with zero ` +
        `merge_group runs across two samples, and ${baseBranch} has not advanced for ${humanDuration(reading.baseStaticMs)}. ` +
        `Every queued pull request is blocked behind it. Remove that entry from the merge queue.`,
    );
  }
  return reading;
}

// ---------------------------------------------------------------------------
// Self-test — offline, no network, no clock
// ---------------------------------------------------------------------------

/**
 * The fixtures are BYTE-REAL where the shape is the thing being tested: the
 * healthy corpus is the live reading taken from this repository at
 * 2026-09-05T23:36Z, and the wedged corpus is the same shape with the recorded
 * #7283 head substituted in. ⭐ The corpus is CLEAN — the queue was healthy
 * when this landed — so the wedged fixture is the only thing standing between
 * this gate and a detector that has never once been observed to fire.
 */
export const HEALTHY_FIXTURE = Object.freeze({
  tipSha: '52cac3886bb3b59d247252cc1c98cc6245850e79',
  refs: Object.freeze(['refs/heads/gh-readonly-queue/main/pr-7815-52cac3886bb3b59d247252cc1c98cc6245850e79']),
  runs: 17,
});

export const WEDGED_FIXTURE = Object.freeze({
  tipSha: 'eb33a8d4c69f2a7b1d0e5c8a4f3b2e1d0c9a8b7f',
  refs: Object.freeze(['refs/heads/gh-readonly-queue/main/pr-7283-eb33a8d4c69f2a7b1d0e5c8a4f3b2e1d0c9a8b7f']),
  runs: 0,
});

/**
 * A fake API over a fixture. `agedMs` is how long ago both clocks were set, so a
 * case chooses whether the head is fresh or long-standing without any real time
 * passing.
 */
export function fakeApi({
  tipSha,
  refs,
  runs,
  agedMs = 60 * 60 * 1000,
  nowMs,
  base = 'main',
  repository = 'objectstack-ai/objectui',
}) {
  const stamp = new Date(nowMs - agedMs).toISOString();
  /** @type {number[]} */ const counts = Array.isArray(runs) ? [...runs] : [runs];
  return {
    repository,
    calls: /** @type {string[]} */ ([]),
    async listQueueRefs(base) {
      this.calls.push(`listQueueRefs(${base})`);
      return refs.map((ref, i) => ({ ref, sha: `c0ffee${i}`.padEnd(40, '0') }));
    },
    async commit(rev) {
      this.calls.push(`commit(${rev})`);
      return { sha: rev === base ? tipSha : rev, committedAt: stamp };
    },
    /** @returns {Promise<{ at: string|null, sha: string }|null>} */
    async lastAdvance(base) {
      this.calls.push(`lastAdvance(${base})`);
      return { at: stamp, sha: tipSha };
    },
    async countMergeGroupRuns(ref) {
      this.calls.push(`countMergeGroupRuns(${ref})`);
      return counts.length > 1 ? counts.shift() : counts[0];
    },
  };
}

export async function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });
  const NOW = Date.parse('2026-09-05T23:40:00Z');
  const run = (fixture, over = {}) =>
    inspectQueue({
      api: fakeApi({ ...fixture, nowMs: NOW, ...over }),
      now: () => NOW,
      sleep: async () => {},
    });

  // ── the exit contract, so the header's table cannot drift from the code ────
  t('exit-ok-is-0', EXIT_OK === 0);
  t('exit-cannot-run-is-2', EXIT_CANNOT_RUN === 2);
  t('exit-wedged-is-3', EXIT_WEDGED === 3);
  t('only-a-wedge-is-a-finding', VERDICTS.every((v) => exitCodeFor(v) === (v === 'wedged' ? EXIT_WEDGED : EXIT_OK)));

  // ── the ref parser, on the byte-real refs measured from this repository ────
  const real = parseQueueRef(HEALTHY_FIXTURE.refs[0]);
  t('parses-the-live-ref-measured-today', real?.pull === 7815 && real.base === 'main' && real.baseSha === HEALTHY_FIXTURE.tipSha, JSON.stringify(real));
  t('parses-a-ref-without-the-refs-prefix', parseQueueRef('gh-readonly-queue/main/pr-42-abcdef1')?.pull === 42);
  t('reads-a-base-branch-containing-a-slash', parseQueueRef('gh-readonly-queue/release/v5/pr-7-abcdef1')?.base === 'release/v5');
  t('refuses-a-plain-branch-named-like-an-entry', parseQueueRef('pr-12-abcdef1') === null);
  t('refuses-a-ref-outside-the-queue-namespace', parseQueueRef('refs/heads/feature/pr-12-abcdef1') === null);

  // ── head selection ────────────────────────────────────────────────────────
  const entries = [
    parseQueueRef('gh-readonly-queue/main/pr-9000-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    parseQueueRef(HEALTHY_FIXTURE.refs[0]),
  ];
  const picked = selectHeadEntry({ entries, baseBranch: 'main', tipSha: HEALTHY_FIXTURE.tipSha });
  t('picks-the-entry-stacked-on-the-tip-not-the-first-listed', picked?.pull === 7815, JSON.stringify(picked));
  t('the-picked-entry-is-an-object-from-the-listing', picked === entries[1]);
  t('an-abbreviated-tip-still-matches', selectHeadEntry({ entries, baseBranch: 'main', tipSha: '52cac38' })?.pull === 7815);
  t('no-entry-on-the-tip-is-no-head', selectHeadEntry({ entries, baseBranch: 'main', tipSha: 'deadbee' }) === null);
  t('an-entry-on-another-base-is-not-this-queues-head', selectHeadEntry({ entries: [parseQueueRef('gh-readonly-queue/develop/pr-1-abcdef1')], baseBranch: 'main', tipSha: 'abcdef1' }) === null);

  // ── the healthy corpus ────────────────────────────────────────────────────
  const healthy = await run(HEALTHY_FIXTURE);
  t('a-head-with-runs-is-CLEAR', healthy.verdict === 'clear', healthy.verdict);
  t('a-clear-reading-exits-0', exitCodeFor(healthy.verdict) === EXIT_OK);
  t('a-clear-reading-never-sampled-twice', healthy.samples.length === 1);

  // ── ⭐ THE ANTI-VACUOUS LEG ───────────────────────────────────────────────
  // The corpus is clean, so the ONLY thing proving this detector can still see a
  // wedge is a fixture that is one field different from the healthy one. If a
  // change makes the detector blind — a narrowed parser, a head selector that
  // stops resolving, a run count read off the wrong field — this flips to
  // `undetermined` or `clear` and goes red here.
  const wedged = await run({ ...HEALTHY_FIXTURE, runs: 0 });
  t('the-healthy-corpus-with-ZERO-runs-is-WEDGED', wedged.verdict === 'wedged', wedged.verdict);
  t('a-wedge-exits-3', exitCodeFor(wedged.verdict) === EXIT_WEDGED);
  t('a-wedge-took-a-confirmation-sample', wedged.samples.length === 2 && wedged.samples.every((s) => s.totalCount === 0));
  t('a-wedge-names-the-pull-request-to-dequeue', renderReading(wedged).includes('#7815'));

  // The recorded #7283 instance, in its own shape.
  const recorded = await run(WEDGED_FIXTURE);
  t('the-recorded-2026-09-02-instance-is-WEDGED', recorded.verdict === 'wedged', recorded.verdict);
  t('the-recorded-instance-names-its-pull-request', renderReading(recorded).includes('#7283'));

  // ── the states that must never render as healthy ──────────────────────────
  const empty = await run({ ...HEALTHY_FIXTURE, refs: [] });
  t('an-empty-queue-is-EMPTY-not-clear', empty.verdict === 'empty', empty.verdict);
  const drifted = await run({ ...HEALTHY_FIXTURE, tipSha: 'f'.repeat(40) });
  t('a-queue-whose-entries-miss-the-tip-is-UNDETERMINED', drifted.verdict === 'undetermined', drifted.verdict);
  const undeterminedBody = renderReading(drifted);
  t('an-undetermined-reading-says-so-in-its-heading', /NO READING TAKEN/.test(undeterminedBody));
  t('an-undetermined-reading-never-claims-a-healthy-queue', !/✅/.test(undeterminedBody) && /not a clean reading/.test(undeterminedBody));
  t('an-empty-reading-never-claims-a-healthy-queue', !/✅/.test(renderReading(empty)));

  // ── the threshold, at its own boundary ────────────────────────────────────
  const young = await run({ ...HEALTHY_FIXTURE, runs: 0, agedMs: WEDGE_THRESHOLD_MS - 1000 });
  t('zero-runs-under-the-threshold-is-SETTLING-not-wedged', young.verdict === 'settling', young.verdict);
  t('a-settling-reading-never-claims-a-healthy-queue', !/✅/.test(renderReading(young)));
  const exact = await run({ ...HEALTHY_FIXTURE, runs: 0, agedMs: WEDGE_THRESHOLD_MS });
  t('zero-runs-at-exactly-the-threshold-is-WEDGED', exact.verdict === 'wedged', exact.verdict);

  // ── the confirmation sample is load-bearing ───────────────────────────────
  const recovered = await run({ ...HEALTHY_FIXTURE, runs: [0, 17] });
  t('runs-appearing-during-the-confirmation-wait-is-CLEAR-not-wedged', recovered.verdict === 'clear', recovered.verdict);

  // ── the grounding refusal itself ──────────────────────────────────────────
  const ungrounded = (reading) => {
    try {
      assertGrounded(reading);
      return false;
    } catch {
      return true;
    }
  };
  t('clear-with-no-head-is-refused', ungrounded({ verdict: 'clear', entries: [1], head: null, samples: [{ totalCount: 9 }] }));
  t('clear-with-zero-runs-is-refused', ungrounded({ verdict: 'clear', entries: [1], head: { ref: 'r' }, samples: [{ totalCount: 0 }] }));
  t('clear-with-no-sample-at-all-is-refused', ungrounded({ verdict: 'clear', entries: [1], head: { ref: 'r' }, samples: [] }));
  t('wedged-on-one-sample-is-refused', ungrounded({ verdict: 'wedged', entries: [1], head: { ref: 'r' }, samples: [{ totalCount: 0 }], baseStaticMs: 1e9, headAgeMs: 1e9, thresholdMs: WEDGE_THRESHOLD_MS }));
  t('wedged-with-an-unread-clock-is-refused', ungrounded({ verdict: 'wedged', entries: [1], head: { ref: 'r' }, samples: [{ totalCount: 0 }, { totalCount: 0 }], baseStaticMs: null, headAgeMs: 1e9, thresholdMs: WEDGE_THRESHOLD_MS }));
  t('empty-with-live-entries-is-refused', ungrounded({ verdict: 'empty', entries: [1] }));
  t('an-unknown-verdict-is-refused', ungrounded({ verdict: 'fine', entries: [] }));

  // ── the report describes calls that were actually made ────────────────────
  t('the-trace-records-every-read', healthy.trace.length >= 4 && healthy.trace.some((l) => l.includes('counted `merge_group` runs')));
  t('the-report-renders-the-trace', renderReading(healthy).includes(healthy.trace[0]));

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-merge-queue-head self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`✓ check-merge-queue-head self-test: ${cases.length} cases pass (byte-real refs, a wedged corpus the live queue does not supply, both threshold boundaries, and every ungrounded verdict refused).`);
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    process.exitCode = await selfTest();
  } else {
    try {
      const reading = await main();
      process.exitCode = exitCodeFor(reading.verdict);
    } catch (error) {
      console.error(`::error::check-merge-queue-head could not take a reading: ${error instanceof Error ? error.message : String(error)}`);
      console.error('A reading that could not be taken is NOT a clean queue. Nothing about the merge queue was judged by this run.');
      process.exitCode = EXIT_CANNOT_RUN;
    }
  }
}
