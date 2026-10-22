// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 30 — spawns the real producer once per single-cause fixture: four boots of the built CLI (a missing and a broken `@objectstack/plugin-auth` in production, the broken one under `--dev`, and production with no stub), each differing only in the input under test; MEASURED_PLACEHOLDER

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  childEnv,
  E2E_SECRET_KEY,
  KERNEL_ASSIGNED_PORT,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';

/**
 * ADR-0131 D9 — the third composition that leaves a production `os serve` with
 * no organization object, beside the two `serve-no-auth-secret-refusal`
 * pins: the `auth` tier is on and an auth secret is set, so
 * `resolvePlatformAuthComposition` composes AuthPlugin, but
 * `@objectstack/plugin-auth` fails to load. The broad `try` around the
 * auto-registration used to catch that and boot on — silently for a missing
 * install, with one warning for a broken one — with no AuthPlugin, so no
 * organization object, so every row the boot wrote landed with no owner (or
 * was refused at NOT NULL on a fresh store).
 *
 * The failure is stubbed with `fixtures/plugin-auth-load-failure.hook.mjs`, a
 * `--import` resolve hook that fails the package's root entry the two ways an
 * install does, with node's own error each time. The refused legs pin the
 * order as much as the refusal — the database is never opened — and that the
 * refusal names the load error. The control legs are what make the stub the
 * cause: the same fixture and secret with no stub boots, and the same broken
 * stub under `--dev` keeps the development warn-and-boot path.
 *
 * Spawned through `bin/run.js` with `NODE_ENV` unset, the only shape that
 * reaches production posture (see the sibling pin's header).
 */

const READY_BANNER_TAIL = /Press Ctrl\+C to stop/;
const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run.js');
const HOOK = pathToFileURL(resolve(HERE, 'fixtures/plugin-auth-load-failure.hook.mjs')).href;

/** Auth on (the default preset's tiers), nothing else declared. */
const AUTH_TIER_CONFIG = 'export default {};\n';

const LOAD_FAILURE_TEXT = '@objectstack/plugin-auth failed to load';
/** Node's own sentences for the two stubbed installs — the hook writes neither. */
const MISSING_CAUSE = 'Cannot find module';
const BROKEN_CAUSE = 'does not provide an export named';
const SECRET = 'os-adr-0131-d9-load-failure-leg-secret-not-a-real-credential';

type BootChild = ChildProcessByStdio<null, Readable, Readable>;

const children: BootChild[] = [];
let root: string;
let fixtureDir: string;

interface Outcome {
  output: string;
  exitCode: number | null;
}

interface Leg {
  databaseFile: string;
  /** The `plugin-auth-load-failure` hook's mode, or no stub at all. */
  stub?: 'missing' | 'broken';
  args?: string[];
}

/** Boot until the ready banner (returns `exitCode: null`) or until the process exits. */
async function boot({ databaseFile, stub, args = [] }: Leg): Promise<Outcome> {
  const nodeArgs = stub ? ['--import', `${HOOK}?mode=${stub}`] : [];
  const child = spawn(
    process.execPath,
    [...nodeArgs, CLI, 'serve', 'objectstack.config.ts', '--port', KERNEL_ASSIGNED_PORT, ...args],
    {
      cwd: fixtureDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      // `childEnv`, never a bare `...process.env` — see its header (commit 1ddda1d00).
      env: childEnv({
        NO_COLOR: '1',
        OS_DATABASE_URL: `file:${databaseFile}`,
        OS_LOG_LEVEL: '',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
        // Every leg has the secret: the subject is the load, not the secret.
        // The two legacy spellings are unset so an ambient one cannot differ.
        OS_AUTH_SECRET: SECRET,
        AUTH_SECRET: undefined,
        BETTER_AUTH_SECRET: undefined,
        OS_MIGRATE_AND_EXIT: undefined,
        // Production posture — see the header. The `--dev` leg reaches
        // development through the flag, which is the posture under test.
        NODE_ENV: undefined,
      }),
    },
  ) as BootChild;
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

/** A refused leg: non-zero exit, no banner, the load error named, nothing written. */
async function expectRefused(leg: Leg, cause: string): Promise<string> {
  const { output, exitCode } = await boot(leg);
  expect(exitCode, `the boot was not refused\n${output}`).not.toBeNull();
  expect(exitCode).not.toBe(0);
  expect(output).not.toMatch(READY_BANNER_TAIL);
  expect(output).toContain(LOAD_FAILURE_TEXT);
  expect(output).toContain(`The load error: `);
  expect(output).toContain(cause);
  // Refused instead of the old warn-and-boot line, not after it.
  expect(output).not.toContain('⚠ AuthPlugin failed to load');
  expect(existsSync(leg.databaseFile), `the refused boot opened its database\n${output}`).toBe(false);
  return output;
}

/** A control leg: reaches ready and opens its database, with no refusal. */
async function expectBoots(leg: Leg): Promise<string> {
  const { output, exitCode } = await boot(leg);
  expect(exitCode, `the control leg exited\n${output}`).toBeNull();
  expect(output).not.toContain(LOAD_FAILURE_TEXT);
  expect(existsSync(leg.databaseFile), `the control leg never opened its database\n${output}`).toBe(true);
  return output;
}

const db = (name: string) => join(root, `${name}.db`);

beforeAll(() => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  root = mkdtempSync(join(tmpdir(), 'os-plugin-auth-load-failure-'));
  fixtureDir = join(root, 'auth-tier');
  mkdirSync(fixtureDir);
  writeFileSync(join(fixtureDir, 'objectstack.config.ts'), AUTH_TIER_CONFIG, 'utf8');
});

afterAll(() => {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('os serve — a production boot whose plugin-auth fails to load is refused (ADR-0131 D9)', () => {
  it('refuses a missing install — once swallowed without a word — before the kernel starts', async () => {
    await expectRefused({ databaseFile: db('missing-server'), stub: 'missing' }, MISSING_CAUSE);
  }, 240_000);

  it('refuses a broken install on a kernel-only (--no-server) boot before the kernel starts', async () => {
    await expectRefused({ databaseFile: db('broken-no-server'), stub: 'broken', args: ['--no-server'] }, BROKEN_CAUSE);
  }, 240_000);

  it('control: the same boot with no stub reaches ready and opens its database', async () => {
    await expectBoots({ databaseFile: db('no-stub-no-server'), args: ['--no-server'] });
  }, 240_000);

  it('control: --dev with the broken install keeps the warn-and-boot path', async () => {
    const output = await expectBoots({ databaseFile: db('broken-dev-no-server'), stub: 'broken', args: ['--dev', '--no-server'] });
    expect(output).toContain('⚠ AuthPlugin failed to load');
    expect(output).toContain(BROKEN_CAUSE);
  }, 240_000);
});
