#!/usr/bin/env node
/**
 * Classifies one run of `.github/workflows/shadcn-check.yml` and renders the
 * alarm issue body it may need to open.
 *
 * ## Why this is a file and not an inline `script:` block
 *
 * PR #3497 built the alarm channel this workflow has: the `check` step's exit
 * code stopped being swallowed, was sorted into three classes, and the two
 * classes worth waking someone for were routed into a tracking issue — because
 * "this workflow runs weekly on a schedule, and a red run on a page nobody
 * opens is not an alarm, an issue in the triage queue is".
 *
 * All of that logic lived in YAML, so none of it could be tested; #3497 checked
 * it by hand-running five fixtures once and wrote the result into its PR body.
 * objectui#3586 adds a fourth classified input (the `analyze` step's exit code)
 * and a fifth (cross-run registry reachability), which is more branching than a
 * shell block that nothing executes between weekly runs should carry. The
 * classification is therefore extracted here and covered by
 * `scripts/__tests__/shadcn-check-report.test.ts`, the same way
 * `scripts/render-budget-comment.mjs` was extracted for
 * `.github/workflows/performance-budget.yml`.
 *
 * ## The classification, and the three gaps objectui#3586 closes
 *
 * `check` keeps #3497's vocabulary exactly — the tolerance ruling is unchanged:
 *
 *   patch   the patch gate's own verdict line is present. ALARM.
 *   ok      exit 0 and no such verdict. Includes an unreachable registry,
 *           which the script reports per component and still exits 0.
 *   broken  any other non-zero exit — the check could not run at all. ALARM.
 *
 * Extended, not replaced:
 *
 *   analyze   `ok` | `broken`. `component-analysis.js` has exactly one non-zero
 *             exit — an uncaught crash in `main()`. #3497 left the step
 *             `continue-on-error: true` because there was "no verdict here to
 *             swallow"; that is true of the *drift* verdict and false of the
 *             step itself, so a crash turned the job red on an unwatched weekly
 *             schedule and reached nobody. `broken` now enters the SAME issue
 *             channel — same labels, same de-duplication, no second channel.
 *
 *   registry  `reachable` | `unreachable`, plus how many consecutive runs have
 *             been `unreachable`. A single unreachable run stays tolerated
 *             exactly as #3497 ruled (exit 0 + `::warning::` + summary, no
 *             issue). What was missing is that the tolerance never expired:
 *             with the registry unreachable the upstream-anchor half of the
 *             check does not execute, so N consecutive unreachable runs are N
 *             consecutive weeks of proving nothing, and that never escalated.
 *             At `ESCALATION_THRESHOLD` it does.
 *
 * The predicate for `unreachable` is deliberately the SAME one #3497 already
 * warns on (`registry_errors > 0`), not a new threshold. One tolerated
 * condition, one definition: the escalation says "we have now tolerated this N
 * runs running", and a single component whose URL moved for good is a real
 * finding by week three, not noise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isEntrypoint } from './invoked-as.mjs';

/**
 * How many consecutive unreachable runs escalate into the issue channel.
 *
 * The cron is weekly, so N is measured in weeks of blindness:
 *
 *   N=2 (14 days) fires on any fortnight-long upstream or egress hiccup — a CDN
 *        change or a runner-egress policy edit plausibly spans two Mondays, and
 *        alarming on it is the noise #3497's single-run tolerance was ruled to
 *        avoid.
 *   N=3 (21 days) is well past "transient" for a registry that answered all 46
 *        requests in ~1.7s as recently as run 31374857502, and still inside
 *        every retention window the mechanism depends on (see
 *        `readRegistryStreak`).
 *   N=4 (28 days) is a month of an early-warning system warning about nothing,
 *        and would sit outside the 30-day artifact retention had the artifact
 *        mechanism been the one chosen.
 *
 * Three. Changing it is a one-line edit here; the workflow reads it from this
 * module rather than repeating it.
 */
export const ESCALATION_THRESHOLD = 3;

/**
 * The two step names that carry this run's registry reachability forward to the
 * next run.
 *
 * This is a CONTRACT BETWEEN RUNS, and the only one in the mechanism that a
 * rename can break silently: a run whose marker steps are named something else
 * reads back as `unknown`, which resets the streak, which means the escalation
 * quietly never fires — the exact silent-failure shape this card exists to
 * close. `scripts/__tests__/shadcn-check-report.test.ts` pins the workflow's
 * step names against these constants so the rename goes red instead.
 */
