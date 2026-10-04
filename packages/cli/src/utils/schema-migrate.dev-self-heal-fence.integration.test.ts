// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21733 — the dev schema self-heal reaches the standalone stack, and a
 * one-shot command boot never applies it, whatever `NODE_ENV` says.
 *
 * The self-heal (`autoMigrate: 'safe'`, #2186) is decided in ONE place,
 * `devAutoMigrateConfig` in `@objectstack/runtime`. The standalone stack reads
 * it under an EXPLICIT `dev: true` only — never under the `NODE_ENV` default
 * its sqlite step-down takes — because `bootSchemaStack` passes no `dev`, and a
 * one-shot command boot under `NODE_ENV=development` would otherwise inherit
 * the self-heal:
 *
 *   - a NON-deferred one-shot boot (every write mode: `os meta resync --yes`,
 *     the data commands' `--apply`) runs boot schema sync, so it would apply
 *     safe drift its operator never saw in a preview;
 *   - `os migrate plan` defers its DDL (#3917), so its own boot never reaches
 *     the reconcile — this file pins that it stays write-free on the card's
 *     staged database anyway, as the claim on #21733 asks.
 *
 * ## The fixture
 *
 * The card's reproduction, in-process: one org-scoped `unique` field, whose
 * index a plain boot creates NULL-safe (`COALESCE(organization_id, …)`), then
 * replaced by the bare `(organization_id, qa_code)` index an older release
 * left behind. That is a `recreate_index` drift the duplicate probe finds
 * clean, i.e. `safe`: exactly what the self-heal applies. The serving
 * declaration (`createStandaloneStack({ dev: true })`, what `os dev` hands it)
 * is the positive control — it heals the same staged file, so the fence cases
 * cannot be green because the fixture has nothing to heal.
 *
 * Every case runs with `NODE_ENV=development` — the input the fence is about.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import { isExitSignal } from './format.js';
import { bootSchemaStack } from './schema-migrate.js';
import MigratePlan from '../commands/migrate/plan.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: the boots reach them through dynamic `import()`s, which vitest
// clocks (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..');

const CASE_TIMEOUT_MS = 120_000;

const INDEX = 'uniq_scaf_item_organization_id_qa_code';

const ARTIFACT = {
  manifest: { id: 'com.example.scaf', namespace: 'scaf', name: 'scaf', version: '1.0.0', type: 'app' },
  objects: [{
    name: 'scaf_item',
    label: 'Item',
    sharingModel: 'private',
    fields: { qa_code: { type: 'text', label: 'QA code', unique: true } },
  }],
};

/** Env that would point a boot somewhere other than the fixture. */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;
const SAVED_KEYS = [...OVERRIDING_ENV, 'OS_ARTIFACT_PATH', 'NODE_ENV', 'OS_SECRET_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

let dir: string;
let stagedDb: string;

function probe(dbFile: string): SqlDriver {
  return new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
}

/** The index's DDL exactly as `sqlite_master` stores it. */
async function indexSql(dbFile: string): Promise<string | undefined> {
  const driver = probe(dbFile);
  try {
    const rows = await (driver as any).knex.raw('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?', ['index', INDEX]);
    return (rows as Array<{ sql: string }>)[0]?.sql;
  } finally {
    await driver.disconnect();
  }
}

/** A fresh copy of the staged database for one case. */
function stagedCopy(label: string): string {
  const caseDir = join(dir, 'cases', label);
  mkdirSync(caseDir, { recursive: true });
  const dbFile = join(caseDir, 'app.db');
  copyFileSync(stagedDb, dbFile);
  return dbFile;
}

/** A booted serving stack: the standalone stack's own plugins, started, then shut down. */
async function bootServing(dbFile: string, dev: boolean | undefined): Promise<void> {
  const { createStandaloneStack, Runtime } = await import('@objectstack/runtime');
  const stack = await createStandaloneStack({
    projectRoot: dir,
    databaseUrl: `file:${dbFile}`,
    ...(dev === undefined ? {} : { dev }),
  });
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  for (const plugin of stack.plugins) await kernel.use(plugin as any);
  await runtime.start();
  await kernel.shutdown();
}

/**
 * Run the real `os migrate plan --json` through oclif and return its document.
 * The stdout spy goes in BEFORE the boot (a `--json` boot reserves stdout and
 * keeps whatever `process.stdout.write` is at that moment); `process.exit` and
 * the process-global `exitCode` `emitJson` sets are trapped and restored.
 */
async function runPlanJson(dbFile: string): Promise<any> {
  const savedExitCode = process.exitCode;
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
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__PROCESS_EXIT__:${code ?? 0}`);
  }) as never);
  process.chdir(dirname(dbFile));
  try {
    try {
      await MigratePlan.run(['--database-url', `file:${dbFile}`, '--json'], { root: CLI_ROOT });
    } catch (error) {
      const trapped = error instanceof Error && error.message.startsWith('__PROCESS_EXIT__');
      if (!trapped && !isExitSignal(error)) throw error;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    return JSON.parse(out);
  } finally {
    vi.restoreAllMocks();
    process.chdir(savedCwd);
    process.exitCode = savedExitCode;
  }
}

const isNullSafe = (sql: string | undefined): boolean => /COALESCE\(`?organization_id`?/.test(sql ?? '');

beforeAll(async () => {
  for (const key of SAVED_KEYS) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  process.env.NODE_ENV = 'development';
  // Never minted onto disk by a settings provider in this posture.
  process.env.OS_SECRET_KEY = randomBytes(32).toString('hex');

  dir = mkdtempSync(join(tmpdir(), 'os-21733-fence-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  writeFileSync(process.env.OS_ARTIFACT_PATH, JSON.stringify(ARTIFACT));

  // A plain boot creates the table and its NULL-safe unique index…
  stagedDb = join(dir, 'data', 'staged.db');
  await bootServing(stagedDb, false);
  expect(isNullSafe(await indexSql(stagedDb)), 'the fixture boot did not create the NULL-safe index').toBe(true);
  // …which the card's step 3 replaces with the bare one an older release left.
  const driver = probe(stagedDb);
  try {
    const k = (driver as any).knex;
    await k.raw(`DROP INDEX ${INDEX}`);
    await k.raw(`CREATE UNIQUE INDEX ${INDEX} ON scaf_item (organization_id, qa_code)`);
  } finally {
    await driver.disconnect();
  }
  expect(isNullSafe(await indexSql(stagedDb)), 'the staging step did not leave the bare index').toBe(false);
}, CASE_TIMEOUT_MS);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('#21733 — the dev self-heal on the standalone stack, and its one-shot fence (NODE_ENV=development)', () => {
  it('the serving declaration (`dev: true`, what `os dev` passes) heals the staged index on restart', async () => {
    const dbFile = stagedCopy('serving-dev');
    await bootServing(dbFile, true);
    const sql = await indexSql(dbFile);
    expect(isNullSafe(sql), `the dev boot left the bare index: ${sql}`).toBe(true);
  }, CASE_TIMEOUT_MS);

  it('a non-deferred one-shot boot (`bootSchemaStack`, every write mode) leaves the safe drift in place', async () => {
    const dbFile = stagedCopy('one-shot-write');
    const stack = await bootSchemaStack({ jsonOutput: false, databaseUrl: `file:${dbFile}`, projectRoot: dir });
    let drift: Array<{ category: string; op: { type: string } }>;
    try {
      drift = await stack.driver!.detectManagedDrift() as any;
    } finally {
      await stack.shutdown();
    }
    // Still there, and still the kind the self-heal WOULD apply — so the
    // boot declined it rather than having nothing to do.
    expect(drift.map((d) => `${d.category}:${d.op.type}`)).toContain('safe:recreate_index');
    const sql = await indexSql(dbFile);
    expect(isNullSafe(sql), `a one-shot boot auto-applied safe drift: ${sql}`).toBe(false);
  }, CASE_TIMEOUT_MS);

  it('`os migrate plan` lists the drift as safe and leaves the staged database byte-identical', async () => {
    const dbFile = stagedCopy('plan');
    const before = readFileSync(dbFile);
    const plan = await runPlanJson(dbFile);
    expect(
      (plan.changes ?? []).map((d: { category: string; op: { type: string } }) => `${d.category}:${d.op.type}`),
      `plan output: ${JSON.stringify(plan).slice(0, 400)}`,
    ).toContain('safe:recreate_index');
    expect(Buffer.compare(readFileSync(dbFile), before), 'os migrate plan wrote to the staged database').toBe(0);
    expect(isNullSafe(await indexSql(dbFile))).toBe(false);
  }, CASE_TIMEOUT_MS);
});
