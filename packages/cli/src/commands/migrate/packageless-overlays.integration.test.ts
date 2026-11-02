// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate packageless-overlays` against a real SQLite database: the
 * ceremony that moves package-less overlay rows of a shipped name into the
 * base's paired `<base>.custom` as declared overrides (ADR-0146 D11, N-16a).
 *
 * ## The fixture
 *
 * A compiled artifact (`dist/objectstack.json`, the shape a deployed app boots
 * from) whose package ships an object and its list view, over a database an
 * older release left behind with, bound to no package:
 *
 *  - MOVED: an active row and a draft row of the package's view;
 *  - CONTROL, never moved: a view row of a name no package ships (environment
 *    metadata), and a draft `permission` row over a name the package ships
 *    (the security catalog's, ADR-0146 D6 — not an overlay type).
 *
 * ## What each case measures
 *
 * The command runs in-process through oclif, as the binary runs it. The
 * preview writes nothing; `--apply` creates the pair through its door
 * (`sys_packages` holds it), moves both rows with the declaration, leaves the
 * controls, and a FRESH boot of the same database then serves the moved
 * content under the base's name on the package-less read, the read naming the
 * base, the layered read and the base's list; a second `--apply` moves 0.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import { PackageServicePlugin } from '@objectstack/service-package';
import { isExitSignal } from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import MigratePackagelessOverlays from './packageless-overlays.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: the command reaches them through dynamic `import()`s inside
// `run()`, which vitest clocks (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import '@objectstack/metadata-protocol';
import '@objectstack/platform-objects/plugin';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 180_000;

const PKG = 'com.example.m28413';
const PAIR = `${PKG}.custom`;
const VIEW = 'm28413_task.default';
const ENV_VIEW = 'm28413_env.default';
const SHIPPED_COLUMNS = ['title', 'status', 'owner'];
const STORED_COLUMNS = ['title', 'owner'];
const DRAFT_COLUMNS = ['title'];
const ARTIFACT = {
  manifest: { id: PKG, name: 'm28413', version: '1.4.0', type: 'app', namespace: 'm28413' },
  objects: [{
    name: 'm28413_task',
    label: 'Task',
    sharingModel: 'private',
    fields: Object.fromEntries(SHIPPED_COLUMNS.map((f) => [f, { name: f, label: f, type: 'text' }])),
  }],
  views: [{
    object: 'm28413_task',
    list: { label: 'All', type: 'grid', data: { provider: 'object', object: 'm28413_task' }, columns: SHIPPED_COLUMNS.map((field) => ({ field })) },
  }],
  permissions: [{ name: 'm28413_rep', label: 'Rep', objects: {} }],
};

const viewBody = (name: string, columns: readonly string[]) => ({
  name,
  object: 'm28413_task',
  viewKind: 'list',
  label: 'Saved in Setup',
  config: { type: 'grid', data: { provider: 'object', object: 'm28413_task' }, columns: columns.map((field) => ({ field })) },
});

interface SeedRow { type: string; name: string; state: string; body: Record<string, unknown> }
const SEED: SeedRow[] = [
  { type: 'view', name: VIEW, state: 'active', body: viewBody(VIEW, STORED_COLUMNS) },
  { type: 'view', name: VIEW, state: 'draft', body: viewBody(VIEW, DRAFT_COLUMNS) },
  // Controls.
  { type: 'view', name: ENV_VIEW, state: 'active', body: viewBody(ENV_VIEW, STORED_COLUMNS) },
  // A DRAFT: an active one over a package's name refuses the cold boot, which
  // is \`os migrate security-catalog-overlays\`' to clear, not this ceremony's.
  { type: 'permission', name: 'm28413_rep', state: 'draft', body: { name: 'm28413_rep', label: 'Saved in the environment', objects: {} } },
];

let dir: string;
let templateDb: string;
const savedCwd = process.cwd();
const ENV_KEYS = ['OS_ARTIFACT_PATH', 'OS_DATABASE_URL', 'DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'NODE_ENV',
  'OS_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OS_ENVIRONMENT_ID'] as const;
const savedEnv: Record<string, string | undefined> = {};

let caseSeq = 0;
function caseDb(): string {
  caseSeq += 1;
  const file = join(dir, 'cases', `${caseSeq}.db`);
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(templateDb, file);
  return file;
}

/** Every `sys_metadata` row, `type/name@binding/state`, read on a connection of our own. */
async function storedRows(dbFile: string): Promise<string[]> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    const rows = await (driver as any).knex('sys_metadata').select('type', 'name', 'package_id', 'state');
    return rows.map((r: any) => `${r.type}/${r.name}@${r.package_id ?? '-'}/${r.state}`).sort();
  } finally {
    await driver.disconnect();
  }
}