export const MARKER_STEPS = Object.freeze({
  reachable: 'Cross-run marker: registry reachable',
  unreachable: 'Cross-run marker: registry unreachable',
});

/** How much of each captured log is quoted into the issue body. #3497's cap. */
const LOG_EXCERPT_LIMIT = 5000;

/**
 * The two shapes `scripts/shadcn-sync.js` produces when the registry cannot be
 * served: a rejected fetch, and a 2xx whose file content is unusable (proxy
 * error page, egress block, schema change). Same pair #3497 counted.
 */
const REGISTRY_ERROR_LINE = /Registry returned no usable file content|Error fetching from registry:/;

/** The patch gate's own verdict line — the evidence, tested before the exit code. */
const PATCH_VERDICT_LINE = 'component(s) with declared local patch failures';

/**
 * `ESC` is written as an escape sequence, never as the byte itself
 * (objectstack#4890, and `scripts/check-control-bytes.mjs`). Both shadcn
 * scripts colour every line unconditionally, with no TTY or NO_COLOR check, so
 * the raw capture is dense with escapes and an issue body quoting it verbatim
 * is unreadable.
 */
const ANSI_SEQUENCE = /\u001b\[[0-9;]*[A-Za-z]/g;

/** @param {string} text */
export function stripAnsi(text) {
  return text.replace(ANSI_SEQUENCE, '');
}

/** @param {string} output ANSI-stripped `pnpm shadcn:check` output */
export function countRegistryErrors(output) {
  return output.split('\n').filter((line) => REGISTRY_ERROR_LINE.test(line)).length;
}

/**
 * #3497's three classes, unchanged, plus the registry state derived from the
 * same output.
 *
 * The verdict line is tested BEFORE the exit code on purpose, and that ordering
 * is #3497's ruling, quoted: "the message is the evidence, the exit code is a
 * policy that a later change to the script could revise without touching this
 * workflow".
 *
 * @param {{ output?: string, exitCode?: number|string }} input
 */
export function classifyCheck({ output = '', exitCode = 0 } = {}) {
  const status = Number(exitCode);
  const registryErrors = countRegistryErrors(output);

  let checkClass;
  if (output.includes(PATCH_VERDICT_LINE)) {
    checkClass = 'patch';
  } else if (status === 0) {
    checkClass = 'ok';
  } else {
    checkClass = 'broken';
  }

  return {
    checkClass,
    registryErrors,
    registryState: registryErrors > 0 ? 'unreachable' : 'reachable',
  };
}

/**
 * `component-analysis.js` is offline and reads only local files; its single
 * non-zero exit is the `main().catch()` at the bottom of the file. So there are
 * exactly two states, and `broken` alarms.
 *
 * @param {{ exitCode?: number|string }} input
 */
export function classifyAnalyze({ exitCode = 0 } = {}) {
  return Number(exitCode) === 0 ? 'ok' : 'broken';
}

/**
 * Read one previous run's registry state out of its `/actions/runs/{id}/jobs`
 * payload.
 *
 * Three-valued on purpose. `unknown` is not a synonym for `reachable`: it means
 * the run never reached a verdict (it died at checkout or install), or it ran a
 * version of the workflow older than the markers. Both break the streak, which
 * under-alarms rather than over-alarms — the honest direction for a mechanism
 * whose whole job is to eventually open an issue.
 *
 * Every job is searched rather than the one named in the workflow: the job name
 * is not part of this contract, and matching on it would add a second string a
 * rename could silently break.
 *
 * @param {{ steps?: Array<{ name?: string, conclusion?: string }> }[]} jobs
 */
export function registryStateFromJobs(jobs = []) {
  for (const job of jobs) {
    for (const step of job?.steps ?? []) {
      if (step?.conclusion !== 'success') continue;
      if (step.name === MARKER_STEPS.unreachable) return 'unreachable';
      if (step.name === MARKER_STEPS.reachable) return 'reachable';
    }
  }
  return 'unknown';
}

/**
 * Length of the current unreachable streak, current run included.
 *
 * @param {string[]} states newest-first, current run at index 0
 */
export function consecutiveUnreachable(states = []) {
  let streak = 0;
  for (const state of states) {
    if (state !== 'unreachable') break;
    streak += 1;
  }
  return streak;
}

/**
 * The alarm decision. Every reason routes to ONE channel (see
 * `renderAlarmIssue`); this function only says whether to open it and why.
 *
 * `streak-unreadable` alarms, and that is #3497's rule applied to the new
 * moving part: "a check that cannot report is not a passing check". If the
 * cross-run read breaks for good, the escalation can never fire again, and a
 * silently dead alarm channel is the whole bug family this workflow keeps
 * closing. It costs a false alarm on a hard GitHub API outage, which is rare,
 * loud and self-explaining — the cheap direction to be wrong in.
 *
 * @param {{ checkClass: string, analyzeClass: string, registryStreak: number,
 *           streakReadable?: boolean, threshold?: number }} input
 */
export function decideAlarm({
  checkClass,
  analyzeClass,
  registryStreak = 0,
  streakReadable = true,
  threshold = ESCALATION_THRESHOLD,
}) {
  const reasons = [];
  if (checkClass === 'patch') reasons.push('patch');
  if (checkClass === 'broken') reasons.push('check-broken');
  if (analyzeClass === 'broken') reasons.push('analyze-broken');
  if (registryStreak >= threshold) reasons.push('registry-blind');
  if (!streakReadable) reasons.push('streak-unreadable');
  return { alarm: reasons.length > 0, reasons };
}

/**
 * The issue title. Only ever used when there is no open `shadcn-sync` issue —
 * an existing one is commented on instead, which is why the title is chosen
 * from the most actionable reason rather than trying to name all of them.
 *
 * @param {string[]} reasons
 * @param {number} streak
 */
export function alarmTitle(reasons, streak = 0) {
  if (reasons.includes('patch')) return 'Shadcn sync: declared local patches are failing';
  if (reasons.includes('check-broken') || reasons.includes('analyze-broken') || reasons.includes('streak-unreadable')) {
    return 'Shadcn sync: the weekly component check could not run';
  }
  if (reasons.includes('registry-blind')) {
    return `Shadcn sync: the registry has been unreachable for ${streak} consecutive runs`;
  }
  return 'Shadcn sync: the weekly component check needs attention';
}

const excerpt = (text) => text.slice(0, LOG_EXCERPT_LIMIT);

/**
 * Renders the issue body. One body for every reason: the channel is shared, so
 * a reader who opens it for a patch failure and finds the registry has also
 * been blind for three weeks learns both facts at once.
 *
 * @param {object} input
 */
export function renderAlarmIssue({
  reasons = [],
  checkClass = 'ok',
  checkExit = 0,
  analyzeClass = 'ok',
  analyzeExit = 0,
  registryErrors = 0,
  registryStreak = 0,
  streakReadable = true,
  streakError = '',
  threshold = ESCALATION_THRESHOLD,
  runUrl = '',
  analysisLog = '',
  checkLog = '',
} = {}) {
  const title = alarmTitle(reasons, registryStreak);
  let body = '## Shadcn Components Status Report\n\n';

  if (reasons.includes('patch')) {
    body += 'The weekly component sync check found a **declared local patch failure**: ';
    body += 'either a required edit is missing from the file on disk, or upstream moved ';
    body += 'the anchor it is applied to, so the next `pnpm shadcn:update` would refuse ';
    body += 'to write rather than drop it. Details in the check output below.\n\n';
  }
  if (reasons.includes('check-broken')) {
    body += 'The weekly component sync check **could not complete**: `pnpm shadcn:check` ';
    body += 'exited `' + checkExit + '` without reaching a patch verdict. ';
    body += 'Until this is fixed the weekly upstream early-warning is not running.\n\n';
  }
  if (reasons.includes('analyze-broken')) {
    body += 'The offline analysis step **crashed**: `pnpm shadcn:analyze` exited `' + analyzeExit + '`. ';
    body += 'Its only non-zero exit is an uncaught error, so this is a defect in ';
    body += '`scripts/component-analysis.js` or in what it reads — the crash output is ';
    body += 'quoted below.\n\n';
  }
  if (reasons.includes('registry-blind')) {
    body += 'The registry has been unreachable for **' + registryStreak + ' consecutive runs** ';
    body += '(threshold: ' + threshold + '). Each run on its own was tolerated by design and exited 0, ';
    body += 'but with the registry unreachable the upstream-anchor half of the check never ';
    body += 'executes: those runs proved nothing about upstream, and the tolerance has now ';
    body += 'been extended long enough to be worth a look.\n\n';
  }
  if (reasons.includes('streak-unreadable')) {
    body += 'The cross-run registry state **could not be read**' + (streakError ? ' (' + streakError + ')' : '') + '. ';
    body += 'Consecutive-unreachability can no longer escalate until this is fixed, so it is ';
    body += 'reported here rather than tolerated.\n\n';
  }

  body += '- `pnpm shadcn:check` exit code: `' + checkExit + '` (class: `' + checkClass + '`)\n';
  body += '- `pnpm shadcn:analyze` exit code: `' + analyzeExit + '` (class: `' + analyzeClass + '`)\n';
  body += '- Components the registry could not serve: ' + registryErrors + '\n';
  body += '- Consecutive runs with an unreachable registry: ' +
    (streakReadable ? registryStreak + ' (escalates at ' + threshold + ')' : 'unknown — cross-run read failed') + '\n';
  if (runUrl) body += '- Run: ' + runUrl + '\n';
  body += '\n';

  if (analysisLog) {
    body += '### Offline Analysis\n\n';
    body += '```\n' + excerpt(analysisLog) + '\n```\n\n';
  }
  if (checkLog) {
    body += '### Online Check Results\n\n';
    body += '```\n' + excerpt(checkLog) + '\n```\n\n';
  }

  body += '### Next Steps\n\n';
  if (reasons.includes('patch')) {
    body += '1. Read the `DECLARED LOCAL PATCHES` section above — it names the patch id, its tracking issue and the reason\n';
    body += '2. Marker missing from disk: restore it with `pnpm shadcn:update <component>`\n';
    body += '3. Anchor no longer found upstream: re-target `find`/`occurrences` in `scripts/shadcn-local-patches.mjs`\n';
  } else if (reasons.includes('registry-blind') && reasons.length === 1) {
    body += '1. Check whether the registry URLs in `packages/components/shadcn-components.json` still resolve\n';
    body += '2. Reproduce locally with `pnpm shadcn:check --no-cache` — a local success points at runner egress\n';
    body += '3. If upstream moved for good, re-point the sources; the check has proven nothing for ' +
      registryStreak + ' runs\n';
  } else {
    body += '1. Open the workflow run linked above and read the failure\n';
    body += '2. Reproduce locally with `pnpm shadcn:analyze` / `pnpm shadcn:check`\n';
  }
  body += '4. See [SHADCN_SYNC.md](../blob/main/docs/SHADCN_SYNC.md) for detailed guide\n\n';
  body += '> This issue was automatically created by the Shadcn Components Check workflow.\n';

  return { title, body };
}

// ── Cross-run state ─────────────────────────────────────────────────────────

/**
 * The Actions REST surface this mechanism needs, injectable so the tests never
 * touch the network.
 *
 * The workflow file name is DERIVED from `GITHUB_WORKFLOW_REF`
 * (`owner/repo/.github/workflows/shadcn-check.yml@refs/heads/main`) rather than
 * spelled out: a hard-coded copy is a second source of truth that a file rename
 * would break silently, and silence is the failure mode being closed.
 */
export function createActionsApi({
  token = process.env.GITHUB_TOKEN ?? '',
  apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com',
  repository = process.env.GITHUB_REPOSITORY ?? '',
  workflowRef = process.env.GITHUB_WORKFLOW_REF ?? '',
  fetchImpl = globalThis.fetch,
} = {}) {
  const workflowFile = path.basename((workflowRef.split('@')[0] ?? '').trim());
  if (!workflowFile) throw new Error('GITHUB_WORKFLOW_REF did not yield a workflow file name');
  if (!repository) throw new Error('GITHUB_REPOSITORY is not set');

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
    listRuns: (perPage) =>
      get(`/repos/${repository}/actions/workflows/${workflowFile}/runs?status=completed&per_page=${perPage}`),
    listJobs: (runId) => get(`/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`),
  };
}

