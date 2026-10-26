import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494.
import { renderBudgetComment, renderFromEnv } from '../render-budget-comment.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(repoRoot, '.github/workflows/performance-budget.yml');
const rendererPath = path.join(repoRoot, 'scripts/render-budget-comment.mjs');
const checkerPath = path.join(repoRoot, 'scripts/check-eager-closure-budget.mjs');
const NO_SUCH_REPORT = path.join(repoRoot, 'scripts/__tests__/__no-size-report__.md');

/**
 * objectui#3152: a cancelled Bundle Analysis run posted
 * "❌ Console Performance Budget / Status: FAIL" with all three metrics empty.
 * The measurement had never happened — `cancel-in-progress` had killed the run
 * — but the renderer treated "not `pass`" as "FAIL". Every PR that got a second
 * push within one build therefore received a fake budget alarm.
 *
 * The invariant these tests pin: FAIL is rendered only when the bundle was
 * measured AND found over budget. Everything else renders as "not measured",
 * never as a verdict.
 */
describe('renderBudgetComment', () => {
  const measured = {
    gzipKb: '28.1',
    budgetKb: '350',
    entryFile: 'index-BRKCVm_4.js',
    // The eager closure — the metric that actually governs a page load
    // (objectui#5324). A measured run now always carries both.
    closureStatus: 'pass',
    closureGzipKb: '3790.6',
    closureBudgetKb: '3867.2',
    closureChunks: '58',
  };

  it('renders PASS with the measurement when the bundle is within budget', () => {
    const { kind, body } = renderBudgetComment({ status: 'pass', ...measured });

    expect(kind).toBe('pass');
    expect(body).toContain('## ✅ Console Performance Budget');
    expect(body).toContain('| **Eager closure** (gzip, 58 chunks) | **3790.6 KB** | 3867.2 KB |');
    expect(body).toContain('| Main entry chunk (gzip) | 28.1 KB | 350 KB |');
    expect(body).toContain('| Entry file | `index-BRKCVm_4.js` | — |');
    expect(body).toContain('| Status | **PASS** | — |');
    expect(body).not.toContain('FAIL');
  });

  it('still renders a full FAIL verdict when the bundle IS over budget', () => {
    const { kind, body } = renderBudgetComment({
      ...measured,
      status: 'fail',
      gzipKb: '412.7',
    });

    expect(kind).toBe('fail');
    expect(body).toContain('## ❌ Console Performance Budget');
    expect(body).toContain('| Main entry chunk (gzip) | 412.7 KB | 350 KB |');
    expect(body).toContain('| Status | **FAIL** | — |');
    // The real signal must stay unambiguous — no hedging language on a
    // genuine violation.
    expect(body).not.toContain('not measured');
  });

  // The regression itself: run 30699128418 (`cancelled`) vs 30699202638
  // (`success`) on the same commit gave FAIL and PASS respectively.
  it('does NOT render FAIL when the budget step never ran (cancelled run)', () => {
    const { kind, body } = renderBudgetComment({
      status: '',
      gzipKb: '',
      budgetKb: '',
      entryFile: '',
      budgetOutcome: 'skipped',
      buildOutcome: 'cancelled',
    });

    expect(kind).toBe('not-measured');
    expect(body).not.toContain('FAIL');
    expect(body).not.toContain('❌');
    expect(body).toContain('## ℹ️ Console Performance Budget — not measured');
    expect(body).toContain('**This is not a budget violation.**');
    // The empty-metric table that made the fake alarm look like a report.
    expect(body).not.toContain('| Main entry chunk (gzip) |  KB |');
    expect(body).not.toContain('| **Eager closure** (gzip) | ** KB** |');
  });

  it.each([
    ['dist directory missing', 'Build output not found at apps/console/dist/assets'],
    ['no JS files in dist', 'No JS files found in apps/console/dist/assets'],
  ])('reports "not measured" with the reason when the budget step errors (%s)', (_label, message) => {
    const { kind, body } = renderBudgetComment({
      status: 'error',
      message,
      budgetOutcome: 'failure',
      buildOutcome: 'success',
    });

    expect(kind).toBe('not-measured');
    expect(body).not.toContain('FAIL');
    expect(body).toContain(`Reason: ${message}`);
    expect(body).toContain('| Check console performance budget | `failure` |');
    expect(body).toContain('| Build packages | `success` |');
  });

  it('treats a status without its measurement as not measured, never as FAIL', () => {
    // Defensive: if the producer ever writes `budget_status` without the
    // numbers, the consumer must not manufacture a verdict out of it.
    for (const partial of [
      { status: 'fail', gzipKb: '', budgetKb: '350', entryFile: 'index.js' },
      { status: 'fail', gzipKb: '412.7', budgetKb: '', entryFile: 'index.js' },
      { status: 'pass', gzipKb: '28.1', budgetKb: '350', entryFile: '' },
    ]) {
      const { kind, body } = renderBudgetComment(partial);
      expect(kind).toBe('not-measured');
      expect(body).not.toContain('| Status | **FAIL** | — |');
    }
  });

  /**
   * objectui#5324: this comment reported the `index-*.js` entry chunk and
   * called it "the performance budget". On `77f846a8b` that chunk is 25.9 KB
   * gzipped while the closure it statically pulls in is 3,790.6 KB — 0.67% of
   * the payload — and the 89 KiB regression of objectui#5266 landed outside it.
   *
   * The invariant these pin: the closure is the number the comment leads with,
   * and an ABSENT closure figure is stated, never silently dropped. A one-row
   * table showing only the entry chunk IS the old gauge, and it reads as a
   * complete report.
   */
  it('leads with the eager closure and de-emphasises the entry chunk', () => {
    const { body } = renderBudgetComment({ status: 'pass', ...measured });

    const closureRow = body.indexOf('| **Eager closure**');
    const entryRow = body.indexOf('| Main entry chunk (gzip)');
    expect(closureRow).toBeGreaterThan(-1);
    expect(entryRow).toBeGreaterThan(closureRow);
    // The entry chunk keeps its row and its 350 KB line — replacing the gauge
    // is not licence to drop the check that was already there.
    expect(body).toContain('| Main entry chunk (gzip) | 28.1 KB | 350 KB |');
    expect(body).toContain('what the browser fetches and parses before the app renders');
  });

  it('says so loudly when the closure was not measured, instead of showing the entry chunk alone', () => {
    const { kind, body } = renderBudgetComment({
      status: 'pass',
      gzipKb: '28.1',
      budgetKb: '350',
      entryFile: 'index-BRKCVm_4.js',
    });

    expect(kind).toBe('pass');
    expect(body).toContain('| **Eager closure** (gzip) | _not measured_ | — |');
    expect(body).toContain('was **not measured** in this run');
    expect(body).toContain('emitEagerClosureReport');
  });

  it('carries no hedging language when both metrics are present on a real violation', () => {
    const { body } = renderBudgetComment({ ...measured, status: 'fail', gzipKb: '412.7' });
    expect(body).not.toContain('not measured');
  });

  it('omits the chunk count from the closure row rather than printing an empty one', () => {
    const { body } = renderBudgetComment({
      status: 'pass',
      ...measured,
      closureChunks: '',
    });
    expect(body).toContain('| **Eager closure** (gzip) | **3790.6 KB** | 3867.2 KB |');
    expect(body).not.toContain(', chunks)');
  });

  it('appends the package size report when one was generated', () => {
    const sizeReport = '## 📦 Bundle Size Report\n\n| Package | Size | Gzipped |';
    const { body } = renderBudgetComment({ status: 'pass', ...measured, sizeReport });

    expect(body).toContain('---\n\n## 📦 Bundle Size Report');
    expect(body).not.toContain('No package size report');
  });

  it('says the size report is missing rather than silently omitting it', () => {
    // A partial report reads exactly like a complete one — the cancelled run in
    // objectui#3152 shipped a report that was silently missing 7 packages.
    const { body } = renderBudgetComment({ status: 'pass', ...measured, sizeReport: '' });

    expect(body).toContain('No package size report');
    expect(body).toContain('only generated from a complete package build');
  });
});

