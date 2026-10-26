#!/usr/bin/env node
/**
 * Renders the "Console Performance Budget" PR comment body for
 * `.github/workflows/performance-budget.yml`.
 *
 * Why this is a file and not an inline `script:` block: the bug it fixes
 * (objectui#3152) *was* the rendering logic — an ABSENT measurement was
 * rendered as a `❌ ... Status: FAIL` verdict, so every PR that got a second
 * push (cancelling the first run via `cancel-in-progress`) received a comment
 * asserting a budget failure whose own body showed three empty metrics.
 * Logic embedded in YAML cannot be tested; this file is covered by
 * `scripts/__tests__/render-budget-comment.test.ts`.
 *
 * The contract with the workflow is one output — `budget_status`:
 *
 *   `pass`  the console bundle was measured and is within budget
 *   `fail`  the console bundle was measured and is OVER budget
 *   `error` the budget step ran but produced no trustworthy verdict — nothing
 *           measurable (no `dist` directory, or no JS in it), a ceiling that has
 *           drifted out of range of the regression it must catch, or one the
 *           base branch replaced after this checkout (objectui#6245)
 *   absent  the budget step never ran at all — an earlier step failed, or the
 *           run was cancelled
 *
 * Only `pass` and `fail` are verdicts. `error` and absent mean "not measured",
 * and "not measured" must never render as FAIL: a comment that claims a size
 * regression while showing no size teaches readers to ignore this gate, which
 * would take the real over-budget FAIL down with it.
 */

import fs from 'node:fs';
import { isEntrypoint } from './invoked-as.mjs';

/**
 * The only two statuses that carry a measurement. Kept as an explicit
 * allow-list rather than `status !== 'pass' ? fail : pass` — that inversion is
 * exactly how "no data" became "FAIL".
 */
const MEASURED_STATUSES = new Set(['pass', 'fail']);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {object} input
 * @param {string} [input.status]        `budget_status` output of the budget step
 * @param {string} [input.gzipKb]        measured gzip size of the main entry, in KB
 * @param {string} [input.budgetKb]      the budget the measurement was compared against
 * @param {string} [input.entryFile]     basename of the measured entry chunk
 * @param {string} [input.closureStatus]   `closure_status` written by the closure checker
 * @param {string} [input.closureGzipKb]  measured gzip size of the eager closure, in KB
 * @param {string} [input.closureBudgetKb] the closure ceiling it was compared against
 * @param {string} [input.closureChunks]  how many chunks the eager closure spans
 * @param {string} [input.closureChunkStatus]    `closure_chunk_status` — the per-chunk half
 * @param {string} [input.closureMembershipStatus] `closure_membership_status` — the membership half
 * @param {string} [input.closureHeadroomStatus] `closure_headroom_status` — the sensitivity half
 * @param {string} [input.closureFreshnessStatus] `closure_freshness_status` — the freshness half
 * @param {string} [input.message]       human-readable reason when `status` is `error`
 * @param {string} [input.budgetOutcome] `steps.budget.outcome`
 * @param {string} [input.buildOutcome]  `steps.build_packages.outcome`
 * @param {string} [input.sizeReport]    contents of `size-report.md`, empty when not generated
 * @param {string} [input.runUrl]        link to the workflow run
 * @returns {{ kind: 'pass' | 'fail' | 'not-measured', body: string }}
 */