/**
 * How many consecutive runs — this one included — found the registry
 * unreachable.
 *
 * ## Why the Actions API and not the alternatives (objectui#3586, measured)
 *
 * The card named two candidates and asked for the cheaper honest one. Both were
 * costed, and two more were found on the way:
 *
 *   previous run's `conclusion`   1 call, and structurally BLIND. #3497's
 *     tolerance ruling makes an unreachable run exit 0, so its conclusion is
 *     `success` — byte-identical to a clean run (run 31374857502: `success`,
 *     0 registry errors). It cannot express the distinction at any price.
 *
 *   previous runs' STEP conclusions   1 + (N-1) calls = 3 at N=3, `actions:
 *     read`, no new artifacts, and the state lives as long as the run itself
 *     (90 days by default, ~13 weekly runs). Emitting it costs two no-op steps.
 *     CHOSEN.
 *
 *   previous runs' artifacts   the existing `shadcn-analysis` artifact already
 *     carries `check.txt`, so nothing new is emitted — but reading it is list +
 *     download + unzip per run (1 + 2(N-1) calls plus transfers), and retention
 *     is 30 days ≈ 4 weekly runs, which leaves no headroom above N=3.
 *
 *   previous runs' annotations   1 + 2(N-1) = 5 calls at N=3, and the state is
 *     the `::warning::` PROSE, re-parsed a week later.
 *
 *   comments on the alarm issue   1-2 calls with the already-granted
 *     `issues: write`, and disqualified on design before cost: a tolerated
 *     unreachable run has no issue to comment on (`label:shadcn-sync` has
 *     matched 0 issues, ever). Recording there means either opening the issue on
 *     run 1 — which IS the alarm, contradicting the single-run tolerance ruling
 *     this card leaves untouched — or a private state issue, i.e. the second
 *     channel the card forbids.
 *
 *   `actions/cache`   ~0 API cost, and disqualified: GitHub evicts entries 7
 *     days after last access and the cron is exactly 7 days, so the state sits
 *     on the eviction boundary. A silently reset streak is an escalation that
 *     never fires — the failure shape being closed, rebuilt inside the fix.
 *
 * At most `threshold - 1` job reads happen: the walk stops at the first run
 * that was reachable or unknown, and never needs to look past the threshold.
 *
 * @param {{ currentState: string, threshold?: number, currentRunId?: string|number, api?: object }} input
 */
