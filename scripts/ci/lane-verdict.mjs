#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// lane-verdict -- the one step that keeps a gate lane's red (#23191).
//
//   node scripts/ci/lane-verdict.mjs               # in-job: the LAST step of a gate lane
//   node scripts/ci/lane-verdict.mjs --self-test   # offline, fixtures only, no env needed
//
// ## What this is for
//
// Every gate step of a `Lint · *` and a `Type Check · *` lane in
// `.github/workflows/lint.yml` runs with `continue-on-error: true` (#23177
// ruling B, item A1, comment 6139629628), so a red gate no longer skips every
// gate behind it: one run reports every red in the lane instead of the first.
//
// `continue-on-error` on its own trades that red for silence. GitHub records
// two results per step -- `outcome`, before `continue-on-error` is applied, and
// `conclusion`, after it -- and for a failed step under the flag they DIFFER:
// `outcome` is `failure`, `conclusion` is `success`, and the job goes on to
// conclude `success`. This step is what puts the red back. It reads the lane's
// gate roster out of the workflow file, reads each gate's OUTCOME from the
// `steps` context, prints the red ones by name and exits 1, so the lane -- and
// the required aggregate that reads the lane's `result` -- still concludes
// `failure`. ⛔ Never read `conclusion` here: under the flag it is `success` for
// every gate, red or green, and the verdict would be green forever.
//
// ## Inputs, all from the step that runs it
//
//   OS_LANE_STEPS        `${{ toJSON(steps) }}` -- the `steps` context. It holds
//                        only steps that carry an `id:`, which is why every gate
//                        step carries one.
//   OS_LANE_JOB_STATUS   `${{ job.status }}` -- `success` unless a step WITHOUT
//                        `continue-on-error` failed (checkout, setup, install,
//                        the gate-family selector, a workspace build): those
//                        stay fail-fast, so their failure means the gates behind
//                        them never ran.
//   GITHUB_JOB           the job id (`lint-repo-tooling`, `typecheck-debt`, ...)
//   GITHUB_WORKFLOW_REF  `owner/repo/<path>@<ref>`; the path names the workflow
//                        file in the checkout, which is the file the runner is
//                        executing (the checkout is the run's own commit).
//
// ## The roster is read from the WORKFLOW, never from the `steps` context
//
// The context only knows steps that have an id. A gate step added with
// `continue-on-error: true` and no `id:` would be absent from it, and a verdict
// that iterated the context would never see that gate -- its red would be the
// silence this file exists to remove. So the roster is every step of THIS job
// whose `continue-on-error` is set, read from the workflow, and a roster entry
// with no id, or with no outcome in the context, is red ("unread"), never a
// pass. A step without `continue-on-error` is not a gate here: its failure
// fails the job on its own, and `OS_LANE_JOB_STATUS` says so.
//
// ## Skipped is two different facts
//
// A gate the run never reached and a gate its own `if:` turned off (the
// gate-family selector's scoped steps) both read `skipped`. They are told
// apart by the two facts that are certain: whether the gate HAS an `if:`, and
// whether the job is still `success`. Only a gate with an `if:` in a job that
// is still `success` counts as turned off by its own condition; every other
// `skipped` is "did not run", which is red.
//
// ## Exit codes
//
//   0  every gate in the roster ran green or was turned off by its own `if:`,
//      and no fail-fast step failed.
//   1  a FINDING: a gate is red, did not run, or cannot be read; or a fail-fast
//      step failed (the job is red already; this names what it hid).
//   3  PREREQUISITE NOT MET -- an input above is absent or unparseable, so
//      nothing was judged. On a runner that is still a red step, which is the
//      point: a verdict that cannot read its lane has not passed it. Run
//      locally, the bare form always lands here; `--self-test` is the local
//      instrument.
//
// ## What it deliberately does NOT do
//
//   * It changes no gate's command and judges nothing about the tree. A gate's
//     own output is in its own step's log; this prints only which ones failed.
//   * It does not call the jobs API. The `steps` context is final for every
//     step before this one when this runs, which the API is not: the
//     unmeasured-tail reporter this replaces had to race the API's own
//     bookkeeping for the same facts (#18874).
//   * It writes the job summary only when the verdict is not green, so a green
//     lane's summary page stays as it was.

