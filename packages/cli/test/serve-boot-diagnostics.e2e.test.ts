// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#4012 — boot-phase logger output over the REAL `os serve` process.
 *
 * `serve` blanks stdout while the kernel boots so the banner is readable, and
 * `ObjectLogger` routes `warn` to stdout — so while that window discarded its
 * bytes, no plugin's boot-phase warning reached a terminal on either CLI
 * entrypoint (`os dev` spawns `serve` with inherited stdio, so one drain
 * blinded both). Nothing above the CLI could see it: the kernel logged
 * correctly, the sink was live, and every data-phase line streamed fine.
 *
 * Only a test that drives the actual command can catch that, so this one boots
 * a real stack through `bin/run-dev.js` and reads its stdout. The positive
 * control is a config-only guarantee that a boot WARN gets emitted: a declared
 * `script` action with no `body` and no registered handler, which the ADR-0110
 * D5 inventory reports as an `unboundDeclarations` finding through
 * `ctx.logger.warn`.
 *
 * That single assertion covers the whole class — it fails whenever boot-phase
 * WARNs are swallowed, whatever re-introduces the swallowing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/**
 * A stack whose only interesting property is that booting it MUST log a
 * warning: `orphan_action` is a `script` action with no `body`, and nothing
 * registers a handler under `neverRegistered` — ADR-0078's "button wired to
 * nothing", which the D5 inventory warns about at `kernel:ready`.
 */
const CONFIG = `
export default {
  manifest: {
    id: 'com.example.bootdiag',
    namespace: 'bootdiag',
    version: '1.0.0',
    type: 'app',
    name: 'Boot Diagnostics Fixture',
  },
  objects: [{
    name: 'bootdiag_task',
    label: 'Task',
    sharingModel: 'private',
    fields: {
      title: { type: 'text', label: 'Title' },
    },
    actions: [{
      name: 'orphan_action',
      label: 'Orphan',
      type: 'script',
      target: 'neverRegistered',
    }],
  }],
};
`;

interface ServeRun {
  stdout: string;
  stderr: string;
}

/**
 * Boot `os serve` in `cwd`, collect its output until the banner prints (or
 * `waitFor` matches), then stop it. Never leaves the child running.
 */
function runServe(
  cwd: string,
  args: string[],
  opts: { waitFor: RegExp; timeoutMs?: number },
): Promise<ServeRun> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(TSX, [CLI, 'serve', 'objectstack.config.ts', ...args], {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: '1',
        // Keep the fixture self-contained: no file written, no port conflict
        // with another agent's dev server, no inherited log level.
        OS_DATABASE_URL: ':memory:',
        OS_LOG_LEVEL: '',
        OS_DISABLE_CONSOLE: '1',
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      if (err) rejectRun(err);
      else resolveRun({ stdout, stderr });
    };

    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `serve did not reach ${opts.waitFor} in time.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
          ),
        ),
      opts.timeoutMs ?? 180_000,
    );

    child.stdout.on('data', (d) => {
      stdout += String(d);
      if (opts.waitFor.test(stdout)) finish();
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (err) => finish(err));
    // A boot that dies still has to have said why — resolve rather than reject
    // so the assertions can read what it printed on the way down.
    child.on('exit', () => finish());
  });
}

let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-boot-diagnostics-e2e-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
  // `serve` needs the compiled artifact beside the config: booting from the
  // config alone currently dies in `AppPlugin` with "Service 'manifest' is
  // async - use await" (reproducible on `examples/app-todo` too, by moving its
  // `dist/objectstack.json` aside) — a separate, pre-existing defect, filed
  // rather than worked around here.
  await execFileP(TSX, [CLI, 'compile'], {
    cwd: dir,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
}, 240_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('os serve — boot-phase logger output (#4012)', () => {
  it(
    'prints the boot WARN a plugin logged while the banner was being assembled',
    async () => {
      // Random high port: never contend with a dev server this machine is
      // already running (AGENTS.md multi-agent discipline §8).
      const port = String(40000 + Math.floor(Math.random() * 20000));
      const { stdout, stderr } = await runServe(dir, ['--port', port], {
        waitFor: /Press Ctrl\+C to stop/,
      });

      const seen = `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;

      // The load-bearing assertion. Before the fix this was absent at EVERY
      // log level while thousands of data-phase lines streamed past.
      expect(stdout, `[action-governance] missing from stdout${seen}`).toContain(
        '[action-governance]',
      );
      // …and it names the offender, so the line is actionable rather than just
      // present.
      expect(stdout).toContain('bootdiag_task:orphan_action');
    },
    240_000,
  );

  it(
    'streams boot output live at --log-level debug instead of hiding it',
    async () => {
      // The issue's damning evidence: `--log-level debug` emitted 2,360 lines,
      // none of them from boot — not even the kernel's own plain
      // `logger.debug('Triggering kernel:ready hook')`. At a verbose level the
      // quiet window no longer opens at all.
      const port = String(40000 + Math.floor(Math.random() * 20000));
      const { stdout, stderr } = await runServe(dir, ['--port', port, '--log-level', 'debug'], {
        waitFor: /Press Ctrl\+C to stop/,
      });

      const seen = `\n--- stdout ---\n${stdout.slice(-4000)}\n--- stderr ---\n${stderr.slice(-2000)}`;
      expect(stdout, `boot-phase kernel traces missing${seen}`).toContain('Bootstrap complete');
      expect(stdout, `boot WARN missing at debug level${seen}`).toContain('[action-governance]');
    },
    240_000,
  );
});