export async function readRegistryStreak({
  currentState,
  threshold = ESCALATION_THRESHOLD,
  currentRunId = process.env.GITHUB_RUN_ID ?? '',
  api,
}) {
  if (currentState !== 'unreachable') return { streak: 0, readable: true, error: '' };

  const states = ['unreachable'];
  try {
    const client = api ?? createActionsApi();
    const { workflow_runs: runs = [] } = await client.listRuns(threshold + 2);
    const previous = runs.filter((run) => String(run.id) !== String(currentRunId));

    for (const run of previous) {
      if (states.length >= threshold) break;
      const { jobs = [] } = await client.listJobs(run.id);
      const state = registryStateFromJobs(jobs);
      states.push(state);
      if (state !== 'unreachable') break;
    }
  } catch (error) {
    return { streak: consecutiveUnreachable(states), readable: false, error: String(error?.message ?? error) };
  }

  return { streak: consecutiveUnreachable(states), readable: true, error: '' };
}

// ── Workflow entry point ────────────────────────────────────────────────────

const readIfPresent = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

const appendTo = (envVar, text) => {
  const target = process.env[envVar];
  if (target) fs.appendFileSync(target, text.endsWith('\n') ? text : `${text}\n`);
};

/**
 * Classifies the run, records the verdict where the workflow can read it, and
 * writes the alarm body when there is one.
 *
 * Exits 0 in every classified case, including every alarm: the alarm is the
 * issue, not the job colour — #3497's ruling, and the reason gap ③ existed at
 * all. The one thing that still turns the job red is this file itself throwing,
 * which is the irreducible bottom of the mechanism and the reason the logic was
 * moved somewhere it can be unit tested.
 */