import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { EXIT_FINDINGS, EXIT_PREREQUISITE_NOT_MET, requireDependency } from '../import-prerequisite.mjs';
import { isEntrypoint } from '../invoked-as.mjs';

const SCRIPT = 'lane-verdict';
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** A refusal: an input this verdict needs is absent or unreadable. */
class LaneVerdictRefusal extends Error {}

/**
 * `continue-on-error` is set when it is anything but absent or false. An
 * expression (`${{ … }}`) counts as set: whether it evaluates true decides the
 * step's `conclusion`, never its `outcome`, and the outcome is what is read.
 *
 * @param {unknown} value
 */
export function continuesOnError(value) {
  if (value === undefined || value === null || value === false) return false;
  return String(value).trim().toLowerCase() !== 'false';
}

/**
 * The workflow path out of `GITHUB_WORKFLOW_REF` (`owner/repo/<path>@<ref>`).
 *
 * @param {string|undefined} ref
 * @returns {string|null}
 */
export function workflowPathFromRef(ref) {
  const m = /^[^/@\s]+\/[^/@\s]+\/([^@\s]+)@\S+$/.exec(String(ref ?? '').trim());
  return m ? m[1] : null;
}

/**
 * One job's steps, as the workflow declares them, from a parsed workflow
 * document. Throws a refusal when the job or its step list is not there.
 *
 * @param {Record<string, any>} doc  the parsed workflow
 * @param {string} jobId
 * @returns {Array<{ position: number, name: string, id: string|null, cond: string|null, gate: boolean }>}
 */
export function laneSteps(doc, jobId) {
  const job = doc?.jobs?.[jobId];
  if (!job || typeof job !== 'object') {
    throw new LaneVerdictRefusal(`the workflow declares no job \`${jobId}\`, so there is no roster to read`);
  }
  if (!Array.isArray(job.steps) || job.steps.length === 0) {
    throw new LaneVerdictRefusal(`job \`${jobId}\` declares no \`steps:\` list, so there is no roster to read`);
  }
  return job.steps.map((step, i) => {
    const s = step && typeof step === 'object' ? step : {};
    const name =
      typeof s.name === 'string' && s.name.trim() !== ''
        ? s.name.trim()
        : typeof s.uses === 'string'
          ? `(unnamed step: uses ${s.uses})`
          : `(unnamed step #${i + 1})`;
    const id = typeof s.id === 'string' && s.id.trim() !== '' ? s.id.trim() : null;
    const cond = s.if === undefined || s.if === null || String(s.if).trim() === '' ? null : String(s.if).trim();
    return { position: i + 1, name, id, cond, gate: continuesOnError(s['continue-on-error']) };
  });
}

/**
 * The verdict, as a pure function of the roster, the `steps` context and the
 * job status. Never throws: an unreadable input is a `refusal`, which is
 * rendered and exits PREREQUISITE NOT MET.
 *
 * @param {{ steps: ReturnType<typeof laneSteps>, context: unknown, jobStatus: string|undefined }} input
 */
