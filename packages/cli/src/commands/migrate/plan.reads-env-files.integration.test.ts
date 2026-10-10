// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { isExitSignal } from '../../utils/format.js';
import MigratePlan from './plan.js';
import MigrateApply from './apply.js';

// [#10126] Pay the first transform of the dist-resolved workspace deps the
// commands reach through dynamic `import()`s at MODULE LOAD, not inside a case.
import '@objectstack/runtime';
import '@objectstack/objectql';
import '@objectstack/plugin-auth';

/**
 * [#22581] `os migrate` reads the `.env*` files `os serve` / `start` / `dev`
 * read, with the process environment keeping its precedence, and says which
 * database it opened and who named it.
 *
 * Measured on `main` before the fix: a project whose `.env` set
 * `OS_DATABASE_URL` served that database and planned
 * `.objectstack/data/objectstack.db`; an `OS_AUTH_SECRET` kept in `.env` left
 * the auth family out of the plan.
 *
 * Driven in-process through each command's own `run()`, from inside the
 * fixture (`chdir`), with `NODE_ENV=production`: `bin/run-dev.js` pins
 * `NODE_ENV=development`, which is a development boot, and a development boot
 * composes the auth family on its fallback secret with or without `.env`.
 *
 * The load writes `.env` values into `process.env`, as it does in a real run;
 * `afterEach` puts every variable a fixture can set back, so no case reads the
 * one before it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;
const SECRET = 'os22581-fixture-secret-at-least-32-characters-long';

/** Every variable that would point a boot elsewhere, or that a fixture's `.env` sets. */
const ENV_KEYS = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME',
  'OS_TELEMETRY_DB', 'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ARTIFACT_PATH', 'NODE_ENV',
] as const;

type Invoke = (argv: string[]) => Promise<unknown>;
const invoke = (command: { run: (argv: string[], opts: { root: string }) => Promise<unknown> }): Invoke =>
  (argv) => command.run(argv, { root: CLI_ROOT });

/** Run a command with stdout captured, its exits trapped, and its JSON document parsed. */
async function runJson(command: Invoke, argv: string[]): Promise<{ payload: any; exitCode: number }> {
  const savedExit = process.exitCode;
  const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
  vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let processExit: number | undefined;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    processExit = code ?? 0;
    throw new Error(`__PROCESS_EXIT__:${processExit}`);
  }) as never);
  let thrownExit: number | undefined;
  try {
    try {
      await command(argv);
    } catch (error) {
      const trapped = error instanceof Error && error.message.startsWith('__PROCESS_EXIT__');
      if (!trapped && !isExitSignal(error)) throw error;
      if (!trapped) thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    let payload: any;
    try {
      payload = JSON.parse(out);
    } catch {
      payload = { unparsed: out.slice(-400) };
    }
    return { payload, exitCode: processExit ?? thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

const dirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
let savedCwd: string;

/** A config-only project with the given `.env` lines. */
function project(dotenv: string[], requires: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-22581-env-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'objectstack.config.ts'),
    [
      'export default {',
      "  manifest: { id: 'com.example.os22581env', name: 'env', version: '0.0.0', type: 'app' },",
      `  requires: ${JSON.stringify(requires)},`,
      "  objects: [{ name: 'os22581_env_thing', fields: { title: { type: 'text' } } }],",
      '};',
      '',
    ].join('\n'),
  );
  writeFileSync(join(dir, '.env'), `${dotenv.join('\n')}\n`);
  return dir;
}

/** Enter the fixture as the operator's shell would: this environment, that cwd. */
function enter(dir: string, exported: Record<string, string> = {}): void {
  process.env.NODE_ENV = 'production';
  process.env.OS_TELEMETRY_DB = '0';
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  Object.assign(process.env, exported);
  process.chdir(dir);
}

beforeAll(() => {
  savedCwd = process.cwd();
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  process.chdir(savedCwd);
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe('os migrate reads the .env files the serving commands read (#22581)', () => {
  it('a .env naming a database: plan and apply report that database, and that .env named it', async () => {
    const dir = project(['OS_DATABASE_URL=file:from-dotenv.db']);
    enter(dir);
    const expectedSource = { kind: 'env-file', variable: 'OS_DATABASE_URL', file: '.env' };

    const plan = await runJson(invoke(MigratePlan), ['--json']);
    expect(plan.exitCode, JSON.stringify(plan.payload).slice(0, 400)).toBe(0);
    expect(plan.payload.database).toBe('from-dotenv.db');
    expect(plan.payload.databaseSource).toEqual(expectedSource);

    // No --yes: apply stops at its confirmation gate, after naming its target.
    const apply = await runJson(invoke(MigrateApply), ['--json']);
    expect(apply.payload.message, JSON.stringify(apply.payload).slice(0, 400)).toBe('confirmation_required');
    expect(apply.payload.database).toBe('from-dotenv.db');
    expect(apply.payload.databaseSource).toEqual(expectedSource);
    // …and neither boot opened the default database the serving boot never would.
    expect(existsSync(join(dir, '.objectstack', 'data', 'objectstack.db'))).toBe(false);
  }, CASE_TIMEOUT_MS);

  it('an OS_AUTH_SECRET kept in .env keeps the auth family in the plan', async () => {
    const dir = project([`OS_AUTH_SECRET=${SECRET}`], ['auth']);
    enter(dir);

    const plan = await runJson(invoke(MigratePlan), ['--json']);
    expect(plan.exitCode, JSON.stringify(plan.payload).slice(0, 400)).toBe(0);
    expect((plan.payload.composition?.notes ?? []).join(' ')).toContain('Composed the auth family');
    expect((plan.payload.pending ?? []).map((p: any) => p.table)).toContain('sys_account');
    expect(plan.payload.databaseSource).toEqual({ kind: 'default' });
  }, CASE_TIMEOUT_MS);

  it('control: an exported OS_DATABASE_URL wins over .env, and is named as exported', async () => {
    const dir = project(['OS_DATABASE_URL=file:from-dotenv.db']);
    enter(dir, { OS_DATABASE_URL: 'file:from-shell.db' });

    const plan = await runJson(invoke(MigratePlan), ['--json']);
    expect(plan.exitCode, JSON.stringify(plan.payload).slice(0, 400)).toBe(0);
    expect(plan.payload.database).toBe('from-shell.db');
    expect(plan.payload.databaseSource).toEqual({ kind: 'process-env', variable: 'OS_DATABASE_URL' });
  }, CASE_TIMEOUT_MS);

  it('apply\'s occupancy gate probes the database .env names, not the default', async () => {
    const dir = project(['OS_DATABASE_URL=file:from-dotenv.db']);
    const file = join(dir, 'from-dotenv.db');
    const seed = new Database(file);
    seed.pragma('journal_mode = wal');
    seed.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    seed.close();
    // A server between requests: attached, idle — what `os serve` leaves open.
    const held = new Database(file);
    held.prepare('SELECT * FROM t').all();
    try {
      enter(dir);
      const apply = await runJson(invoke(MigrateApply), ['--json']);
      expect(apply.payload.error, JSON.stringify(apply.payload).slice(0, 400)).toBe('database_busy');
      expect(apply.payload.database).toBe('from-dotenv.db');
      expect(apply.exitCode).toBe(1);
    } finally {
      held.close();
    }
  }, CASE_TIMEOUT_MS);
});
