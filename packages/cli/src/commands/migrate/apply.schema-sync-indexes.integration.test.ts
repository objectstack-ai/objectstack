// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32653] `os migrate apply` lists, before its `[y/N]` prompt, the
 * runtime-owned index its flush then builds: the permission-set grant's
 * package-less guard, `uniq_sys_user_permission_set_packageless`.
 *
 * ## What used to happen
 *
 * Apply rendered the held-back work and the drift, then asked. After a `y`,
 * its flush announced the schema-sync pass and that pass built the guard
 * (`schema-migrate.grant-guard.integration.test.ts` pins the build), so the
 * prompt under-reported one DDL statement on the grant table. `os migrate plan`
 * already listed it (#32460, `utils/schema-sync-indexes.ts`).
 *
 * ## What is pinned
 *
 * The real command over a real SQLite file, on an interactive terminal whose
 * answer is `n` (so the database is left as it was and can be read back):
 *
 *  1. a fresh database: the guard is listed on the grant table the same apply
 *     creates, after the held-back work, before the drift, and before the prompt;
 *  2. an upgraded grant table without the guard: listed as a plain build;
 *  3. CONTROL, the guard already stands: not listed, because apply's build sends
 *     no DDL.
 *
 * Ablation (recorded in the PR): with apply's call to `renderSchemaSyncIndexes`
 * removed, cases 1 and 2 go red at the listing; case 3 stays green.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import Database from 'better-sqlite3';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { isExitSignal } from '../../utils/format.js';
import MigrateApply from './apply.js';

// Paid at module load, not inside a clocked case (`check:test-source-alias`).
import '@objectstack/runtime';
import '@objectstack/objectql';
import '@objectstack/metadata-protocol';

/** Every line the run said, and every question it asked, in the order they reached the terminal. */
const said: string[] = [];
/** The answer the operator gives at the prompt. */
const ANSWER = 'n';
const PROMPT_MARK = '__PROMPT__ ';

vi.mock('node:readline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:readline')>();
  return {
    ...actual,
    createInterface: () => ({
      question: (q: string, answer: (a: string) => void) => { said.push(PROMPT_MARK + q); answer(ANSWER); },
      close: () => {},
    }),
  };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 240_000;

/** Env that would point a boot somewhere other than the fixture, or change what it composes. */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'OS_DATABASE_AUTH_TOKEN',
  'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_ARTIFACT_PATH', 'OS_TELEMETRY_DB', 'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED', 'OS_SKIP_SCHEMA_SYNC', 'NODE_ENV', 'OS_ENVIRONMENT_ID',
  'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET',
] as const;

const GRANTS = 'sys_user_permission_set';
const GUARD = 'uniq_sys_user_permission_set_packageless';
const APP_TABLE = 'm32653_task';
const INDEX_LINE = `${GRANTS}.${GUARD}`;
const HEADING = 'Runtime-owned indexes (built when you apply, after the work above)';

const HOST_CONFIG = [
  'export default {',
  "  manifest: { id: 'com.example.m32653', name: 'm32653', version: '0.0.0', type: 'app' },",
  '  objects: [',
  `    { name: '${APP_TABLE}', fields: { title: { type: 'text' } } },`,
  '  ],',
  '};',
  '',
].join('\n');

let dir: string;
let projectDir: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

/** Run statements against the file through a connection of their own. */
function local<T>(file: string, read: (db: Database.Database) => T): T {
  const db = new Database(file);
  try {
    return read(db);
  } finally {
    db.close();
  }
}

/** Whether the grant table exists, and whether the guard stands on it. */
const grantState = (file: string) => local(file, (db) => {
  const rows = db.prepare(
    "SELECT type, name FROM sqlite_master WHERE (type = 'table' AND name = ?) OR (type = 'index' AND name = ?)",
  ).all(GRANTS, GUARD) as Array<{ type: string }>;
  return { table: rows.some((r) => r.type === 'table'), guard: rows.some((r) => r.type === 'index') };
});