export function judgeLane({ steps, context, jobStatus }) {
  const result = {
    refusal: null,
    gates: [],
    red: [],
    didNotRun: [],
    unread: [],
    skippedByCondition: [],
    passed: [],
    failFast: false,
    jobStatus: String(jobStatus ?? ''),
    ok: false,
  };
  const status = result.jobStatus.trim();
  if (status === '') {
    result.refusal = 'OS_LANE_JOB_STATUS is empty, so whether a fail-fast step failed cannot be read';
    return result;
  }
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    result.refusal = 'OS_LANE_STEPS is not a JSON object, so no gate outcome can be read';
    return result;
  }
  const roster = (Array.isArray(steps) ? steps : []).filter((s) => s.gate);
  if (roster.length === 0) {
    result.refusal =
      'this job declares no `continue-on-error` gate step, so there is nothing to judge -- a verdict over zero ' +
      'gates is not a pass (#4690)';
    return result;
  }

  result.failFast = status !== 'success';
  for (const step of roster) {
    const entry = step.id === null ? undefined : context[step.id];
    let verdict;
    let detail;
    if (step.id === null) {
      verdict = 'unread';
      detail = 'it sets continue-on-error but has no `id:`, so the steps context never carries its outcome';
    } else if (!entry || typeof entry !== 'object' || typeof entry.outcome !== 'string') {
      verdict = 'unread';
      detail = `the steps context carries no outcome for id \`${step.id}\``;
    } else if (entry.outcome === 'success') {
      verdict = 'passed';
    } else if (entry.outcome === 'failure') {
      verdict = 'red';
      detail = 'outcome `failure`';
    } else if (entry.outcome === 'cancelled') {
      verdict = 'red';
      detail = 'outcome `cancelled`';
    } else if (entry.outcome === 'skipped' && step.cond !== null && !result.failFast) {
      verdict = 'skippedByCondition';
      detail = `its own \`if:\` turned it off (${step.cond})`;
    } else if (entry.outcome === 'skipped') {
      verdict = 'didNotRun';
      detail = result.failFast
        ? 'skipped behind a failed fail-fast step'
        : 'skipped, and it carries no `if:` of its own that could have turned it off';
    } else {
      verdict = 'unread';
      detail = `unrecognised outcome \`${entry.outcome}\``;
    }
    const row = { ...step, outcome: entry?.outcome ?? null, verdict, detail: detail ?? null };
    result.gates.push(row);
    result[verdict].push(row);
  }
  result.ok =
    !result.failFast && result.red.length === 0 && result.didNotRun.length === 0 && result.unread.length === 0;
  return result;
}