/**
 * objectui#6230: the closure checker evaluates THREE halves — the aggregate
 * ceiling, the per-chunk ceilings (objectui#5490) and ceiling sensitivity
 * (objectui#5924) — and publishes a verdict for each. The step's exit code
 * folds all three into one `budget_status`, so a comment rendering only that
 * says "something objected" and nothing more: a reader had to open the job log
 * to learn whether the total grew, one chunk grew, or a ceiling had stopped
 * measuring anything.
 *
 * The per-chunk case is the one the whole gate family exists for. objectui#5266
 * was a 89 KiB regression that landed OUTSIDE the entry chunk and inside the
 * aggregate ceiling's headroom — exactly the shape where both numbers the
 * comment prints are green and the verdict is still FAIL.
 */
describe('per-half closure verdicts', () => {
  const halves = {
    gzipKb: '28.1',
    budgetKb: '350',
    entryFile: 'index-BRKCVm_4.js',
    closureGzipKb: '3222.6',
    closureBudgetKb: '3266.6',
    closureChunks: '58',
    closureStatus: 'pass',
    closureChunkStatus: 'pass',
    closureHeadroomStatus: 'pass',
  };

  /**
   * The load-bearing leg. An observability change that rewrites the HEALTHY
   * output is a regression: every green PR comment in the repo would change
   * shape to report nothing new.
   */
  it('adds nothing at all to the comment when every half passed', () => {
    const { kind, body } = renderBudgetComment({ status: 'pass', ...halves });

    expect(kind).toBe('pass');
    expect(body).not.toContain('Which half objected');
    expect(body).not.toContain('Eager-closure half');
    expect(body).toContain('| Status | **PASS** | — |');
    expect(body).not.toContain('FAIL');
  });

  it('names the AGGREGATE half when the total is over its ceiling', () => {
    const { body } = renderBudgetComment({
      status: 'fail',
      ...halves,
      closureGzipKb: '3400.0',
      closureStatus: 'fail',
    });

    expect(body).toContain('**Which half objected:**');
    expect(body).toContain('| Aggregate closure ceiling | ❌ over its ceiling |');
    expect(body).toContain('| Per-chunk ceilings | ✅ pass |');
    expect(body).toContain('| Ceiling sensitivity (headroom) | ✅ pass |');
  });

  /**
   * The objectui#5266 shape. Note the numbers here are IDENTICAL to the
   * all-pass case above: before this wiring the two comments differed only in
   * `PASS` vs `FAIL`, with both printed metrics comfortably inside budget and
   * nothing anywhere in the body saying why.
   */
  it('names the PER-CHUNK half when one chunk is over while the total is not', () => {
    const { kind, body } = renderBudgetComment({
      status: 'fail',
      ...halves,
      closureChunkStatus: 'fail',
    });

    expect(kind).toBe('fail');
    // Both printed metrics are green; only the half table explains the FAIL.
    expect(body).toContain('| **Eager closure** (gzip, 58 chunks) | **3222.6 KB** | 3266.6 KB |');
    expect(body).toContain('| Status | **FAIL** | — |');
    expect(body).toContain('| Per-chunk ceilings | ❌ over its ceiling |');
    expect(body).toContain('| Aggregate closure ceiling | ✅ pass |');
  });

  /**
   * A drifted ceiling is exit 2, which `performance-budget.yml` maps to
   * `budget_status=error` — so it lands in the NOT-MEASURED branch, not the
   * verdict branch. It must read as a verdict about the gauge, and must never
   * acquire a ❌: nothing grew.
   */
  it('names a drifted ceiling as a broken GAUGE, never as a size failure', () => {
    const { kind, body } = renderBudgetComment({
      status: 'error',
      ...halves,
      closureHeadroomStatus: 'error',
      message: 'the eager-closure gauge produced no trustworthy measurement',
      budgetOutcome: 'failure',
      buildOutcome: 'success',
    });

    expect(kind).toBe('not-measured');
    expect(body).toContain('| Ceiling sensitivity (headroom) | ⚠️ broken gauge |');
    expect(body).toContain('a verdict about the ceiling, not about the bundle');
    expect(body).not.toContain('❌');
    expect(body).not.toContain('FAIL');
    // The closure WAS measured on this path, so the comment must not claim the
    // opposite two lines above a table showing two ceilings that passed.
    expect(body).not.toContain('Nothing was measured');
    expect(body).toContain('gauge not trustworthy');
  });

  it('keeps the "not measured" wording when nothing really was measured', () => {
    // dist missing / no JS / cancelled: the checker never ran, so it published
    // no closure numbers. This branch must be untouched by the above.
    const { kind, body } = renderBudgetComment({
      status: 'error',
      message: 'Build output not found at apps/console/dist/assets',
      budgetOutcome: 'failure',
      buildOutcome: 'success',
    });

    expect(kind).toBe('not-measured');
    expect(body).toContain('## ℹ️ Console Performance Budget — not measured');
    expect(body).toContain('Nothing was measured');
    expect(body).not.toContain('Which half objected');
  });

  /**
   * objectui#6245 — the fourth half. Also exit 2, also the not-measured branch,
   * and it must NOT borrow the drifted-ceiling wording above: the gauge is fine
   * here and the bundle is fine; the ceiling they were weighed against has been
   * replaced on the base branch. A reader who takes "broken gauge" at face value
   * goes hunting a report that cannot be read, and one who takes it for a size
   * failure widens a ceiling — the one repair this must never suggest.
   */
  it('names a superseded ceiling as its own verdict, not as a broken gauge', () => {
    const { kind, body } = renderBudgetComment({
      status: 'error',
      ...halves,
      closureFreshnessStatus: 'error',
      message: 'a ceiling was replaced on the base branch after this checkout was made',
      budgetOutcome: 'failure',
      buildOutcome: 'success',
    });

    expect(kind).toBe('not-measured');
    expect(body).toContain('| Ceiling freshness (checkout vs. base branch) | ⚠️ superseded ceiling |');
    expect(body).toContain('neither a size regression nor a drifted gauge');
    expect(body).toContain('Nothing grew');
    expect(body).toContain('do not widen a ceiling to clear it');
    // The OTHER exit-2 note is about a different thing and must stay away.
    expect(body).not.toContain('a verdict about the ceiling, not about the bundle');
    expect(body).not.toContain('❌');
    expect(body).not.toContain('FAIL');
  });

  it('keeps the two exit-2 notes separate when both halves object', () => {
    const { body } = renderBudgetComment({
      status: 'error',
      ...halves,
      closureHeadroomStatus: 'error',
      closureFreshnessStatus: 'error',
      budgetOutcome: 'failure',
      buildOutcome: 'success',
    });

    expect(body).toContain('| Ceiling sensitivity (headroom) | ⚠️ broken gauge |');
    expect(body).toContain('| Ceiling freshness (checkout vs. base branch) | ⚠️ superseded ceiling |');
    expect(body).toContain('a verdict about the ceiling, not about the bundle');
    expect(body).toContain('neither a size regression nor a drifted gauge');
  });

  it('renders no freshness row on a run the half does not apply to', () => {
    // The checker publishes an EMPTY freshness verdict off a pull_request. An
    // empty half is silence, and a green comment must stay byte-for-byte what
    // it was before this half existed.
    const { body } = renderBudgetComment({
      status: 'fail',
      ...halves,
      closureChunkStatus: 'fail',
      closureFreshnessStatus: '',
    });

    expect(body).toContain('| Per-chunk ceilings | ❌ over its ceiling |');
    expect(body).not.toContain('Ceiling freshness');
  });

  it('renders no half table when no half status was handed over', () => {
    // The objectui#3152 failure mode, in its per-half form: blanks must render
    // as silence, never be inferred into verdicts.
    const { body } = renderBudgetComment({
      status: 'fail',
      ...halves,
      closureStatus: '',
      closureChunkStatus: '',
      closureHeadroomStatus: '',
      closureFreshnessStatus: '',
    });

    expect(body).not.toContain('Which half objected');
    expect(body).not.toContain('| Per-chunk ceilings |');
  });
});