/** The environment's own syncing boot: every table, and the guard with the grant table. */
async function syncedFixture(file: string): Promise<void> {
  process.chdir(projectDir);
  try {
    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${file}`,
      projectRoot: projectDir,
      composeHostStack: true,
      composeServedPlatform: true,
    });
    await stack.shutdown();
  } finally {
    process.chdir(savedCwd);
  }
}

/** The real command on an interactive terminal that answers {@link ANSWER}. */
async function applyInteractively(file: string): Promise<{ lines: string[]; exitCode: number }> {
  said.length = 0;
  const savedExit = process.exitCode;
  const savedTty = process.stdin.isTTY;
  const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
  vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
  const capture = (...parts: unknown[]) => { said.push(parts.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  let processExit: number | undefined;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    processExit = code ?? 0;
    throw new Error(`__PROCESS_EXIT__:${processExit}`);
  }) as never);
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  process.chdir(projectDir);
  let thrownExit: number | undefined;
  try {
    try {
      await MigrateApply.run(['--database-url', `file:${file}`], { root: CLI_ROOT });
    } catch (error) {
      const trapped = error instanceof Error && error.message.startsWith('__PROCESS_EXIT__');
      if (!trapped && !isExitSignal(error)) throw error;
      if (!trapped) thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    return {
      lines: said.flatMap((l) => l.split('\n')),
      exitCode: processExit ?? thrownExit ?? (process.exitCode as number | undefined) ?? 0,
    };
  } finally {
    process.chdir(savedCwd);
    process.exitCode = savedExit;
    Object.defineProperty(process.stdin, 'isTTY', { value: savedTty, configurable: true });
    vi.restoreAllMocks();
  }
}

const plain = (line: string) => stripVTControlCharacters(line);

/** Where the run asked `[y/N]`, which it must have. */
function promptAt(lines: string[]): number {
  const at = lines.findIndex((l) => l.startsWith(PROMPT_MARK) && l.includes('[y/N]'));
  expect(at, `apply never asked:\n${lines.slice(-60).join('\n')}`).toBeGreaterThanOrEqual(0);
  return at;
}

beforeAll(() => {
  for (const key of OVERRIDING_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  dir = mkdtempSync(join(tmpdir(), 'os-32653-'));
  projectDir = join(dir, 'project');
  mkdirSync(join(projectDir, 'dist'), { recursive: true });
  writeFileSync(join(projectDir, 'objectstack.config.ts'), HOST_CONFIG);
  process.env.OS_ARTIFACT_PATH = join(projectDir, 'dist', 'objectstack.json'); // deliberately absent
  process.env.NODE_ENV = 'production';
  process.env.OS_TELEMETRY_DB = '0';
  process.env.OS_HOME = join(dir, 'home');
});

afterAll(() => {
  process.chdir(savedCwd);
  for (const key of OVERRIDING_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('[#32653] os migrate apply lists the schema-sync index step before its [y/N] prompt', () => {
  it('a fresh database: the guard is listed on the grant table the same apply creates, before the drift and the prompt', async () => {
    const file = join(dir, 'fresh.db');

    const { lines, exitCode } = await applyInteractively(file);
    const prompt = promptAt(lines);
    const heading = lines.findIndex((l) => plain(l).includes(HEADING));
    const step = lines.findIndex((l) => plain(l).includes(INDEX_LINE));
    expect(heading, `no index section in:\n${lines.map(plain).join('\n')}`).toBeGreaterThanOrEqual(0);
    expect(step).toBe(heading + 1);
    expect(plain(lines[step]!)).toContain('+ ');
    expect(plain(lines[step]!)).toContain('on the table created above');
    expect(step).toBeLessThan(prompt);
    // The order apply performs them in: the held-back work, then the index, then the drift.
    const created = lines.findIndex((l) => plain(l).includes(`+ ${GRANTS} [create_table`));
    expect(created, 'the grant table is held-back work on a fresh database').toBeGreaterThanOrEqual(0);
    expect(created).toBeLessThan(heading);

    // `n`: nothing was built.
    expect(exitCode).toBe(0);
    expect(lines.some((l) => plain(l).includes('Aborted — no changes made.'))).toBe(true);
    expect(grantState(file)).toEqual({ table: false, guard: false });
  }, CASE_TIMEOUT_MS);

  it('an upgraded grant table without the guard: listed as a build before the prompt', async () => {
    const file = join(dir, 'upgrade.db');
    await syncedFixture(file);
    // Apply needs work of its own, or it never flushes and never builds the guard.
    local(file, (db) => db.exec(`DROP INDEX "${GUARD}"; DROP TABLE "${APP_TABLE}";`));
    expect(grantState(file)).toEqual({ table: true, guard: false });

    const { lines } = await applyInteractively(file);
    const prompt = promptAt(lines);
    const step = lines.findIndex((l) => plain(l).includes(INDEX_LINE));
    expect(step, `no index step in:\n${lines.map(plain).join('\n')}`).toBeGreaterThanOrEqual(0);
    expect(step).toBeLessThan(prompt);
    expect(plain(lines[step]!)).toContain('+ ');
    expect(plain(lines[step]!)).not.toContain('on the table created above');
    expect(grantState(file)).toEqual({ table: true, guard: false });
  }, CASE_TIMEOUT_MS);

  it('CONTROL: the guard already stands: not listed, because apply sends it no DDL', async () => {
    const file = join(dir, 'standing.db');
    await syncedFixture(file);
    local(file, (db) => db.exec(`DROP TABLE "${APP_TABLE}";`));
    expect(grantState(file)).toEqual({ table: true, guard: true });

    const { lines } = await applyInteractively(file);
    promptAt(lines);
    expect(lines.some((l) => plain(l).includes(HEADING))).toBe(false);
    expect(lines.some((l) => plain(l).includes(INDEX_LINE))).toBe(false);
  }, CASE_TIMEOUT_MS);
});