/** Escape a workflow-command message (the part after `::`). */
export function escapeCommandData(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Escape a workflow-command property value (`title=…`). */
export function escapeCommandProperty(text) {
  return escapeCommandData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * The log lines, the annotations among them. Every gate is listed, green ones
 * included, so the log alone answers "what ran in this lane".
 *
 * @param {ReturnType<typeof judgeLane>} v
 * @param {string} jobId
 * @returns {string[]}
 */
export function renderVerdict(v, jobId) {
  const out = [];
  if (v.refusal) {
    out.push(`::error title=${escapeCommandProperty(`Lane verdict: ${jobId}`)}::${escapeCommandData(
      `NOT MEASURED -- ${v.refusal}. A verdict that cannot read its lane has not passed it.`,
    )}`);
    out.push(`${SCRIPT}: ${jobId}: PREREQUISITE NOT MET -- ${v.refusal}.`);
    return out;
  }
  const tag = { passed: 'ok      ', red: 'RED     ', didNotRun: 'NOT RUN ', unread: 'UNREAD  ', skippedByCondition: 'skipped ' };
  for (const g of v.gates) out.push(`  ${tag[g.verdict]} ${g.name}${g.detail ? `  -- ${g.detail}` : ''}`);
  out.push('');
  if (v.failFast) {
    out.push(
      `::error title=${escapeCommandProperty(`Lane verdict: ${jobId}`)}::${escapeCommandData(
        `a step without continue-on-error failed (job status \`${v.jobStatus}\`), so this lane is red already; ` +
          `${v.didNotRun.length} gate(s) behind it never ran and are NOT MEASURED, not passed.`,
      )}`,
    );
  }
  for (const g of v.red) {
    out.push(`::error title=${escapeCommandProperty(`Red gate: ${g.name}`)}::${escapeCommandData(
      `gate step "${g.name}" (id ${g.id}) failed -- its own log above says why. continue-on-error let the gates ` +
        'behind it run; this verdict keeps the lane red.',
    )}`);
  }
  for (const g of v.unread) {
    out.push(`::error title=${escapeCommandProperty(`Unread gate: ${g.name}`)}::${escapeCommandData(
      `gate step "${g.name}" cannot be read: ${g.detail}. An unread gate is not a pass.`,
    )}`);
  }
  if (!v.failFast) {
    for (const g of v.didNotRun) {
      out.push(`::error title=${escapeCommandProperty(`Gate did not run: ${g.name}`)}::${escapeCommandData(
        `gate step "${g.name}" did not run: ${g.detail}.`,
      )}`);
    }
  }
  const counts =
    `${v.gates.length} gate(s): ${v.passed.length} passed, ${v.red.length} red, ` +
    `${v.didNotRun.length} did not run, ${v.unread.length} unread, ` +
    `${v.skippedByCondition.length} turned off by their own if:`;
  if (v.ok) {
    out.push(`${SCRIPT}: ${jobId}: OK -- ${counts}.`);
  } else {
    const named = v.red.length > 0 ? ` Red: ${v.red.map((g) => g.name).join('; ')}.` : '';
    out.push(`${SCRIPT}: ${jobId}: FAILED -- ${counts}.${named}`);
  }
  return out;
}

/** The same verdict as markdown, for the job summary; written only when not green. */
export function renderSummary(v, jobId) {
  if (v.refusal) return `## Lane verdict: \`${jobId}\`\n\n**NOT MEASURED** -- ${v.refusal}.\n`;
  const rows = v.gates
    .filter((g) => g.verdict !== 'passed')
    .map((g) => `| ${g.verdict === 'skippedByCondition' ? 'skipped (own `if:`)' : g.verdict} | ${g.name.replace(/\|/g, '\\|')} |`);
  return [
    `## Lane verdict: \`${jobId}\``,
    '',
    v.failFast
      ? `A fail-fast step failed (job status \`${v.jobStatus}\`); the gates behind it never ran.`
      : `${v.red.length} red gate(s) out of ${v.gates.length}; every gate ran, so this is a count, not a lower bound.`,
    '',
    '| verdict | gate |',
    '|:--|:--|',
    ...rows,
    '',
  ].join('\n');
}

async function loadWorkflowSteps(workflowPath, jobId) {
  const { parse } = await requireDependency('yaml', () => import('yaml'), import.meta.url);
  let text;
  try {
    text = readFileSync(join(REPO_ROOT, workflowPath), 'utf8');
  } catch (err) {
    throw new LaneVerdictRefusal(`the workflow file \`${workflowPath}\` cannot be read (${err.code ?? err.message})`);
  }
  let doc;
  try {
    doc = parse(text);
  } catch (err) {
    throw new LaneVerdictRefusal(`the workflow file \`${workflowPath}\` does not parse (${err.message.split('\n')[0]})`);
  }
  return laneSteps(doc, jobId);
}

async function main() {
  const jobId = String(process.env.GITHUB_JOB ?? '').trim();
  const workflowPath = workflowPathFromRef(process.env.GITHUB_WORKFLOW_REF);
  let v;
  try {
    if (jobId === '') throw new LaneVerdictRefusal('GITHUB_JOB is not set, so this is not a step of a job');
    if (workflowPath === null) {
      throw new LaneVerdictRefusal('GITHUB_WORKFLOW_REF does not name a workflow file (`owner/repo/<path>@<ref>`)');
    }
    const raw = process.env.OS_LANE_STEPS;
    if (raw === undefined || raw.trim() === '') {
      throw new LaneVerdictRefusal('OS_LANE_STEPS is not set -- pass `${{ toJSON(steps) }}` from the step');
    }
    let context;
    try {
      context = JSON.parse(raw);
    } catch (err) {
      throw new LaneVerdictRefusal(`OS_LANE_STEPS is not JSON (${err.message})`);
    }
    const steps = await loadWorkflowSteps(workflowPath, jobId);
    v = judgeLane({ steps, context, jobStatus: process.env.OS_LANE_JOB_STATUS });
  } catch (err) {
    if (!(err instanceof LaneVerdictRefusal)) throw err;
    v = { refusal: err.message };
  }

  for (const line of renderVerdict(v, jobId || '(no job)')) console.log(line);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!v.ok && summaryFile) {
    try {
      appendFileSync(summaryFile, `${renderSummary(v, jobId || '(no job)')}\n`);
    } catch (err) {
      console.log(`${SCRIPT}: the job summary could not be written (${err.code ?? err.message}); the log above stands.`);
    }
  }
  if (v.refusal) process.exit(EXIT_PREREQUISITE_NOT_MET);
  process.exit(v.ok ? 0 : EXIT_FINDINGS);
}

// ---------------------------------------------------------------------------
// Self-test -- pins the red paths, the outcome-not-conclusion read first.
// ---------------------------------------------------------------------------

// Set only after the verdict line prints; the dispatch refuses when it is unset
// (AGENTS.md, "Writing a --self-test": the handshake).
let selfTestReachedVerdict = false;

// Battery name -> minimum case count. A literal, so a deleted battery names
// itself in the refusal instead of taking its own floor with it.
const SELF_TEST_BATTERIES = Object.freeze({
  'green lanes': 2,
  'outcome, never conclusion': 3,
  'skipped: own condition vs did not run': 4,
  'fail-fast step failed': 2,
  'unread gates': 3,
  'refusals': 4,
  'roster from workflow text': 5,
  'workflow ref parsing': 3,
  'rendering': 5,
});
const SELF_TEST_BATTERY_FLOOR = 9;

async function selfTest() {
  const { parse } = await requireDependency('yaml', () => import('yaml'), import.meta.url);
  const seen = new Map();
  let current = null;
  let failed = 0;
  const battery = (name) => {
    current = name;
  };
  const t = (label, cond) => {
    seen.set(current, (seen.get(current) ?? 0) + 1);
    if (cond) {
      console.log(`  ok    [${current}] ${label}`);
    } else {
      failed += 1;
      console.log(`  FAIL  [${current}] ${label}`);
    }
  };

  const WORKFLOW = [
    'jobs:',
    '  lane:',
    '    steps:',
    '      - name: Checkout repository',
    '        uses: actions/checkout@v7',
    '      - name: Install dependencies',
    '        run: pnpm install --frozen-lockfile',
    '      - name: Select the gate families this run pays for',
    '        id: gate-families',
    '        run: bash select.sh',
    '      - name: Gate one',
    '        id: gate-one',
    '        continue-on-error: true',
    '        run: node one.mjs',
    '      - name: Gate two',
    '        id: gate-two',
    '        continue-on-error: true',
    '        run: node two.mjs',
    "      - name: 'Scoped gate'",
    '        id: scoped-gate',
    "        if: steps.gate-families.outputs.x != 'skip'",
    '        continue-on-error: true',
    '        run: node scoped.mjs',
    '      - name: Lane verdict',
    '        if: ${{ !cancelled() }}',
    '        run: node scripts/ci/lane-verdict.mjs',
  ].join('\n');
  const steps = laneSteps(parse(WORKFLOW), 'lane');
  const ctx = (one, two, scoped, extra = {}) => ({
    'gate-families': { outcome: 'success', conclusion: 'success', outputs: {} },
    'gate-one': { outcome: one, conclusion: one === 'failure' ? 'success' : one, outputs: {} },
    'gate-two': { outcome: two, conclusion: two === 'failure' ? 'success' : two, outputs: {} },
    'scoped-gate': { outcome: scoped, conclusion: scoped === 'failure' ? 'success' : scoped, outputs: {} },
    ...extra,
  });

  battery('green lanes');
  {
    const v = judgeLane({ steps, context: ctx('success', 'success', 'success'), jobStatus: 'success' });
    t('every gate success -> ok', v.ok && v.passed.length === 3 && v.gates.length === 3);
    const w = judgeLane({ steps, context: ctx('success', 'success', 'skipped'), jobStatus: 'success' });
    t('a scoped gate its own if: turned off -> still ok', w.ok && w.skippedByCondition.length === 1);
  }

  battery('outcome, never conclusion');
  {
    // The shape GitHub records for a failed step under continue-on-error:
    // outcome failure, conclusion success. Reading `conclusion` would pass it.
    const v = judgeLane({ steps, context: ctx('failure', 'success', 'success'), jobStatus: 'success' });
    t('outcome failure under conclusion success -> RED', !v.ok && v.red.length === 1 && v.red[0].id === 'gate-one');
    const both = judgeLane({ steps, context: ctx('failure', 'failure', 'success'), jobStatus: 'success' });
    t('two red gates -> both named, in workflow order', both.red.map((g) => g.name).join('|') === 'Gate one|Gate two');
    const cancelled = judgeLane({ steps, context: ctx('success', 'cancelled', 'success'), jobStatus: 'success' });
    t('outcome cancelled -> RED', !cancelled.ok && cancelled.red.length === 1);
  }

  battery('skipped: own condition vs did not run');
  {
    const unconditional = judgeLane({ steps, context: ctx('skipped', 'success', 'success'), jobStatus: 'success' });
    t('a gate with no if: that skipped -> did not run, RED', !unconditional.ok && unconditional.didNotRun.length === 1);
    const behind = judgeLane({ steps, context: ctx('skipped', 'skipped', 'skipped'), jobStatus: 'failure' });
    t('every gate skipped behind a failed fail-fast step -> all did not run', behind.didNotRun.length === 3);
    t('...and a scoped gate there is NOT credited to its own condition', behind.skippedByCondition.length === 0);
    const scoped = judgeLane({ steps, context: ctx('success', 'success', 'skipped'), jobStatus: 'success' });
    t('a scoped gate skipped in a healthy job -> its own condition', scoped.skippedByCondition[0]?.id === 'scoped-gate');
  }

  battery('fail-fast step failed');
  {
    const v = judgeLane({ steps, context: ctx('success', 'success', 'success'), jobStatus: 'failure' });
    t('every gate green but job status failure -> RED (fail-fast)', !v.ok && v.failFast);
    const w = judgeLane({ steps, context: ctx('success', 'success', 'success'), jobStatus: 'cancelled' });
    t('job status cancelled -> RED', !w.ok && w.failFast);
  }

  battery('unread gates');
  {
    const noId = laneSteps(
      parse('jobs:\n  lane:\n    steps:\n      - name: Silent gate\n        continue-on-error: true\n        run: x\n'),
      'lane',
    );
    const v = judgeLane({ steps: noId, context: {}, jobStatus: 'success' });
    t('a continue-on-error step with no id -> UNREAD, RED', !v.ok && v.unread.length === 1 && v.unread[0].name === 'Silent gate');
    const missing = judgeLane({ steps, context: { 'gate-one': { outcome: 'success' } }, jobStatus: 'success' });
    t('ids absent from the steps context -> UNREAD, RED', !missing.ok && missing.unread.length === 2);
    const odd = judgeLane({ steps, context: ctx('success', 'neutral', 'success'), jobStatus: 'success' });
    t('an unrecognised outcome -> UNREAD, RED', !odd.ok && odd.unread.length === 1);
  }

  battery('refusals');
  {
    const none = laneSteps(parse('jobs:\n  lane:\n    steps:\n      - name: A\n        run: x\n'), 'lane');
    t('zero gates -> refusal, never a pass', judgeLane({ steps: none, context: {}, jobStatus: 'success' }).refusal !== null);
    t('context not an object -> refusal', judgeLane({ steps, context: [], jobStatus: 'success' }).refusal !== null);
    t('empty job status -> refusal', judgeLane({ steps, context: ctx('success', 'success', 'success'), jobStatus: '' }).refusal !== null);
    let threw = null;
    try {
      laneSteps(parse(WORKFLOW), 'no-such-job');
    } catch (err) {
      threw = err;
    }
    t('a job the workflow does not declare -> refusal', threw instanceof LaneVerdictRefusal);
  }

  battery('roster from workflow text');
  {
    t('only continue-on-error steps are gates', steps.filter((s) => s.gate).map((s) => s.id).join(',') === 'gate-one,gate-two,scoped-gate');
    t('a fail-fast step with an id is not a gate', steps.find((s) => s.id === 'gate-families')?.gate === false);
    t('a quoted name is read unquoted', steps.some((s) => s.name === 'Scoped gate'));
    t('the if: of a scoped gate is read', steps.find((s) => s.id === 'scoped-gate')?.cond === "steps.gate-families.outputs.x != 'skip'");
    t(
      'continue-on-error: false and an absent key are not gates; an expression is',
      continuesOnError(false) === false && continuesOnError(undefined) === false &&
        continuesOnError('false') === false && continuesOnError(true) === true && continuesOnError('${{ inputs.soft }}') === true,
    );
  }

  battery('workflow ref parsing');
  {
    t('a pull-request ref', workflowPathFromRef('objectstack-ai/objectstack/.github/workflows/lint.yml@refs/pull/1/merge') === '.github/workflows/lint.yml');
    t('a branch ref', workflowPathFromRef('o/r/.github/workflows/ci.yml@refs/heads/main') === '.github/workflows/ci.yml');
    t('no ref -> null', workflowPathFromRef('') === null && workflowPathFromRef(undefined) === null);
  }

  battery('rendering');
  {
    const v = judgeLane({ steps, context: ctx('failure', 'success', 'success'), jobStatus: 'success' });
    const text = renderVerdict(v, 'lane').join('\n');
    t('a red gate is named in an ::error:: annotation', /::error title=Red gate%3A Gate one::/.test(text));
    t('the final line says FAILED and names the red gate', /lane-verdict: lane: FAILED .* Red: Gate one\./.test(text));
    const green = renderVerdict(judgeLane({ steps, context: ctx('success', 'success', 'success'), jobStatus: 'success' }), 'lane');
    t('a green lane prints OK and no annotation', /lane-verdict: lane: OK/.test(green.at(-1)) && !green.some((l) => l.startsWith('::')));
    t('a refusal renders as NOT MEASURED', /NOT MEASURED/.test(renderVerdict({ refusal: 'x' }, 'lane').join('\n')));
    t('annotation escaping', escapeCommandProperty('a:b,c%\n') === 'a%3Ab%2Cc%25%0A');
  }

  // ── The floor: every declared battery ran at least its pinned cases ─────
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floor = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floor.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
  }
  for (const name of seen.keys()) {
    if (!declared.includes(name)) floor.push(`battery "${name}" registered cases but is not declared`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      floor.push(`battery "${name}" registered ${count} case(s), below its pinned ${SELF_TEST_BATTERIES[name]}`);
    }
  }
  for (const line of floor) console.log(`  FAIL  [floor] ${line}`);
  failed += floor.length;

  const cases = [...seen.values()].reduce((a, b) => a + b, 0);
  if (failed > 0) {
    console.log(`\n${SCRIPT} self-test: FAILED (${failed} of ${cases} case(s) and floor checks).`);
    process.exit(EXIT_FINDINGS);
  }
  console.log(`\n${SCRIPT} self-test: OK (${cases} case(s) across ${declared.length} batteries).`);
  selfTestReachedVerdict = true;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    await selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        `\n${SCRIPT} self-test: selfTest() returned without reaching its verdict, so no success line was\n` +
          'printed. Exiting 0 here would report a self-test that never finished as one that passed.',
      );
      process.exit(EXIT_FINDINGS);
    }
  } else {
    await main();
  }
}
