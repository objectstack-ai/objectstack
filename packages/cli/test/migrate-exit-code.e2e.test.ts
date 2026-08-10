// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate recorded-by --json` — the EXIT STATUS, over the real CLI process
 * (#4873).
 *
 * A successful run of this command returned a different non-zero code every
 * time — 208, 171, 176, 163, 62, and on the tree this test was written against
 * 19, 48, 49, 57, 6. Correct JSON on stdout, `✅ Graceful shutdown complete`,
 * empty stderr, process gone in ~3 s: nothing an author looks at was wrong.
 * Only the one thing no author looks at, and the only thing a CI step, a
 * `set -e` script, a Makefile or a container entrypoint looks at.
 *
 * Two of those observations have since changed, and deliberately: #6217 gave
 * `--json` its stdout back, so the boot log and the shutdown receipt now arrive
 * on **stderr** and stdout is one JSON document. That is what let this file
 * drop the payload-hunting extractor it had to carry — see {@link jsonPayload}.
 *
 * The cause was `emitJson(payload, timer.elapsed())` — a DURATION handed to the
 * parameter that means `exitCode`, so the process exited with its own runtime
 * in milliseconds, truncated to 8 bits. `packages/cli/src/utils/format.exit-code.test.ts`
 * pins that at the unit and the type level. This file pins the only statement
 * that matters to the audience `--json` exists for: what the SHELL sees.
 *
 * It has to be a real child process. `process.exitCode` set inside a vitest
 * worker is not an exit status — the number the defect produced only exists
 * once Node has exited and the kernel has masked it to `& 0xFF`. Spawned
 * through `bin/run-dev.js` + tsx (the pattern `migrate-meta.e2e.test.ts` and
 * `emit-json-pipe.test.ts` already use) so the suite does not depend on
 * `packages/cli/dist` having been built.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** Minimal project: the command boots a stack, it does not need much of one. */
const CONFIG = `
export default {
  name: 'exit_code_e2e',
  label: 'Exit Code E2E',
  objects: [{
    name: 'ec_ticket',
    label: 'Ticket',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};
`;

/**
 * Comfortably below the 122.4 s a pre-#4813 run took, and ~10x above the ~4-9 s
 * a healthy run takes here.
 *
 * #4813 was the OTHER defect on this exit path: the kernel's init/start timeout
 * guards were never cleared, so the process sat idle for the guard's full 120 s
 * after the work was done. That is fixed; this bound is what notices if it
 * comes back, since a re-armed guard is invisible to every other assertion in
 * this file (the exit code was random both before and after #4813 — that is the
 * observation the issue was filed on).
 */
const SLOW_RUN_MS = 90_000;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  wallMs: number;
}

function runCli(args: string[], cwd: string, env: Record<string, string> = {}): Promise<Run> {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1', ...env } },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status; `null`/undefined means the
          // child was signalled, which is a failure of a different kind and
          // must not be reported as 0.
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
          wallMs: Date.now() - started,
        });
      },
    );
  });
}

/**
 * The `--json` payload: the WHOLE of stdout, parsed as one document.
 *
 * This used to be a heuristic extractor — scan backwards for a lone `}` at
 * column 0, then back to its matching lone `{` — written under duress because
 * the kernel's INFO logger wrote to stdout, so the payload arrived with ~60 log
 * lines above it and two below and the whole stream was not valid JSON. That
 * was its own defect for the same audience (#6217); it is fixed, `--json` now
 * reserves stdout for the payload and the kernel's output goes to stderr, and
 * the extractor is gone.
 *
 * Keeping this a bare `JSON.parse` is deliberate: the heuristic could silently
 * pick the wrong text the moment a log line looked like an object, so removing
 * it removes a way for THIS pin to pass on the wrong bytes. The invariant it
 * now leans on is pinned across the whole `bootSchemaStack` family in
 * `json-stdout-purity.e2e.test.ts`.
 */
function jsonPayload(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

const RUNS = 3;
let dir: string;
let runs: Run[];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-exit-code-e2e-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG);

  // Sequential, each against its own fresh database — the same shape as the
  // issue's repro loop, which is the only way "a DIFFERENT non-zero code every
  // time" can be shown to be gone.
  runs = [];
  for (let i = 0; i < RUNS; i++) {
    runs.push(
      await runCli(['migrate', 'recorded-by', '--json'], dir, {
        OS_DATABASE_URL: `file:${join(dir, `run-${i}.db`)}`,
      }),
    );
  }
}, 600_000);

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('os migrate recorded-by --json — a successful run exits 0 (#4873)', () => {
  it('exits 0 on every run, not a fresh non-zero code each time', () => {
    // Reported as the whole vector: `toBe(0)` on run 1 would pass on a tree
    // where only the first run happened to land on a multiple of 256.
    expect(runs.map((r) => r.code)).toEqual(Array<number>(RUNS).fill(0));
  });

  it('really did the work it is reporting success for — this is not a masked exit', () => {
    // The exit code means something only if the command actually ran. A
    // `process.exit(0)` bolted onto the end of `run()` would satisfy the
    // assertion above while turning every real failure into a false success;
    // these are the receipts that it did not.
    for (const run of runs) {
      const payload = jsonPayload(run.stdout);
      expect(payload).toMatchObject({
        planId: 'metadata.recorded-by-sentinel-to-null',
        sentinel: 'system',
        pending: 0,
        applied: false,
      });
      // The receipt moved streams with #6217 and is still a receipt: the
      // kernel really came up and really came down, it just says so on stderr
      // now so stdout can be the payload and nothing else.
      expect(run.stderr).toContain('Graceful shutdown complete');
      expect(run.stdout).not.toContain('Graceful shutdown complete');
    }
  });

  it('reports its duration IN THE PAYLOAD — the value that used to be the exit code', () => {
    const durations = runs.map((r) => jsonPayload(r.stdout).duration as number);

    for (const d of durations) {
      expect(typeof d).toBe('number');
      expect(d).toBeGreaterThan(0);
    }

    // The assertion that ties this file to the defect. Under the old code the
    // exit status WAS this number masked to 8 bits, so any run whose duration
    // is not a multiple of 256 is a run that used to exit non-zero. Requiring
    // it of the SET rather than of each run keeps the pin deterministic: a
    // single duration could legitimately land on a multiple of 256, all three
    // doing so has probability ~6e-8.
    expect(durations.some((d) => d % 256 !== 0)).toBe(true);
  });

  it('still exits promptly — #4813 stays fixed', () => {
    // Wall time of the whole child, tsx compile included.
    for (const run of runs) expect(run.wallMs).toBeLessThan(SLOW_RUN_MS);
  });
});

describe('os migrate recorded-by --json — a failing run still exits non-zero (#4873)', () => {
  it('reports a boot failure as exit 1, not as a clean 0', async () => {
    // The inverse defect this fix must not introduce. An unsupported URL scheme
    // is refused by `createStandaloneStack` before anything is opened, so it is
    // fast and deterministic — and it leaves through the exact `emitJson(...,
    // 0, { compact: true })` + `this.exit(1)` path that #4873 edited.
    const run = await runCli(
      ['migrate', 'recorded-by', '--json', '--database-url', 'wat://nope'],
      dir,
    );

    expect(run.code).toBe(1);
    const payload = jsonPayload(run.stdout);
    expect(String(payload.error)).toContain('Unsupported database URL scheme');
  }, 300_000);
});