describe('renderFromEnv', () => {
  it('reads the exact env names the workflow sets', () => {
    const { kind, body } = renderFromEnv(
      {
        BUDGET_STATUS: 'pass',
        BUDGET_GZIP_KB: '28.1',
        BUDGET_LIMIT_KB: '350',
        BUDGET_ENTRY_FILE: 'index-BRKCVm_4.js',
        BUDGET_CLOSURE_STATUS: 'pass',
        BUDGET_CLOSURE_GZIP_KB: '3790.6',
        BUDGET_CLOSURE_BUDGET_KB: '3867.2',
        BUDGET_CLOSURE_CHUNKS: '58',
        BUDGET_STEP_OUTCOME: 'success',
        BUILD_PACKAGES_OUTCOME: 'success',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'objectstack-ai/objectui',
        GITHUB_RUN_ID: '30699202638',
      },
      NO_SUCH_REPORT,
    );

    expect(kind).toBe('pass');
    expect(body).toContain('| Main entry chunk (gzip) | 28.1 KB | 350 KB |');
    expect(body).toContain('| **Eager closure** (gzip, 58 chunks) | **3790.6 KB** | 3867.2 KB |');
  });

  it('links the run so a "not measured" note can be checked against the log', () => {
    const { body } = renderFromEnv(
      {
        BUDGET_STATUS: '',
        BUILD_PACKAGES_OUTCOME: 'failure',
        BUDGET_STEP_OUTCOME: 'skipped',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'objectstack-ai/objectui',
        GITHUB_RUN_ID: '30699128418',
      },
      NO_SUCH_REPORT,
    );

    expect(body).toContain(
      'https://github.com/objectstack-ai/objectui/actions/runs/30699128418',
    );
  });

  it('renders without crashing on a completely empty environment', () => {
    const { kind, body } = renderFromEnv({}, NO_SUCH_REPORT);
    expect(kind).toBe('not-measured');
    expect(body).toContain('| Build packages | `unknown` |');
  });
});