export async function main({ api } = {}) {
  const checkExit = Number(process.env.CHECK_EXIT_CODE ?? 0);
  const analyzeExit = Number(process.env.ANALYZE_EXIT_CODE ?? 0);

  const checkLog = stripAnsi(readIfPresent(process.env.CHECK_RAW_LOG ?? 'check.ansi.txt'));
  const analysisLog = stripAnsi(readIfPresent(process.env.ANALYZE_RAW_LOG ?? 'analysis.ansi.txt'));
  fs.writeFileSync(process.env.CHECK_LOG ?? 'check.txt', checkLog);
  fs.writeFileSync(process.env.ANALYZE_LOG ?? 'analysis.txt', analysisLog);

  const { checkClass, registryErrors, registryState } = classifyCheck({ output: checkLog, exitCode: checkExit });
  const analyzeClass = classifyAnalyze({ exitCode: analyzeExit });
  const { streak, readable, error } = await readRegistryStreak({ currentState: registryState, api });
  const { alarm, reasons } = decideAlarm({
    checkClass,
    analyzeClass,
    registryStreak: streak,
    streakReadable: readable,
  });

  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : '';

  const { title, body } = renderAlarmIssue({
    reasons,
    checkClass,
    checkExit,
    analyzeClass,
    analyzeExit,
    registryErrors,
    registryStreak: streak,
    streakReadable: readable,
    streakError: error,
    runUrl,
    analysisLog,
    checkLog,
  });

  if (alarm) fs.writeFileSync(process.env.ALARM_BODY_FILE ?? 'alarm-issue.md', body);

  appendTo(
    'GITHUB_OUTPUT',
    [
      `check_exit_code=${checkExit}`,
      `check_class=${checkClass}`,
      `analyze_exit_code=${analyzeExit}`,
      `analyze_class=${analyzeClass}`,
      `registry_errors=${registryErrors}`,
      `registry_state=${registryState}`,
      `registry_streak=${streak}`,
      `streak_readable=${readable}`,
      `alarm=${alarm}`,
      `alarm_reasons=${reasons.join(',')}`,
      `issue_title=${title}`,
    ].join('\n'),
  );

  const summary = [
    '### Shadcn component check',
    '',
    `- \`pnpm shadcn:analyze\` exit code: \`${analyzeExit}\` (class: \`${analyzeClass}\`)`,
    `- \`pnpm shadcn:check\` exit code: \`${checkExit}\` (class: \`${checkClass}\`)`,
    `- components the registry could not serve: ${registryErrors}`,
  ];

  if (analyzeClass === 'broken') {
    console.log(`::error::pnpm shadcn:analyze crashed (exit ${analyzeExit}). Opening/updating the tracking issue.`);
    summary.push('- Verdict: the offline analysis step crashed. Tracking issue opened or updated.');
  }
  if (checkClass === 'patch') {
    console.log(`::error::Declared local patches are failing (exit ${checkExit}). Opening/updating the tracking issue.`);
    summary.push('- Verdict: a declared local patch failed. Tracking issue opened or updated.');
  } else if (checkClass === 'broken') {
    console.log(
      `::error::shadcn:check exited ${checkExit} without a patch verdict — the check itself could not run. Opening/updating the tracking issue.`,
    );
    summary.push('- Verdict: the check could not run. Tracking issue opened or updated.');
  } else if (registryErrors > 0) {
    if (reasons.includes('registry-blind')) {
      console.log(
        `::error::The registry has been unreachable for ${streak} consecutive runs (threshold ${ESCALATION_THRESHOLD}) — the upstream-anchor check has not run in that time. Opening/updating the tracking issue.`,
      );
      summary.push(
        `- Verdict: unreachable for ${streak} consecutive runs — tolerance exhausted. Tracking issue opened or updated.`,
      );
    } else {
      // Tolerated, but never reported as a clean bill of health: with the
      // registry unreachable the upstream-anchor half of the check did not
      // execute, so this run proved nothing about upstream. #3497's ruling for
      // runs 1..N-1, unchanged — only the counter is new.
      console.log(
        `::warning::${registryErrors} component(s) could not be fetched from the registry, so the upstream-anchor check did not run. Tolerated by design — no issue opened (consecutive unreachable runs: ${streak} of ${ESCALATION_THRESHOLD}).`,
      );
      summary.push(
        `- Verdict: no patch failure, but the online half did not run (registry unreachable ${streak} run(s) running, escalates at ${ESCALATION_THRESHOLD}). Tolerated, no issue opened.`,
      );
    }
  } else if (analyzeClass === 'ok') {
    summary.push('- Verdict: all declared local patches still apply to current upstream.');
  }

  if (!readable) {
    console.log(`::error::The cross-run registry state could not be read (${error}). Opening/updating the tracking issue.`);
    summary.push('- Verdict: the cross-run state read failed — escalation is blind. Tracking issue opened or updated.');
  }

  appendTo('GITHUB_STEP_SUMMARY', summary.join('\n'));
  return { alarm, reasons, checkClass, analyzeClass, registryState, streak };
}

const invokedDirectly = isEntrypoint(import.meta.url);
if (invokedDirectly) {
  await main();
}
