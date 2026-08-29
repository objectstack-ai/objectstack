// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13027 — `os migrate plan` ENDS ITS PROCESS once the plan is printed.
 *
 * ## The measurement this inverts
 *
 * ObjectStack Cloud's `migrate-control-db.yml`, staging control plane,
 * `apply=false`, inside `docker run --rm`. The CLI finished in 4.3 seconds and
 * said so — `17 change(s)`, `Graceful shutdown started`, `Graceful shutdown
 * complete` — and then the log's next line is the run being cancelled by hand
 * **78 minutes later**. The shell's very next statement was an `echo` that
 * never printed, so the shell was still blocked on that one `docker run`: the
 * process had printed its own graceful-shutdown line and had not exited.
 *
 * The cause is structural, not incidental. The host composition (#12938)
 * registers a host's plugins for their DECLARATIONS: `init()` runs, `start()`
 * is replaced with a no-op. Anything a plugin arms during Phase 1 whose release
 * would have been installed by Phase 2 now has no release path at all, and the
 * event loop never drains.
 *
 * ## Why this file spawns a real process
 *
 * The defect IS process exit. An in-process test cannot observe it: vitest's
 * worker is alive either way, and the handle that keeps a real CLI alive would
 * simply keep the worker alive too — which reads as a slow test, not a failure.
 * Nothing short of a child whose exit is awaited can distinguish "returned" from
 * "did not return", which is exactly why the CLI's own suite was blind to a
 * command that hung for 78 minutes in production.
 *
 * ## The fixture is the defect's own shape, not a stand-in
 *
 * `objectstack.config.ts` brings one plugin that acquires a REF'd interval in
 * `init()` and would clear it in `start()`. That is the composed shape verbatim:
 * `init()` runs, `start()` is suppressed, the timer holds the loop open, and the
 * kernel still reports a clean shutdown. No import, so the config bundles with
 * nothing installed in the fixture directory.
 *
 * ⛔ The interval is deliberately NOT `unref()`ed. An unref'd timer lets the
 * process exit on its own and the test would pass against the unfixed CLI —
 * a pin that cannot fail is the failure mode this file exists to prevent.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, childEnv } from './helpers/serve-process.js';

/**
 * How long the child is allowed to take, end to end.
 *
 * The measured plan itself took 4.3 seconds against a remote Postgres; this
 * fixture is an in-memory SQLite with one plugin, so the work is far smaller
 * and the budget is dominated by tsx compiling the CLI's command tree on a
 * cold worker. Generous on purpose — the defect being pinned is UNBOUNDED
 * (78 minutes and still running), so any finite bound separates the two states
 * and a tight one would only add flake.
 */
const EXIT_BUDGET_MS = 90_000;

interface ChildOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** `true` when the budget expired and the child had to be killed. */
  timedOut: boolean;
  elapsedMs: number;
}

function runMigratePlan(cwd: string): Promise<ChildOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      process.execPath,
      [CLI, 'migrate', 'plan', '--json'],
      {
        cwd,
        env: childEnv({
          // No compiled artifact: the host config is the only deployment here.
          OS_ARTIFACT_PATH: join(cwd, 'dist', 'objectstack.json'),
          OS_DATABASE_URL: `file:${join(cwd, 'plan.db')}`,
          NODE_ENV: 'production',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // SIGKILL, not SIGTERM: the process under test is one that does not end
      // when its own work does, and a handler-swallowed SIGTERM would leave the
      // test hanging on the very condition it is measuring.
      child.kill('SIGKILL');
    }, EXIT_BUDGET_MS);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut, elapsedMs: Date.now() - started });
    });
  });
}

describe('os migrate plan exits once the plan is written (#13027)', () => {
  it('returns from a composed host stack that armed an unreleasable handle in init()', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'os-13027-'));
    try {
      writeFileSync(
        join(dir, 'objectstack.config.ts'),
        [
          '// A host plugin in the shape the composition cannot release: the',
          '// handle is acquired in `init()` and the only path that would clear',
          '// it lives in `start()`, which a declaration-phase composition',
          '// replaces with a no-op.',
          'let held: any = null;',
          'export default {',
          '  plugins: [',
          '    {',
          "      name: 'com.example.holds-the-loop-open',",
          '      async init() {',
          '        // REF\'d on purpose — an unref\'d timer would let the process',
          '        // exit on its own and this pin could never fail.',
          '        held = setInterval(() => { /* holds the event loop */ }, 1000);',
          '      },',
          '      async start() {',
          '        if (held) clearInterval(held);',
          '      },',
          '    },',
          '  ],',
          '};',
          '',
        ].join('\n'),
      );

      const outcome = await runMigratePlan(dir);

      expect(
        outcome.timedOut,
        `os migrate plan did not exit within ${EXIT_BUDGET_MS}ms.\n`
        + `--- stdout ---\n${outcome.stdout}\n--- stderr ---\n${outcome.stderr}`,
      ).toBe(false);
      // The command SUCCEEDED and then exited — not "exited because it crashed".
      // Both halves matter: a non-zero code would make the exit meaningless as
      // evidence that the success path returns.
      expect(outcome.code, `stderr:\n${outcome.stderr}`).toBe(0);
      expect(outcome.signal).toBeNull();

      // And the document survived the exit — `process.exit` on an undrained
      // stdout pipe truncates, which is the one way this fix could break the
      // consumer it exists to unblock.
      const payload = JSON.parse(outcome.stdout);
      expect(payload).toHaveProperty('managedTables');
      expect(payload).toHaveProperty('composition');
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }, EXIT_BUDGET_MS + 30_000);
});
