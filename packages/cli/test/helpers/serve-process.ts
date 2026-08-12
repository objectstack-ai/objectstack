// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared harness for e2e tests that need the REAL `os serve` process.
 *
 * Some serve defects only exist above the kernel — the boot-quiet stdout window
 * (#4012), the plugin registration ORDER the command assembles (#4085) — so
 * they survive every in-process test and only a test that spawns the actual
 * command can catch them. This module owns that spawn so each e2e file asserts
 * rather than re-implements it.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

/** `bin/run-dev.js` — the CLI entrypoint that runs from TS source via tsx. */
export const CLI = resolve(HERE, '../../bin/run-dev.js');
export const TSX = resolve(HERE, '../../../../node_modules/.bin/tsx');

/** A random high port, so a run never contends with a dev server on this host. */
export function randomPort(): string {
  return String(40000 + Math.floor(Math.random() * 20000));
}

export interface ServeRun {
  stdout: string;
  stderr: string;
}

/**
 * Boot `os serve` in `cwd`, collect its output until `waitFor` matches (or the
 * process exits), then stop it. Never leaves the child running.
 *
 * A boot that DIES still has to have said why, so an early exit resolves rather
 * than rejects — the caller's assertions read what it printed on the way down.
 *
 * `waitFor` is matched against **stdout and stderr together** (#7915). `serve`
 * writes every human line — banner, boot progress, kernel logs — to stderr now,
 * because its stdout belongs to the MCP stdio transport when one is mounted;
 * matching stdout alone would wait for a stream that stays empty for the whole
 * boot. Both streams are still returned separately, which is what lets
 * `serve-stdio-stdout-purity.e2e.test.ts` assert stdout carries NOTHING else.
 */
export function runServe(
  cwd: string,
  args: string[],
  // `env` values may be `undefined` to UNSET a variable for the child (Node
  // omits undefined entries), which is how a test asserts behaviour that depends
  // on a variable being absent — `''` would not do it, since the resolvers this
  // exercises use `??` and an empty string is not nullish.
  opts: { waitFor: RegExp; timeoutMs?: number; config?: string; env?: Record<string, string | undefined> },
): Promise<ServeRun> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(TSX, [CLI, 'serve', opts.config ?? 'objectstack.config.ts', ...args], {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: '1',
        // Keep the fixture self-contained: no file written, no port conflict
        // with another agent's dev server, no inherited log level.
        OS_DATABASE_URL: ':memory:',
        OS_LOG_LEVEL: '',
        OS_DISABLE_CONSOLE: '1',
        ...(opts.env ?? {}),
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
      if (opts.waitFor.test(stdout + stderr)) finish();
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
      if (opts.waitFor.test(stdout + stderr)) finish();
    });
    child.on('error', (err) => finish(err));
    child.on('exit', () => finish());
  });
}
