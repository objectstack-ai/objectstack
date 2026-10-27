// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * The showcase browser smoke, run in the NIGHTLY `live` tier.
 *
 * `e2e/` holds the Playwright suite that drives the Console (served by the
 * backend at /_console) against the real showcase stack: every nav surface
 * renders cleanly (`e2e/showcase-smoke.spec.ts`), the ADR-0085 detail shapes
 * (`e2e/detail-shapes.spec.ts`) and the selection-bar capability gate
 * (`e2e/bulk-capability-gate.spec.ts`). It used to run in its own scheduled
 * workflow, which filed nothing when it went red, so a red was read by nobody.
 * This file is how the same suite runs under Nightly Tiers instead
 * (`.github/workflows/test-nightly-tiers.yml`): the `*.live.test.*` name puts
 * it in the `live` tier (`scripts/nightly-tiers.mjs`), so a pull request and
 * the merge queue never collect it, and a red night files a card through that
 * workflow's report job, which names this file.
 *
 * It does not restate a single assertion. It runs `playwright test` with this
 * package's own `playwright.config.ts` — which boots the backend through its
 * `webServer` and signs in through `e2e/global-setup.ts` — and passes only when
 * Playwright's own JSON report says every test passed and at least one ran.
 * `pnpm test:smoke` stays the way to run the suite by hand.
 *
 * Prerequisites, which this file does not build (a test that ran a 5-minute
 * build would hide the build's failure inside its own): the showcase's
 * dependency closure built (`turbo run test` builds it), the Console SPA built
 * (`pnpm console:build`), and a Chromium that this `@playwright/test` can
 * launch (`pnpm exec playwright install chromium`, or
 * `OS_TEST_CHROMIUM_EXECUTABLE_PATH`). The nightly workflow prepares all three
 * on the shard that carries this package. A run missing one fails every test
 * at once; the failure text below says so, because a uniform red is an
 * environment reading, not a product finding
 * (docs/qa/platform-checklist/RUNNER.md, "Environment facts").
 */

// `process.cwd()` is this package's established seed for its own files
// (`test/vitest-console-teardown-race.test.ts` says why `import.meta.url` is
// not available here).
const PACKAGE_ROOT = process.cwd();
const PLAYWRIGHT_BIN = `${PACKAGE_ROOT}/node_modules/.bin/playwright`;
const PLAYWRIGHT_CONFIG = `${PACKAGE_ROOT}/playwright.config.ts`;

/**
 * The whole suite's wall budget. The scheduled workflow this replaces ran it
 * in 85s of test time behind a 180s `webServer` boot allowance, and gave the
 * job 45 minutes; 20 minutes keeps the nightly shard's own 45-minute limit out
 * of reach, so a hang fails as this test, with its report, and not as a
 * killed shard with none.
 */
const SUITE_BUDGET_MS = 20 * 60_000;

/**
 * Each run boots its own backend on its own port. `playwright.config.ts`
 * reads `SMOKE_API_URL` for the sign-in, the `baseURL` and the `webServer`
 * port alike; with `CI` set it never reuses a server it finds there, so a
 * developer's `pnpm dev` on :3000 can neither be attached to nor collide.
 */
const smokePort = (): number => 41_000 + Math.floor(Math.random() * 4_000);

interface ReportTest {
  readonly status?: string;
}
interface ReportSpec {
  readonly title?: string;
  readonly file?: string;
  readonly tests?: readonly ReportTest[];
}
interface ReportSuite {
  readonly suites?: readonly ReportSuite[];
  readonly specs?: readonly ReportSpec[];
}
interface PlaywrightReport {
  readonly stats?: { readonly expected?: number; readonly unexpected?: number; readonly flaky?: number; readonly skipped?: number };
  readonly suites?: readonly ReportSuite[];
  readonly errors?: readonly { readonly message?: string }[];
}

/** `file › title` of every spec whose test Playwright called `unexpected`. */
function failingSpecs(suites: readonly ReportSuite[] = []): string[] {
  const out: string[] = [];
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      if ((spec.tests ?? []).some((t) => t.status === 'unexpected')) out.push(`${spec.file ?? '?'} › ${spec.title ?? '?'}`);
    }
    out.push(...failingSpecs(suite.suites));
  }
  return out;
}

describe('showcase browser smoke (live tier)', () => {
  it(
    'every Playwright test in e2e/ passes against the real showcase stack',
    () => {
      expect(existsSync(PLAYWRIGHT_BIN), `${PLAYWRIGHT_BIN} is missing: install the workspace`).toBe(true);

      const scratch = mkdtempSync(`${tmpdir()}/showcase-smoke-`);
      const reportFile = `${scratch}/report.json`;
      // The child is not a vitest worker: drop vitest's own variables, as the
      // teardown-race pin does for its nested run.
      const env: Record<string, string | undefined> = { ...process.env };
      for (const key of Object.keys(env)) {
        if (key.startsWith('VITEST')) delete env[key];
      }
      delete env.FORCE_COLOR;
      env.NO_COLOR = '1';
      // `CI` selects the config's CI posture: one retry (a flaky-green is
      // reported as `flaky`, never as a pass that hides it) and no reuse of a
      // server already on the port. Set explicitly because turbo's strict env
      // mode does not pass the runner's own `CI` through to a test task.
      env.CI = '1';
      env.SMOKE_API_URL = env.SMOKE_API_URL || `http://localhost:${smokePort()}`;
      env.PLAYWRIGHT_JSON_OUTPUT_NAME = reportFile;

      try {
        // `list` streams one line per test to this process's stdout — the
        // stall guard around the nightly's test step reads output to tell a
        // slow suite from a hung one; `json` is the verdict read below.
        const run = spawnSync(
          PLAYWRIGHT_BIN,
          ['test', `--config=${PLAYWRIGHT_CONFIG}`, '--reporter=list,json'],
          { encoding: 'utf8', env, timeout: SUITE_BUDGET_MS, stdio: ['ignore', 'inherit', 'inherit'] },
        );

        expect(
          existsSync(reportFile),
          `playwright exited ${run.status} without writing its JSON report — it never reached the tests. ` +
            'Read its output above: a webServer that did not boot, or a browser it could not launch.',
        ).toBe(true);
        const report = JSON.parse(readFileSync(reportFile, 'utf8')) as PlaywrightReport;
        const stats = report.stats ?? {};
        const failing = failingSpecs(report.suites);
        const ran = (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.flaky ?? 0);
        const errors = (report.errors ?? []).map((e) => (e.message ?? '').split('\n')[0]);

        expect(ran, 'playwright reported no test that ran — a smoke that ran nothing is not a green smoke').toBeGreaterThan(0);
        expect(
          { failing, errors },
          `${failing.length} of ${ran} showcase smoke test(s) failed` +
            (failing.length > 0 && failing.length === ran
              ? ' — ALL of them: read it as an environment failure first (Console SPA not built, browser not launchable, ' +
                'backend not serving) before filing a product defect'
              : ''),
        ).toEqual({ failing: [], errors: [] });
        expect(run.status, `playwright exited ${run.status} with every test passing — read its output above`).toBe(0);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    },
    SUITE_BUDGET_MS + 60_000,
  );
});
