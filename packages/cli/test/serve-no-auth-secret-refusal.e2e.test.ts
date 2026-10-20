// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  childEnv,
  E2E_SECRET_KEY,
  KERNEL_ASSIGNED_PORT,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';

/**
 * ADR-0131 D9 — a production `os serve` whose `auth` tier is on but whose auth
 * secret is missing is REFUSED before the kernel starts.
 *
 * Without the secret `resolvePlatformAuthComposition` composes no AuthPlugin,
 * so the boot has no security model (anonymous object data is always denied,
 * the data API is unusable) and no organization object — and every row its
 * inline seed writes on a tenant table landed with no organization, its
 * autonumber drawn from the organization-less counter. Measured before this
 * refusal on `examples/app-showcase`: a fresh install answered health 200 and
 * held two rows with a NULL `organization_id` and a `__global__` counter row.
 *
 * The property pinned is the order as much as the refusal: it fires while the
 * kernel is only composed, so the database is never even opened. The healthy
 * leg is the control — the same fixture, entrypoint and posture with the
 * secret set reaches the ready banner and creates the database file, which is
 * what makes the absent file in the refused leg mean something.
 *
 * Spawned through `bin/run.js` with `NODE_ENV` unset, the only shape that
 * reaches production posture (`bin/run-dev.js` sets `development`, and a
 * development boot falls back to a local secret).
 */

const READY_BANNER_TAIL = /Press Ctrl\+C to stop/;
const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run.js');

type BootChild = ChildProcessByStdio<null, Readable, Readable>;

const children: BootChild[] = [];
let fixtureDir: string;

interface Outcome {
  output: string;
  exitCode: number | null;
}

/** Boot until the ready banner (returns `exitCode: null`) or until the process exits. */
async function boot(databaseFile: string, env: Record<string, string | undefined> = {}): Promise<Outcome> {
  const child = spawn(process.execPath, [CLI, 'serve', 'objectstack.config.ts', '--port', KERNEL_ASSIGNED_PORT], {
    cwd: fixtureDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    // `childEnv`, never a bare `...process.env` — see its header (commit 1ddda1d00).
    env: childEnv({
      NO_COLOR: '1',
      OS_DATABASE_URL: `file:${databaseFile}`,
      OS_LOG_LEVEL: '',
      OS_DISABLE_CONSOLE: '1',
      OS_SECRET_KEY: E2E_SECRET_KEY,
      // Truly unset in both legs unless a leg sets it: the refusal's subject.
      OS_AUTH_SECRET: undefined,
      // Production posture — see the header.
      NODE_ENV: undefined,
      ...env,
    }),
  }) as BootChild;
  children.push(child);

  let output = '';
  return new Promise<Outcome>((done, fail) => {
    const timer = setTimeout(() => {
      fail(new Error(`serve neither refused nor reached ready\n${output}`));
    }, 150_000);
    const onData = (d: unknown) => {
      output += String(d);
      if (READY_BANNER_TAIL.test(output)) {
        clearTimeout(timer);
        done({ output, exitCode: null });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      done({ output, exitCode: code });
    });
  });
}

beforeAll(() => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  fixtureDir = mkdtempSync(join(tmpdir(), 'os-no-auth-secret-'));
  writeFileSync(join(fixtureDir, 'objectstack.config.ts'), 'export default {};\n', 'utf8');
});

afterAll(() => {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

describe('os serve — a production server boot with no auth secret is refused (ADR-0131 D9)', () => {
  it('refuses before the kernel starts: non-zero exit, the remedy named, the database never opened', async () => {
    const databaseFile = join(fixtureDir, 'refused.db');
    const { output, exitCode } = await boot(databaseFile);

    expect(exitCode, `the boot was not refused\n${output}`).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(output).not.toMatch(READY_BANNER_TAIL);
    expect(output).toContain('no auth secret is set');
    expect(output).toContain('OS_AUTH_SECRET');
    expect(existsSync(databaseFile), `the refused boot opened its database\n${output}`).toBe(false);
  }, 240_000);

  it('control: the same boot with the secret reaches ready and opens its database', async () => {
    const databaseFile = join(fixtureDir, 'healthy.db');
    const { output, exitCode } = await boot(databaseFile, {
      OS_AUTH_SECRET: 'os-adr-0131-d9-control-leg-secret-not-a-real-credential',
    });

    expect(exitCode, `the control leg exited\n${output}`).toBeNull();
    expect(output).not.toContain('no auth secret is set');
    expect(existsSync(databaseFile), `the control leg never opened its database\n${output}`).toBe(true);
  }, 240_000);
});