export function renderBudgetComment(input = {}) {
  const status = text(input.status);
  const gzipKb = text(input.gzipKb);
  const budgetKb = text(input.budgetKb);
  const entryFile = text(input.entryFile);
  const sizeReport = text(input.sizeReport);
  const closure = {
    status: text(input.closureStatus),
    gzipKb: text(input.closureGzipKb),
    budgetKb: text(input.closureBudgetKb),
    chunks: text(input.closureChunks),
    chunkStatus: text(input.closureChunkStatus),
    membershipStatus: text(input.closureMembershipStatus),
    headroomStatus: text(input.closureHeadroomStatus),
    freshnessStatus: text(input.closureFreshnessStatus),
  };

  // A verdict needs an affirmative status AND the numbers that status was
  // derived from. A real over-budget failure always arrives with a
  // measurement; "every metric empty" is the discriminator for "never ran".
  const measured =
    MEASURED_STATUSES.has(status) && gzipKb !== '' && budgetKb !== '' && entryFile !== '';

  const body = measured
    ? verdictBody({ status, gzipKb, budgetKb, entryFile, sizeReport, closure })
    : notMeasuredBody({
        message: text(input.message),
        budgetOutcome: text(input.budgetOutcome),
        buildOutcome: text(input.buildOutcome),
        sizeReport,
        runUrl: text(input.runUrl),
        closure,
      });

  return { kind: measured ? status : 'not-measured', body };
}

/**
 * The eager-closure checker evaluates several halves and publishes a verdict
 * for each. The step's exit code folds them all into ONE `budget_status`, so a
 * comment that renders only that says "something objected" and sends the reader
 * to the job log to learn which — the aggregate total, one chunk, a budgeted
 * package that landed outside its declared chunk (objectui#9345), a ceiling that
 * has stopped measuring anything (objectui#6230), or a ceiling the base branch
 * replaced after this checkout (objectui#6245). These labels name the halves the
 * way the step log names them.
 *
 * The optional third element overrides the verdict wording for one half.
 * Freshness needs it: `⚠️ broken gauge` would be FALSE there — the gauge is
 * fine, it was simply pointed at a retired number — and a reader who takes
 * "broken gauge" at face value goes looking for a report that cannot be read.
 */
const FRESHNESS_HALF = 'freshnessStatus';

const CLOSURE_HALVES = [
  ['status', 'Aggregate closure ceiling'],
  ['chunkStatus', 'Per-chunk ceilings'],
  ['membershipStatus', 'Per-chunk membership (declared packages)'],
  ['headroomStatus', 'Ceiling sensitivity (headroom)'],
  [
    FRESHNESS_HALF,
    'Ceiling freshness (checkout vs. base branch)',
    // Spelled out rather than spread from HALF_VERDICT: that constant is
    // declared below this one, and a spread here would read it in its temporal
    // dead zone. `fail` is absent because this half cannot produce one — it
    // answers pass / error / not-applicable, and an unexpected status falls
    // through to `halfVerdict`'s raw spelling rather than being dressed up.
    { pass: '✅ pass', error: '⚠️ superseded ceiling' },
  ],
];

/**
 * `error` is deliberately NOT worded as a size verdict. It is what exit 2 means
 * in the checker: the report cannot be trusted, or a ceiling has drifted out of
 * range of the regression it must catch. Nothing grew.
 */
const HALF_VERDICT = {
  pass: '✅ pass',
  fail: '❌ over its ceiling',
  error: '⚠️ broken gauge',
};

const halfVerdict = (status, verdicts = HALF_VERDICT) => verdicts[status] ?? `\`${status}\``;

/**
 * Renders the per-half breakdown, and renders NOTHING in the two cases where it
 * would be noise:
 *
 *   - every half passed — the healthy comment stays byte-for-byte what it was.
 *     An observability change that rewrites the green output is a regression;
 *   - no half status was handed over — a caller that does not pass them gets
 *     silence, never a table of blanks inferred into verdicts, which is the
 *     objectui#3152 failure mode this whole file exists to prevent.
 */