/**
 * The renderer can only be correct if the workflow keeps feeding it. These pin
 * the two workflow-level halves of the fix, which no unit test can exercise:
 * the step conditions, and the env contract between the two files.
 */
describe('performance-budget.yml contract', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  // Only the step conditions — prose in `#` comments discusses `always()` and
  // must not be mistaken for a use of it.
  const conditions = [...workflow.matchAll(/^\s*if:\s*(.+)$/gm)].map((m) => m[1]);

  it('never gates a step on always() — it fires on cancelled runs, which measure nothing', () => {
    expect(conditions.filter((c) => c.includes('always()'))).toEqual([]);
  });

  it('gates the size report, the renderer and the comment on !cancelled()', () => {
    // Five: those three, plus the turbo cache report (objectui#12276), which is
    // bookkeeping after the verdict and reports on a red run for the same reason,
    // plus the pinned @objectstack build's save (objectui#12957), bookkeeping after
    // the verdict that keeps the build whatever the verdict was.
    expect(conditions.filter((c) => c.includes('!cancelled()'))).toHaveLength(5);
  });

  it('generates the size report only from a complete package build', () => {
    expect(workflow).toContain(
      "if: ${{ !cancelled() && steps.build_packages.outcome == 'success' }}",
    );
    expect(workflow).toContain('id: build_packages');
  });

  it('never interpolates a step output into the comment JS source', () => {
    // `const status = '${{ steps.budget.outputs.budget_status }}'` is how an
    // absent output became the empty string that rendered as FAIL.
    expect(workflow).not.toMatch(/=\s*'\$\{\{\s*steps\.budget\.outputs/);
  });

  it('passes every env var the renderer reads, and reads every one it passes', () => {
    // The render step's own block: another step's `env:` (the turbo cache
    // report's RESTORED_CACHE_KEY, objectui#12276) is not the renderer's contract.
    const renderStep = workflow.slice(workflow.indexOf('- name: Render performance budget comment'));
    const block = renderStep.slice(0, renderStep.indexOf('- name:', 1));
    expect(block, 'the render step is gone').toContain('scripts/render-budget-comment.mjs');
    const declared = [...block.matchAll(/^\s{10}([A-Z_]+): \$\{\{ steps\./gm)].map((m) => m[1]);

    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(renderer, `renderer must read env.${name}`).toContain(`env.${name}`);
    }
  });

  /**
   * objectui#6230: `closure_chunk_status` (objectui#5490) and
   * `closure_headroom_status` (objectui#5924) were both published to
   * `$GITHUB_OUTPUT` and never read, each following the precedent of the last.
   * The card's explicit ask was that a THIRD round of this not happen — so the
   * obligation is pinned mechanically rather than left to review: a half added
   * to the checker fails here until it reaches the comment.
   */
  it('passes every closure verdict the checker publishes into the comment step', () => {
    const checker = fs.readFileSync(checkerPath, 'utf8');
    const call = checker.slice(checker.lastIndexOf('writeGithubOutput({'));
    const published = [...call.slice(0, call.indexOf('});')).matchAll(/(closure_\w+):/g)].map(
      (m) => m[1],
    );

    // Guard the guard: a regex that matched nothing would pass silently.
    expect(published).toContain('closure_status');
    expect(published).toContain('closure_chunk_status');
    expect(published).toContain('closure_headroom_status');
    expect(published).toContain('closure_freshness_status');
    expect(published).toContain('closure_membership_status');

    for (const key of published) {
      expect(workflow, `workflow must pass steps.budget.outputs.${key} to the comment step`)
        .toContain(`steps.budget.outputs.${key}`);
    }
  });

  /**
   * objectui#6245. The freshness half's inputs do NOT travel as `steps.*` env —
   * they are the checker's, not the comment's — so the env-contract test above
   * cannot see them, and without these three the wiring could rot silently while
   * every other test in this file stayed green. The half would then report
   * `error` on every PR, or, if `GITHUB_EVENT_NAME` stopped being the
   * discriminator, quietly stop asking.
   */
  describe('ceiling freshness inputs', () => {
    const checker = fs.readFileSync(checkerPath, 'utf8');

    it('fetches deep enough to see the base commit the merge ref was built on', () => {
      expect(workflow).toContain('fetch-depth: 2');
    });

    it('resolves both base-branch readings on pull_request runs only', () => {
      expect(workflow).toContain('- name: Resolve the base-branch ceiling constants');
      expect(workflow).toContain("if: ${{ github.event_name == 'pull_request' }}");
    });

    it('exports exactly the variables the checker reads', () => {
      for (const name of [
        'EAGER_CLOSURE_PR_BASE_SOURCE',
        'EAGER_CLOSURE_BASE_SOURCE',
        'EAGER_CLOSURE_PR_BASE_SHA',
        'EAGER_CLOSURE_BASE_SHA',
        'EAGER_CLOSURE_BASE_REF',
      ]) {
        expect(workflow, `workflow must export ${name}`).toContain(`echo "${name}=`);
        expect(checker, `checker must read env.${name}`).toContain(`env.${name}`);
      }
    });

    /**
     * objectui#6245, second and third pass. The freshness half shipped a
     * workflow half that `Bundle Analysis` could never run on: the PR editing it
     * touched no `packages/**` path, so the gate never appeared on its own PR.
     * Adding the YAML to the filters fixed that — and was still not enough. A PR
     * touching only `check-eager-closure-budget.mjs`, the file that computes the
     * verdict and the one this card is about, ALSO did not trigger the gate.
     *
     * The convention measured on `origin/main` is the gate's RUNTIME CLOSURE,
     * not merely its own YAML: `half-state-patrol.yml` lists both the script it
     * runs and `scripts/invoked-as.mjs`, that script's dependency.
     *
     * A wiring bug in any of these is fail-CLOSED — freshness `error`, exit 2 —
     * so an untriggered gate does not fail quietly; it turns a REQUIRED context
     * red on the next `packages/**` PR, belonging to another seat, reading to
     * them as a bundle problem in their own diff.
     */
    const TRIGGER_CLOSURE = [
      '.github/workflows/performance-budget.yml',
      'scripts/check-eager-closure-budget.mjs',
      // The COMPOSITION half (objectui#7479) — WHICH locale catalogues a page
      // load pulls, which the byte half above cannot answer.
      'scripts/check-eager-locale-catalogues.mjs',
      'scripts/render-budget-comment.mjs',
      // `isEntrypoint` decides whether `main()` runs at all — a regression here
      // makes the checker exit 0 having measured nothing.
      'scripts/invoked-as.mjs',
      // The turbo cache report and prune the job runs after its verdict (objectui#12276).
      'scripts/report-turbo-cache.mjs',
      // The pinned @objectstack build the job restores or builds before install (objectui#12957).
      'scripts/objectstack-pin.mjs',
    ];

    it('triggers on its whole runtime closure, so no part of this gate ships unexercised', () => {
      // `#` lines are part of the block — an entry that needs explaining carries
      // its reason inline — and `[ \t]*` rather than `\s*` so the run cannot walk
      // past the end of the list into the next key.
      const filters = [...workflow.matchAll(/^[ \t]*paths:\n((?:[ \t]*(?:- |#).*\n)+)/gm)].map(
        (m) => m[1],
      );
      // Guard the guard: `push` and `pull_request` both carry one, and they must
      // not drift apart — a gate that runs on a PR but not on the merge (or the
      // reverse) is worse than one that runs on neither.
      expect(filters).toHaveLength(2);
      for (const filter of filters) {
        for (const entry of TRIGGER_CLOSURE) {
          expect(filter, `every paths: filter must list ${entry}`).toContain(entry);
        }
      }
    });

    /**
     * The closure is defined by what the JOB EXECUTES, which is why the
     * `__tests__` files are deliberately absent from it: this job runs two
     * `node scripts/*.mjs` commands and never vitest, so a test-only edit cannot
     * move this gate's verdict, and those tests already run on every PR in the
     * root vitest `unit` project. This asserts the definition rather than the
     * list, so the two stay in step.
     */
    it('lists every script the job runs, and nothing it merely tests', () => {
      const invoked = [...workflow.matchAll(/^\s*(?:run: )?node (scripts\/[\w./-]+\.mjs)/gm)].map(
        (m) => m[1],
      );
      expect(invoked.length).toBeGreaterThan(0);
      for (const script of new Set(invoked)) {
        expect(TRIGGER_CLOSURE, `${script} is executed by this job, so it belongs in the closure`)
          .toContain(script);
      }
      expect(TRIGGER_CLOSURE.some((e) => e.includes('__tests__'))).toBe(false);
    });

    it('lets the bundle be measured even when the resolve step fails', () => {
      // The checker turns absent inputs into a freshness ERROR, so failing the
      // job here instead would only cost the run its numbers (objectui#3152).
      const step = workflow.slice(workflow.indexOf('- name: Resolve the base-branch ceiling'));
      const budgetStep = step.indexOf('- name: Check console performance budget');
      expect(step.slice(0, budgetStep)).toContain('continue-on-error: true');
      expect(budgetStep).toBeGreaterThan(-1);
    });
  });

  it('writes budget_status on every path the budget step can exit through', () => {
    // pass, fail, and the two "nothing to measure" errors.
    const statuses = [...workflow.matchAll(/budget_status=(\w+)/g)].map((m) => m[1]);
    expect(new Set(statuses)).toEqual(new Set(['pass', 'fail', 'error']));
  });
});