/** One stored body, parsed. */
async function storedBody(dbFile: string, where: Record<string, unknown>): Promise<any> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    const row = await (driver as any).knex('sys_metadata').where(where).first();
    return row ? JSON.parse(row.metadata) : undefined;
  } finally {
    await driver.disconnect();
  }
}

/** The `sys_packages` ids stored. */
async function storedPackages(dbFile: string): Promise<string[]> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    const rows = await (driver as any).knex('sys_packages').select('id');
    return rows.map((r: any) => String(r.id)).sort();
  } finally {
    await driver.disconnect();
  }
}

interface RunResult { payload: any; exitCode: number }

/** Run the command through oclif and capture its one JSON document. */
async function runJson(argv: string[]): Promise<RunResult> {
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
  let thrownExit: number | undefined;
  try {
    try {
      await MigratePackagelessOverlays.run(argv, { root: CLI_ROOT });
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    let payload: any;
    try { payload = JSON.parse(out); } catch { payload = { unparsed: out.slice(-400) }; }
    return { payload, exitCode: thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

const columnsOf = (item: any): string[] => (item?.config?.columns ?? item?.columns ?? []).map((c: any) => c?.field ?? c);

/** What a fresh boot of `dbFile` serves for `VIEW`: the package-less read, the read naming the base, the layered effective, the base's list. */
async function servedColumns(dbFile: string): Promise<string[][]> {
  const stack = await bootSchemaStack({
    jsonOutput: false, databaseUrl: `file:${dbFile}`, projectRoot: dir, composeHostStack: true,
    // The package registry `os serve` composes, so the pair installs from `sys_packages` as it does there.
    extraPlugins: [new PackageServicePlugin()],
  });
  try {
    const protocol = stack.kernel.getService('protocol') as any;
    const read = async (packageId?: string) =>
      (await protocol.getMetaItem({ type: 'view', name: VIEW, ...(packageId ? { packageId } : {}) }))?.item;
    const layered = await protocol.getMetaItemLayered({ type: 'view', name: VIEW });
    const list = await protocol.getMetaItems({ type: 'view', packageId: PKG });
    return [
      columnsOf(await read()),
      columnsOf(await read(PKG)),
      columnsOf(layered?.effective),
      ...((list?.items ?? []) as any[]).filter((i) => i?.name === VIEW).map((i) => columnsOf(i)),
    ];
  } finally {
    await stack.shutdown();
  }
}

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.NODE_ENV = 'production';
  dir = mkdtempSync(join(tmpdir(), 'os-28413-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  process.env.OS_HOME = join(dir, 'home');
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  writeFileSync(process.env.OS_ARTIFACT_PATH, JSON.stringify(ARTIFACT));

  // The database an older release left: tables provisioned, then the
  // package-less rows written at the driver the way that release stored them.
  templateDb = join(dir, 'template.db');
  const seed = await bootSchemaStack({
    jsonOutput: false, databaseUrl: `file:${templateDb}`, projectRoot: dir, hydrateMetadata: false,
    extraPlugins: [new PackageServicePlugin()],
  });
  await seed.shutdown();
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: templateDb }, useNullAsDefault: true });
  try {
    const k = (driver as any).knex;
    const now = new Date().toISOString();
    let n = 0;
    for (const row of SEED) {
      n += 1;
      await k('sys_metadata').insert({
        id: `seed_${n}`, type: row.type, name: row.name, package_id: null, state: row.state,
        version: 1, checksum: null, created_at: now, updated_at: now, metadata: JSON.stringify(row.body),
      });
    }
  } finally {
    await driver.disconnect();
  }
}, CASE_TIMEOUT_MS);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// The command takes `process.cwd()` as the project root, as a real invocation does.
beforeEach(() => { process.chdir(dir); });
afterEach(() => { process.chdir(savedCwd); });

describe('os migrate packageless-overlays', () => {
  it('the preview lists the shipped name\'s rows to move, counts the environment row, and writes nothing', async () => {
    const db = caseDb();
    const before = await storedRows(db);
    const { payload, exitCode } = await runJson(['--database-url', `file:${db}`, '--json']);
    expect(payload.error, JSON.stringify(payload).slice(0, 600)).toBeUndefined();
    expect(exitCode).toBe(0);
    expect(payload.apply).toBe(false);
    expect(payload.rows.map((r: any) => `${r.type}/${r.name}/${r.state} ${r.disposition} → ${r.pair}`)).toEqual([
      `view/${VIEW}/active movable → ${PAIR}`,
      `view/${VIEW}/draft movable → ${PAIR}`,
    ]);
    expect(payload.environmentRows).toBe(1);
    expect(await storedRows(db)).toEqual(before);
    expect(await storedPackages(db)).not.toContain(PAIR);
  }, CASE_TIMEOUT_MS);

  it('--apply moves both rows into the pair with the declaration, keeps the controls, serves the same content, and a re-run moves 0', async () => {
    const db = caseDb();
    const served = await servedColumns(db);
    expect(served).toEqual([STORED_COLUMNS, STORED_COLUMNS, STORED_COLUMNS, STORED_COLUMNS]);

    const { payload, exitCode } = await runJson(['--apply', '--yes', '--database-url', `file:${db}`, '--json']);
    expect(payload.error, JSON.stringify(payload).slice(0, 600)).toBeUndefined();
    expect(exitCode).toBe(0);
    expect(payload.moved).toBe(2);
    expect(payload.failed).toBe(0);
    expect(payload.bases).toEqual([{ base: PKG, pair: PAIR, pairCreated: true, moved: 2, declarationsCompleted: 0, failed: 0, shadowed: 0 }]);
    expect(payload.rows.map((r: any) => `${r.state} ${r.outcome} ${r.packageId} ${r.basedOn}`)).toEqual([
      `active moved ${PAIR} 1.4.0`,
      `draft moved ${PAIR} 1.4.0`,
    ]);

    expect(await storedRows(db)).toEqual([
      `permission/m28413_rep@-/draft`,
      `view/${ENV_VIEW}@-/active`,
      `view/${VIEW}@${PAIR}/active`,
      `view/${VIEW}@${PAIR}/draft`,
    ]);
    for (const state of ['active', 'draft']) {
      const body = await storedBody(db, { type: 'view', name: VIEW, package_id: PAIR, state });
      expect(body.overrides, state).toEqual({ package: PKG, basedOn: '1.4.0' });
    }
    expect(columnsOf(await storedBody(db, { type: 'view', name: VIEW, package_id: PAIR, state: 'draft' }))).toEqual(DRAFT_COLUMNS);
    // The pair came through its door, so it outlives this process.
    expect(await storedPackages(db)).toContain(PAIR);

    // A fresh boot serves the moved content under the base's name.
    expect(await servedColumns(db)).toEqual(served);

    const again = await runJson(['--apply', '--yes', '--database-url', `file:${db}`, '--json']);
    expect(again.payload.error, JSON.stringify(again.payload).slice(0, 600)).toBeUndefined();
    expect(again.exitCode).toBe(0);
    expect(again.payload.moved).toBe(0);
    expect(again.payload.rows).toEqual([]);
  }, CASE_TIMEOUT_MS * 3);

  it('--apply without --yes in --json refuses and moves nothing', async () => {
    const db = caseDb();
    const before = await storedRows(db);
    const { payload, exitCode } = await runJson(['--apply', '--database-url', `file:${db}`, '--json']);
    expect(payload.error, JSON.stringify(payload).slice(0, 600)).toBe('confirmation_required');
    expect(exitCode).toBe(1);
    expect(await storedRows(db)).toEqual(before);
  }, CASE_TIMEOUT_MS);
});