function closureHalfLines(closure) {
  const rows = CLOSURE_HALVES.map(([key, label, verdicts]) => [
    key,
    label,
    closure[key] ?? '',
    verdicts,
  ]).filter(([, , status]) => status !== '');
  if (rows.length === 0 || rows.every(([, , status]) => status === 'pass')) {
    return [];
  }
  const lines = [
    '**Which half objected:**',
    '',
    '| Eager-closure half | Verdict |',
    '|--------------------|---------|',
    ...rows.map(([, label, status, verdicts]) => `| ${label} | ${halfVerdict(status, verdicts)} |`),
    '',
  ];
  // The two notes are mutually exclusive per half and BOTH can appear, because
  // they say opposite things about the same exit code. Emitting the broken-gauge
  // wording for a freshness error would deny a measurement this run actually
  // took — the objectui#6230 mistake, one level in.
  if (rows.some(([key, , status]) => status === 'error' && key !== FRESHNESS_HALF)) {
    lines.push(
      '> ⚠️ A **broken gauge** half is a verdict about the ceiling, not about the bundle: that line has drifted out of range of the regression it exists to catch, or the report behind it cannot be trusted. It does not say anything grew. The `Check console performance budget` step log carries the ceiling and the number it was compared against.',
      '',
    );
  }
  if (rows.some(([key, , status]) => key === FRESHNESS_HALF && status === 'error')) {
    lines.push(
      '> ⚠️ A **superseded ceiling** is neither a size regression nor a drifted gauge. The bundle was measured correctly and the ceilings on the base branch are correct — but this checkout predates a change to them, so the verdicts above were weighed against numbers that are no longer in force. **Nothing grew.** Update this branch onto the base branch and let `Bundle Analysis` run again; do not widen a ceiling to clear it. The `Check console performance budget` step log names each superseded constant with both values (objectui#6245).',
      '',
    );
  }
  return lines;
}

function verdictBody({ status, gzipKb, budgetKb, entryFile, sizeReport, closure }) {
  const pass = status === 'pass';
  const closureMeasured = closure.gzipKb !== '' && closure.budgetKb !== '';
  const lines = [
    `## ${pass ? '✅' : '❌'} Console Performance Budget`,
    '',
    '| Metric | Value | Budget |',
    '|--------|-------|--------|',
    closureMeasured
      ? `| **Eager closure** (gzip${closure.chunks ? `, ${closure.chunks} chunks` : ''}) | **${closure.gzipKb} KB** | ${closure.budgetKb} KB |`
      : '| **Eager closure** (gzip) | _not measured_ | — |',
    `| Main entry chunk (gzip) | ${gzipKb} KB | ${budgetKb} KB |`,
    `| Entry file | \`${entryFile}\` | — |`,
    `| Status | **${pass ? 'PASS' : 'FAIL'}** | — |`,
    '',
    // The closure is the number that governs a page load; the entry chunk is
    // ~1% of it. Saying so in the comment is what stops the entry figure from
    // being read as "the bundle" the way it was for the whole life of this
    // gate (objectui#5324).
    'The **eager closure** is every chunk the entry reaches through static imports — what the browser fetches and parses before the app renders. The entry chunk on its own is a small fraction of it.',
    '',
    ...closureHalfLines(closure),
  ];
  if (!closureMeasured) {
    // Never let an absent closure figure render as a quiet table with one row.
    // A comment that shows only the entry number, silently, IS the old gauge.
    lines.push(
      '> ⚠️ The eager closure was **not measured** in this run, so this verdict covers the entry chunk only — roughly 1% of what a page load costs. Check the `Check console performance budget` step log: the report is written by `emitEagerClosureReport` in `apps/console/vite.config.ts` during the console build.',
      '',
    );
  }
  return withSizeReport(lines.join('\n'), sizeReport);
}

