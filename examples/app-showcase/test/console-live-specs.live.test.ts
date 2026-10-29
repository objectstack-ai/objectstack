// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * The Console's live Playwright specs that the required `Live E2E UI` job does
 * not run, run in the NIGHTLY `live` tier.
 *
 * `ui/e2e/live/` drives the Console against a real backend serving this
 * showcase app. Four of its specs are the required `Live E2E UI` job
 * (`test:e2e:live:ci` in `ui/package.json`); the rest ran nowhere. The card
 * that wired them here (#25914, ruling Q3 B) ran each one, deleted the stale
 * ones, and listed the kept ones in `ui/package.json`'s `test:e2e:live:nightly`
 * script — that script is the list's one home, and this file reads it by
 * running it. Like `showcase-smoke.live.test.ts` beside it, the
 * `*.live.test.*` name puts this file in the `live` tier
 * (`scripts/nightly-tiers.mjs`): a pull request and the merge queue never
 * collect it, and a red night files a card through `test-nightly-tiers.yml`'s
 * report job, which names this file. The failure text names each red spec.
 *
 * The stack is the one the `Live E2E UI` job boots, step for step:
 *   1. the workspace backend, `ui/e2e/live/ci/start-backend.sh` (this app,
 *      booted by this tree's built CLI, on a throwaway database);
 *   2. the Console built with `VITE_BASE_PATH=/` into a scratch directory —
 *      the specs navigate root paths (`/apps/…`), so neither the `/_console`
 *      copy the backend serves nor the default relative-base build can serve
 *      them — and served by `vite preview`, proxying `/api` to that backend;
 *   3. `pnpm --dir ui run test:e2e:live:nightly` against the two.
 * Unlike the smoke beside it, this file runs one build itself (step 2, about
 * two minutes): the nightly's shard builds the Console only for `/_console`.
 * A failed build fails this test naming the build, never as a spec red.
 *
 * Prerequisites, which this file does not build: the showcase's dependency
 * closure built (`turbo run test` builds it; the backend needs the CLI's
 * `dist/`), the `@objectstack/*` packages the Console compiles against (the
 * nightly's `pnpm console:build` on this shard builds them), and a Chromium
 * that `ui/`'s `@playwright/test` can launch (the same version as this
 * package's, which the nightly installs on this shard). A run missing one
 * fails every spec at once; read a whole-run red as the environment first.
 */

// `process.cwd()` is this package's established seed for its own files
// (`test/vitest-console-teardown-race.test.ts` says why `import.meta.url` is
// not available here). The `ui/` tree is two levels up, at the repo root.
const PACKAGE_ROOT = process.cwd();
const REPO_ROOT = `${PACKAGE_ROOT}/../..`;
const UI_ROOT = `${REPO_ROOT}/ui`;
const CONSOLE_ROOT = `${UI_ROOT}/apps/console`;
const LIVE_CI = `${UI_ROOT}/e2e/live/ci`;
const VITE_BIN = `${CONSOLE_ROOT}/node_modules/.bin/vite`;
const PLAYWRIGHT_BIN = `${UI_ROOT}/node_modules/.bin/playwright`;
const NIGHTLY_SCRIPT = 'test:e2e:live:nightly';

/**
 * The whole run's wall budget: backend boot (≤ 300 s by start-backend.sh's
 * own deadline), the Console build (~2 min on a hosted runner) and the specs
 * (~3 min of test time measured locally, one worker). 25 minutes keeps the
 * nightly shard's 45-minute limit out of reach, so a hang fails as this test,
 * with its report, and not as a killed shard with none.
 */
const RUN_BUDGET_MS = 25 * 60_000;
const BACKEND_BUDGET_MS = 6 * 60_000;
const BUILD_BUDGET_MS = 8 * 60_000;
const SPECS_BUDGET_MS = 10 * 60_000;

/** A port the OS hands out (a listen on port 0), as `showcase-smoke.live.test.ts` does and for its reason. */
function freePort(): number {
  const probe = spawnSync(
    'node',
    ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();});"],
    { encoding: 'utf8' },
  );
  const port = Number(probe.stdout);
  if (probe.status !== 0 || !Number.isInteger(port) || port <= 0) {
    throw new Error(`could not get a free port from the OS (exit ${probe.status}): ${probe.stderr ?? ''}`);
  }
  return port;
}

/** What a vitest worker adds to `process.env` — see `showcase-smoke.live.test.ts`, which measured it. */
const VITEST_WORKER_ENV = ['NODE_ENV', 'TEST', 'BASE_URL', 'MODE', 'DEV', 'PROD', 'SSR', 'FORCE_TTY', 'OS_REGISTRY_LOG'];

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

/** The last lines of a log file, for a failure message that has to stand on its own. */
function tail(file: string, lines = 40): string {
  if (!existsSync(file)) return `(no log at ${file})`;
  return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n');
}

describe('Console live specs outside the required job (live tier)', () => {
  it(
    `every spec in ui's ${NIGHTLY_SCRIPT} passes against the workspace backend`,
    () => {
      for (const bin of [VITE_BIN, PLAYWRIGHT_BIN]) {
        expect(existsSync(bin), `${bin} is missing: install the workspace`).toBe(true);
      }
      const uiScripts = (JSON.parse(readFileSync(`${UI_ROOT}/package.json`, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
      expect(uiScripts[NIGHTLY_SCRIPT], `ui/package.json has no "${NIGHTLY_SCRIPT}" script — the kept-spec list's one home`).toBeTruthy();

      const scratch = mkdtempSync(`${tmpdir()}/console-live-specs-`);
      const backendDir = `${scratch}/backend`;
      const consoleDir = `${scratch}/console`;
      const previewLog = `${scratch}/vite-preview.log`;
      const reportFile = `${scratch}/report.json`;

      // The children are not vitest workers: drop what vitest put into this
      // worker's environment, so the backend boots as it does from a shell
      // (`NODE_ENV=test` disarms the dev-admin seed the specs sign in with).
      const env: Record<string, string | undefined> = { ...process.env };
      for (const key of Object.keys(env)) {
        if (key.startsWith('VITEST')) delete env[key];
      }
      for (const key of VITEST_WORKER_ENV) delete env[key];
      delete env.FORCE_COLOR;
      env.NO_COLOR = '1';

      const apiPort = freePort();
      const appPort = freePort();
      const apiUrl = `http://localhost:${apiPort}`;
      const appUrl = `http://localhost:${appPort}`;
      const backendEnv = { ...env, LIVE_BACKEND_DIR: backendDir, LIVE_BACKEND_PORT: String(apiPort) };
      let previewPid = '';

      try {
        const backend = spawnSync('bash', [`${LIVE_CI}/start-backend.sh`], {
          encoding: 'utf8',
          env: backendEnv,
          timeout: BACKEND_BUDGET_MS,
          stdio: ['ignore', 'inherit', 'inherit'],
        });
        expect(backend.status, `start-backend.sh exited ${backend.status}: the workspace backend did not boot.\n${tail(`${backendDir}/backend.log`)}`).toBe(0);

        const build = spawnSync(
          'bash',
          ['-c', 'cd "$1" && exec "$2" build --outDir "$3" --emptyOutDir', 'bash', CONSOLE_ROOT, VITE_BIN, consoleDir],
          {
            encoding: 'utf8',
            // The Console's build OOMs at Node's default heap (ci.yml's Build & E2E UI says so).
            env: { ...env, VITE_BASE_PATH: '/', NODE_OPTIONS: `${env.NODE_OPTIONS ?? ''} --max-old-space-size=4096`.trim() },
            timeout: BUILD_BUDGET_MS,
            stdio: ['ignore', 'inherit', 'inherit'],
          },
        );
        expect(build.status, `the Console build (VITE_BASE_PATH=/) exited ${build.status} — read its output above; no spec ran`).toBe(0);

        // In the background: only the `nohup` command is backgrounded, so `$!`
        // is the preview server itself (the bin shim ends in `exec node …`),
        // which the `finally` below stops by that PID.
        const preview = spawnSync(
          'bash',
          [
            '-c',
            'cd "$1" || exit 1; DEV_PROXY_TARGET="$2" nohup "$3" preview --outDir "$4" --port "$5" --strictPort > "$6" 2>&1 & echo $!',
            'bash',
            CONSOLE_ROOT,
            apiUrl,
            VITE_BIN,
            consoleDir,
            String(appPort),
            previewLog,
          ],
          { encoding: 'utf8', env, timeout: 30_000 },
        );
        previewPid = (preview.stdout ?? '').trim();
        expect(preview.status === 0 && /^\d+$/.test(previewPid), `vite preview did not start: ${preview.stderr ?? ''}`).toBe(true);
        const ready = spawnSync(
          'bash',
          ['-c', 'for _ in $(seq 1 60); do curl -sf -o /dev/null "$1" && exit 0; sleep 1; done; exit 1', 'bash', `${appUrl}/`],
          { encoding: 'utf8', env, timeout: 90_000 },
        );
        expect(ready.status, `vite preview did not answer on ${appUrl} within 60 s.\n${tail(previewLog)}`).toBe(0);

        // `list` streams one line per test to this process's stdout — the
        // nightly's stall guard reads output to tell a slow suite from a hung
        // one; `json` is the verdict read below.
        const run = spawnSync('pnpm', ['--dir', UI_ROOT, 'run', NIGHTLY_SCRIPT, '--reporter=list,json'], {
          encoding: 'utf8',
          env: { ...env, LIVE_API_URL: apiUrl, LIVE_APP_URL: appUrl, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
          timeout: SPECS_BUDGET_MS,
          stdio: ['ignore', 'inherit', 'inherit'],
        });

        expect(
          existsSync(reportFile),
          `playwright exited ${run.status} without writing its JSON report — it never reached the specs. ` +
            'Read its output above: a global setup that could not sign in, or a browser it could not launch.',
        ).toBe(true);
        const report = JSON.parse(readFileSync(reportFile, 'utf8')) as PlaywrightReport;
        const stats = report.stats ?? {};
        const failing = failingSpecs(report.suites);
        const ran = (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.flaky ?? 0);
        const errors = (report.errors ?? []).map((e) => (e.message ?? '').split('\n')[0]);

        expect(
          { failing, errors },
          `${failing.length} of ${ran} Console live test(s) failed, ${errors.length} run-level error(s)` +
            (errors.length > 0 || (failing.length > 0 && failing.length === ran)
              ? ' — the whole run: read it as an environment failure first (backend not serving, no seeded admin, ' +
                'Console build not served, browser not launchable) before filing a product defect'
              : ''),
        ).toEqual({ failing: [], errors: [] });
        expect(ran, 'playwright reported no test that ran — a run of nothing is not a green run').toBeGreaterThan(0);
        expect(run.status, `playwright exited ${run.status} with every test passing — read its output above`).toBe(0);
      } finally {
        if (previewPid) spawnSync('kill', [previewPid], { encoding: 'utf8' });
        spawnSync('bash', [`${LIVE_CI}/stop-backend.sh`], { encoding: 'utf8', env: backendEnv, timeout: 30_000 });
        rmSync(scratch, { recursive: true, force: true });
      }
    },
    RUN_BUDGET_MS,
  );
});
