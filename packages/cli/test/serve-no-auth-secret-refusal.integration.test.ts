// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
 * ADR-0131 D1/D9 — a production `os serve` that composes no organization object
 * is REFUSED before the kernel starts, whether or not it serves a data API.
 *
 * Two compositions reach it. The `auth` tier is on but no auth secret resolves,
 * so `resolvePlatformAuthComposition` composes no AuthPlugin (`no-secret`); or
 * the stack mounts no auth at all (the tier off, no AuthPlugin of its own).
 * Either way the boot has no security model (anonymous object data is always
 * denied, the data API is unusable) and no organization object — and every row
 * its inline seed writes on a tenant table lands with no organization, its
 * autonumber drawn from the organization-less counter. Measured before the
 * server-boot refusal on `examples/app-showcase`: a fresh install answered
 * health 200 and held two rows with a NULL `organization_id` and a
 * `__global__` counter row.
 *
 * `--no-server` is no way round it: the seed does not depend on the listener,
 * and a kernel-only boot on an 18.0.0-born store re-wrote a deleted seed row
 * with a NULL `organization_id` (the measurement behind ruling 6328987873,
 * letter A). So both refusals are pinned with and without `--server`, and once
 * as the `OS_MIGRATE_AND_EXIT=1` job, which runs the same kernel bootstrap.
 *
 * The property pinned is the order as much as the refusal: it fires while the
 * kernel is only composed, so the database is never even opened. The control
 * legs are what make the absent file mean something — the same entrypoint and
 * posture with a secret, under `--dev`, and on the cloud runtime's host kernel
 * (whose auth is each project's, and which keeps its warn-only path) each
 * reach the ready banner and create the database file.
 *
 * Spawned through `bin/run.js` with `NODE_ENV` unset, the only shape that
 * reaches production posture (`bin/run-dev.js` sets `development`, and a
 * development boot falls back to a local secret).
 */

const READY_BANNER_TAIL = /Press Ctrl\+C to stop/;
const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run.js');

/** Auth on (the default preset's tiers), nothing else declared. */
const AUTH_TIER_CONFIG = 'export default {};\n';
/** The `auth` tier off, and no AuthPlugin of the stack's own. */
const NO_AUTH_CONFIG = "export default { tiers: ['core'] };\n";
/**
 * The cloud runtime's host kernel, as `isHostKernelComposition` recognises it:
 * a plugin registered under `ObjectOSEnvironmentPlugin`'s name. Auth is each
 * project's there, so a missing secret only warns.
 */
const HOST_KERNEL_CONFIG = `export default {
  plugins: [{
    name: 'com.objectstack.runtime.objectos-environment',
    version: '0.0.0',
    init: async () => {},
    start: async () => {},
  }],
  // One object of the app's own, so \`serve\` composes the query engine: a
  // config that mounts plugins and declares no object composes none.
  objects: [{ name: 'host_kernel_probe', label: 'Probe', fields: { title: { type: 'text', label: 'Title' } } }],
};
`;

const NO_SECRET_TEXT = 'no auth secret is set';
const NO_AUTH_TEXT = 'This stack mounts no auth';
const SECRET = 'os-adr-0131-d9-control-leg-secret-not-a-real-credential';

type BootChild = ChildProcessByStdio<null, Readable, Readable>;

const children: BootChild[] = [];
let root: string;
const fixtures: Record<'authTier' | 'noAuth' | 'hostKernel', string> = { authTier: '', noAuth: '', hostKernel: '' };

interface Outcome {
  output: string;
  exitCode: number | null;
}

interface Leg {
  fixtureDir: string;
  databaseFile: string;
  args?: string[];
  env?: Record<string, string | undefined>;
}

/** Boot until the ready banner (returns `exitCode: null`) or until the process exits. */
async function boot({ fixtureDir, databaseFile, args = [], env = {} }: Leg): Promise<Outcome> {
  const child = spawn(process.execPath, [CLI, 'serve', 'objectstack.config.ts', '--port', KERNEL_ASSIGNED_PORT, ...args], {
    cwd: fixtureDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    // `childEnv`, never a bare `...process.env` — see its header (commit 1ddda1d00).
    env: childEnv({
      NO_COLOR: '1',
      OS_DATABASE_URL: `file:${databaseFile}`,
      OS_LOG_LEVEL: '',
      OS_DISABLE_CONSOLE: '1',
      OS_SECRET_KEY: E2E_SECRET_KEY,
      // Truly unset in every leg unless a leg sets it: the refusal's subject.
      // The two legacy spellings `resolveAuthSecret` still reads are unset too,
      // so an ambient one cannot compose auth behind the leg's back.
      OS_AUTH_SECRET: undefined,
      AUTH_SECRET: undefined,
      BETTER_AUTH_SECRET: undefined,
      OS_MIGRATE_AND_EXIT: undefined,
      ...env,
      // Production posture — see the header. Written after the leg's own
      // entries so no leg can move it: the `--dev` legs reach development
      // through the flag, which is the posture under test.
      NODE_ENV: undefined,
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

/** A refused leg: non-zero exit, no banner, the reason and remedy named, nothing written. */
async function expectRefused(leg: Leg, reason: string): Promise<string> {
  const { output, exitCode } = await boot(leg);
  expect(exitCode, `the boot was not refused\n${output}`).not.toBeNull();
  expect(exitCode).not.toBe(0);
  expect(output).not.toMatch(READY_BANNER_TAIL);
  expect(output).toContain(reason);
  expect(output).toContain('OS_AUTH_SECRET');
  // The remedy the old text offered is gone: `--no-server` is named only as
  // what does NOT avoid the refusal.
  expect(output).not.toContain('serve without the data API');
  expect(existsSync(leg.databaseFile), `the refused boot opened its database\n${output}`).toBe(false);
  return output;
}

/** A control leg: reaches ready and opens its database, with neither refusal. */
async function expectBoots(leg: Leg): Promise<string> {
  const { output, exitCode } = await boot(leg);
  expect(exitCode, `the control leg exited\n${output}`).toBeNull();
  expect(output).not.toContain(NO_SECRET_TEXT);
  expect(output).not.toContain(NO_AUTH_TEXT);
  expect(existsSync(leg.databaseFile), `the control leg never opened its database\n${output}`).toBe(true);
  return output;
}

function fixture(name: string, config: string): string {
  const dir = join(root, name);
  mkdirSync(dir);
  writeFileSync(join(dir, 'objectstack.config.ts'), config, 'utf8');
  return dir;
}

const db = (name: string) => join(root, `${name}.db`);

beforeAll(() => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  root = mkdtempSync(join(tmpdir(), 'os-no-auth-secret-'));
  fixtures.authTier = fixture('auth-tier', AUTH_TIER_CONFIG);
  fixtures.noAuth = fixture('no-auth', NO_AUTH_CONFIG);
  fixtures.hostKernel = fixture('host-kernel', HOST_KERNEL_CONFIG);
});

afterAll(() => {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('os serve — a production boot with no auth secret is refused, --server or not (ADR-0131 D9)', () => {
  it('refuses the server boot before the kernel starts', async () => {
    await expectRefused({ fixtureDir: fixtures.authTier, databaseFile: db('no-secret-server') }, NO_SECRET_TEXT);
  }, 240_000);

  it('refuses the kernel-only (--no-server) boot before the kernel starts', async () => {
    await expectRefused(
      { fixtureDir: fixtures.authTier, databaseFile: db('no-secret-no-server'), args: ['--no-server'] },
      NO_SECRET_TEXT,
    );
  }, 240_000);

  it('refuses a --no-server migrate-and-exit job before the kernel starts', async () => {
    await expectRefused(
      {
        fixtureDir: fixtures.authTier,
        databaseFile: db('no-secret-migrate'),
        args: ['--no-server'],
        env: { OS_MIGRATE_AND_EXIT: '1' },
      },
      NO_SECRET_TEXT,
    );
  }, 240_000);

  it('control: the server boot with the secret reaches ready and opens its database', async () => {
    await expectBoots({ fixtureDir: fixtures.authTier, databaseFile: db('secret-server'), env: { OS_AUTH_SECRET: SECRET } });
  }, 240_000);

  it('control: the --no-server boot with the secret reaches ready and opens its database', async () => {
    await expectBoots({
      fixtureDir: fixtures.authTier,
      databaseFile: db('secret-no-server'),
      args: ['--no-server'],
      env: { OS_AUTH_SECRET: SECRET },
    });
  }, 240_000);

  it('control: --dev with no secret boots kernel-only on the development fallback', async () => {
    await expectBoots({ fixtureDir: fixtures.authTier, databaseFile: db('dev-no-server'), args: ['--dev', '--no-server'] });
  }, 240_000);

  it('control: the cloud host kernel with no secret keeps its warn-only path', async () => {
    const output = await expectBoots({
      fixtureDir: fixtures.hostKernel,
      databaseFile: db('host-kernel-no-server'),
      args: ['--no-server'],
    });
    expect(output).toContain('AuthPlugin skipped on host kernel');
  }, 240_000);
});

describe('os serve — a production boot that mounts no auth is refused, --server or not (ADR-0131 D9)', () => {
  it('refuses the server boot before the kernel starts', async () => {
    await expectRefused({ fixtureDir: fixtures.noAuth, databaseFile: db('no-auth-server') }, NO_AUTH_TEXT);
  }, 240_000);

  it('refuses the kernel-only (--no-server) boot before the kernel starts, even with a secret', async () => {
    await expectRefused(
      {
        fixtureDir: fixtures.noAuth,
        databaseFile: db('no-auth-no-server'),
        args: ['--no-server'],
        env: { OS_AUTH_SECRET: SECRET },
      },
      NO_AUTH_TEXT,
    );
  }, 240_000);

  it('control: --dev --no-server with no auth still boots — a development boot is refused only when it serves', async () => {
    await expectBoots({ fixtureDir: fixtures.noAuth, databaseFile: db('no-auth-dev-no-server'), args: ['--dev', '--no-server'] });
  }, 240_000);
});