function notMeasuredBody({
  message,
  budgetOutcome,
  buildOutcome,
  sizeReport,
  runUrl,
  closure = {},
}) {
  // objectui#6230: `error` does not always mean "nothing was measured". A
  // ceiling that has drifted out of range of the regression it must catch is
  // exit 2 with a perfectly good measurement behind it, and then the "nothing
  // was measured" wording below is FALSE — the comment would deny a measurement
  // in the same breath as the half table showing two ceilings that passed on
  // one. Discriminate on the same emptiness the verdict branch keys on: the
  // checker publishes `closure_gzip_kb` EMPTY when it has no report, never as a
  // stale number, and that is pinned by its own tests.
  const closureMeasured = (closure.gzipKb ?? '') !== '' && (closure.budgetKb ?? '') !== '';
  const lines = closureMeasured
    ? [
        '## ⚠️ Console Performance Budget — gauge not trustworthy',
        '',
        'The eager closure was measured, but one of the ceilings it is measured against no longer means what it names, so this run carries **no pass/fail verdict** for the performance budget.',
        '',
        '**This is not a budget violation.** Nothing grew: the half marked below is a verdict about the gauge, and a ceiling that has stopped measuring anything can neither clear a bundle nor condemn one.',
        '',
      ]
    : [
        '## ℹ️ Console Performance Budget — not measured',
        '',
        'This run did not produce a console bundle to measure, so there is **no pass/fail verdict** for the performance budget.',
        '',
        '**This is not a budget violation.** Nothing was measured — the numbers a real violation would carry are simply absent.',
        '',
      ];
  lines.push(
    '| Step | Outcome |',
    '|------|---------|',
    `| Build packages | \`${outcome(buildOutcome)}\` |`,
    `| Check console performance budget | \`${outcome(budgetOutcome)}\` |`,
    '',
    // Exit 2 — a drifted ceiling, or a report that cannot be trusted — maps to
    // `budget_status=error`, and error lands HERE rather than in the verdict
    // body. So this branch needs the halves as much as that one does: they are
    // the only thing in the comment that says WHICH gauge is broken.
    ...closureHalfLines(closure),
  );

  if (message) {
    lines.push(`Reason: ${message}`, '');
  }
  if (runUrl) {
    lines.push(`See the [workflow run](${runUrl}) for details.`, '');
  }

  return withSizeReport(lines.join('\n'), sizeReport);
}

const outcome = (value) => value || 'unknown';

/**
 * `size-report.md` is only generated when every package finished building, so
 * an absent report is expected on an incomplete run — and is called out rather
 * than silently omitted, because a truncated report reads exactly like a
 * complete one (objectui#3152: 7 packages missing, no indication of it).
 */
function withSizeReport(body, sizeReport) {
  if (sizeReport) {
    return `${body}\n---\n\n${sizeReport}\n`;
  }
  return `${body}\n_No package size report: it is only generated from a complete package build, so a partial one is never shown._\n`;
}

/** Reads `size-report.md` if the report step produced one. */
function readSizeReport(path = 'size-report.md') {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export function renderFromEnv(env = process.env, sizeReportPath = 'size-report.md') {
  const serverUrl = env.GITHUB_SERVER_URL;
  const repository = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  return renderBudgetComment({
    status: env.BUDGET_STATUS,
    message: env.BUDGET_MESSAGE,
    gzipKb: env.BUDGET_GZIP_KB,
    budgetKb: env.BUDGET_LIMIT_KB,
    entryFile: env.BUDGET_ENTRY_FILE,
    closureStatus: env.BUDGET_CLOSURE_STATUS,
    closureGzipKb: env.BUDGET_CLOSURE_GZIP_KB,
    closureBudgetKb: env.BUDGET_CLOSURE_BUDGET_KB,
    closureChunks: env.BUDGET_CLOSURE_CHUNKS,
    closureChunkStatus: env.BUDGET_CLOSURE_CHUNK_STATUS,
    closureMembershipStatus: env.BUDGET_CLOSURE_MEMBERSHIP_STATUS,
    closureHeadroomStatus: env.BUDGET_CLOSURE_HEADROOM_STATUS,
    closureFreshnessStatus: env.BUDGET_CLOSURE_FRESHNESS_STATUS,
    budgetOutcome: env.BUDGET_STEP_OUTCOME,
    buildOutcome: env.BUILD_PACKAGES_OUTCOME,
    sizeReport: readSizeReport(sizeReportPath),
    runUrl: serverUrl && repository && runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : '',
  });
}

// CLI: write the comment body to stdout for the workflow to capture.
if (isEntrypoint(import.meta.url)) {
  const { kind, body } = renderFromEnv();
  process.stderr.write(`Rendered performance budget comment (kind: ${kind})\n`);
  process.stdout.write(body);
}
