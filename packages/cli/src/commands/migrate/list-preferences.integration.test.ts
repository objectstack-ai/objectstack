// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35955] `os migrate list-preferences` against a real boot and a real
 * SQLite database.
 *
 * ## The fixture
 *
 * `sys_user_preference` rows written through a SYSTEM insert, in two
 * organizations:
 *
 *  - the retired family, `ui.list.<object>`: three readers in organization A,
 *    one in organization B;
 *  - rows that must survive: `ui.record.account` (the record page's family,
 *    still read), `ui.recent`, the bare key `ui.list`, a look-alike prefix
 *    `ui.listx.account`, and `UI.LIST.account` — a key SQLite's `LIKE` matches
 *    against the prefix, since it compares ASCII without case, so it proves
 *    the family is judged byte for byte after the read.
 *
 * ## What each case proves
 *
 *  - The dry run counts per key and readers, writes no row, no table and no
 *    file.
 *  - `--apply --export` writes the export owner-only first — the first delete
 *    FINDS it complete on disk (the order pin) — deletes the family in both
 *    organizations and nothing else, and reads back zero.
 *  - A second run finds nothing, writes no export and exits 0.
 *  - The refusals answer their own `error` code and exit 1, with nothing
 *    deleted.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectQL } from '@objectstack/objectql';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { isExitSignal } from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { composeProviderForDeclarations } from '../../utils/schema-migration-plugins.js';
import MigrateListPreferences from './list-preferences.js';

// Pay the first load of what `bootSchemaStack` and the command reach through
// dynamic `import()`s at MODULE LOAD, outside any clocked case.
import '@objectstack/service-datasource';
import '@objectstack/driver-turso';
import '@objectstack/runtime';
import '@objectstack/rest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 120_000;
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;
const SYSTEM = { context: { isSystem: true } };
const TABLE = 'sys_user_preference';

const ARTIFACT = {
  manifest: { id: 'com.example.list-preferences', name: 'List Preferences', version: '0.0.0', type: 'app' },
  objects: [{ name: 'lp_account', fields: { name: { type: 'text' } } }],
};

const ORG_A = 'org_lp_a';
const ORG_B = 'org_lp_b';

/** The retired family, in two organizations. */
const FAMILY = [
  { id: 'p_u1_account', organization_id: ORG_A, user_id: 'u1', key: 'ui.list.account', value: { perView: { all: { widths: { name: 240 } } } } },
  { id: 'p_u2_account', organization_id: ORG_A, user_id: 'u2', key: 'ui.list.account', value: { viewOrder: ['b', 'a'] } },
  { id: 'p_u1_contact', organization_id: ORG_A, user_id: 'u1', key: 'ui.list.contact', value: { perView: { all: { sort: [{ field: 'name', order: 'asc' }] } } } },
  { id: 'p_u3_account', organization_id: ORG_B, user_id: 'u3', key: 'ui.list.account', value: { perView: { all: { rowHeight: 44 } } } },
];

/** Rows that must survive every run. */
const SURVIVORS = [
  { id: 's_record', organization_id: ORG_A, user_id: 'u1', key: 'ui.record.account', value: { showEmptyFields: false } },
  { id: 's_recent', organization_id: ORG_A, user_id: 'u1', key: 'ui.recent', value: ['lp_account'] },
  { id: 's_bare', organization_id: ORG_A, user_id: 'u1', key: 'ui.list', value: true },
  { id: 's_lookalike', organization_id: ORG_A, user_id: 'u1', key: 'ui.listx.account', value: true },
  { id: 's_case', organization_id: ORG_B, user_id: 'u3', key: 'UI.LIST.account', value: true },
];

const FAMILY_IDS = FAMILY.map((r) => r.id).sort();
const SURVIVOR_IDS = SURVIVORS.map((r) => r.id).sort();

let dir: string;
let templateDb: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

/** The table's ids, read on a connection of our own. */
async function idsOf(dbFile: string): Promise<string[]> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    return ((await (driver as any).knex(TABLE).select('id').orderBy('id')) as Array<{ id: string }>).map((r) => r.id);
  } finally {
    await driver.disconnect();
  }
}

/** The schema plus every row of every table, as plain JSON. */
async function readState(dbFile: string): Promise<unknown> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  const k = (driver as any).knex;
  try {
    const schema = await k.raw('SELECT type, name, sql FROM sqlite_master ORDER BY type, name');
    const rows: Record<string, unknown> = {};
    for (const entry of schema as Array<{ type: string; name: string }>) {
      if (entry.type !== 'table' || entry.name.startsWith('sqlite_')) continue;
      rows[entry.name] = await k.raw(`SELECT * FROM "${entry.name}" ORDER BY rowid`);
    }
    return { schema, rows };
  } finally {
    await driver.disconnect();
  }
}

interface RunResult { payload: any; exitCode: number }

async function runJson(argv: string[]): Promise<RunResult> {
  const savedExit = process.exitCode;
  const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
  const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    .map((s) => s.mockImplementation(() => {}));
  let thrownExit: number | undefined;
  try {
    try {
      await MigrateListPreferences.run(argv, { root: CLI_ROOT });
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
    stdout.mockRestore();
    stderr.mockRestore();
    for (const s of logs) s.mockRestore();
  }
}

let caseSeq = 0;
function prepareCase(): { dbFile: string; caseDir: string; url: string } {
  caseSeq += 1;
  const caseDir = join(dir, 'cases', String(caseSeq));
  mkdirSync(caseDir, { recursive: true });
  const dbFile = join(caseDir, 'app.db');
  copyFileSync(templateDb, dbFile);
  return { dbFile, caseDir, url: `file:${dbFile}` };
}

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'OS_ARTIFACT_PATH', 'NODE_ENV', 'OS_SECRET_KEY'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  process.env.NODE_ENV = 'production';
  process.env.OS_SECRET_KEY = randomBytes(32).toString('hex');
  dir = mkdtempSync(join(tmpdir(), 'os-35955-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  writeFileSync(process.env.OS_ARTIFACT_PATH, JSON.stringify(ARTIFACT));
  templateDb = join(dir, 'data', 'template.db');
  process.chdir(dir);
  const stack = await bootSchemaStack({
    jsonOutput: false,
    databaseUrl: `file:${templateDb}`,
    projectRoot: dir,
    extraPlugins: [composeProviderForDeclarations(createIdentityObjectsPlugin())],
  });
  try {
    const ql = stack.kernel.getService('objectql') as ObjectQL;
    for (const row of [...FAMILY, ...SURVIVORS]) await ql.insert(TABLE, row, SYSTEM);
  } finally {
    await stack.shutdown();
  }
  process.chdir(savedCwd);
  // Non-vacuity: the seed is the state every case starts from.
  expect(await idsOf(templateDb)).toEqual([...FAMILY_IDS, ...SURVIVOR_IDS].sort());
}, 180_000);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => { process.chdir(dir); });
afterEach(() => { process.chdir(savedCwd); vi.restoreAllMocks(); });

describe('[#35955] os migrate list-preferences — the default run is a dry run that writes nothing', () => {
  it('counts the family per key and reader, in every organization, and writes no row, table or file', async () => {
    const c = prepareCase();
    const before = await readState(c.dbFile);

    const { payload, exitCode } = await runJson(['--database-url', c.url, '--json']);

    expect(exitCode).toBe(0);
    expect(payload.mode).toBe('report');
    expect(payload.plan).toEqual({
      object: TABLE,
      prefix: 'ui.list.',
      counts: { rows: 4, users: 3, organizations: 2 },
      byKey: [
        { key: 'ui.list.account', rows: 3, users: 3 },
        { key: 'ui.list.contact', rows: 1, users: 1 },
      ],
    });
    // Counts only: no stored value reaches the report.
    expect(JSON.stringify(payload)).not.toContain('240');
    expect(await readState(c.dbFile)).toEqual(before);
    expect(existsSync(join(c.caseDir, 'export.json'))).toBe(false);
  }, CASE_TIMEOUT_MS);
});

describe('[#35955] os migrate list-preferences --apply --export', () => {
  it('writes the export owner-only, deletes the family in both organizations and nothing else, and reads back zero', async () => {
    const c = prepareCase();
    const exportPath = join(c.caseDir, 'export.json');

    const { payload, exitCode } = await runJson(['--apply', '--export', exportPath, '--yes', '--database-url', c.url, '--json']);

    expect(payload.error, JSON.stringify(payload).slice(0, 400)).toBeUndefined();
    expect(exitCode).toBe(0);
    expect(payload).toMatchObject({ mode: 'apply', deleted: 4, failed: [], remaining: 0 });
    expect(await idsOf(c.dbFile)).toEqual(SURVIVOR_IDS);

    expect(statSync(exportPath).mode & 0o777).toBe(0o600);
    const doc = JSON.parse(readFileSync(exportPath, 'utf8'));
    expect(doc.format).toBe('objectstack.list-preferences.pre-delete-export.v1');
    expect(doc.rows.map((r: { id: string }) => r.id).sort()).toEqual(FAMILY_IDS);
    // Each row as stored, its organization and value included.
    const u3 = doc.rows.find((r: { id: string }) => r.id === 'p_u3_account');
    expect(u3).toMatchObject({ organization_id: ORG_B, user_id: 'u3', key: 'ui.list.account' });
    expect(JSON.stringify(u3.value)).toContain('44');
  }, CASE_TIMEOUT_MS);

  it('the first delete finds the export already on disk, holding every row the run deletes', async () => {
    const c = prepareCase();
    const exportPath = join(c.caseDir, 'export.json');
    const original = ObjectQL.prototype.delete;
    let seenAtFirstDelete: string[] | 'no file' | undefined;
    // Intercept the command's own delete, and only that one.
    vi.spyOn(ObjectQL.prototype, 'delete').mockImplementation(async function (this: ObjectQL, object: string, options?: any) {
      if (object === TABLE && seenAtFirstDelete === undefined) {
        seenAtFirstDelete = existsSync(exportPath)
          ? JSON.parse(readFileSync(exportPath, 'utf8')).rows.map((r: { id: string }) => r.id).sort()
          : 'no file';
        throw Object.assign(new Error('injected: the first delete refuses'), { code: 'INJECTED_REFUSAL' });
      }
      return original.call(this, object, options);
    });

    const { payload, exitCode } = await runJson(['--apply', '--export', exportPath, '--yes', '--database-url', c.url, '--json']);

    // Non-vacuity: the command reached its delete through the intercepted method.
    expect(seenAtFirstDelete).toEqual(FAMILY_IDS);
    // The refused row is judged by what is still stored, and the run exits 1.
    expect(exitCode).toBe(1);
    expect(payload.deleted).toBe(3);
    expect(payload.remaining).toBe(1);
    expect(payload.failed).toEqual([expect.objectContaining({ code: 'INJECTED_REFUSAL' })]);
    expect(await idsOf(c.dbFile)).toEqual([payload.failed[0].id, ...SURVIVOR_IDS].sort());
  }, CASE_TIMEOUT_MS);

  it('is re-runnable: a second run finds nothing, writes no export and exits 0', async () => {
    const c = prepareCase();

    const first = await runJson(['--apply', '--export', join(c.caseDir, 'first.json'), '--yes', '--database-url', c.url, '--json']);
    expect(first.exitCode).toBe(0);
    const second = await runJson(['--apply', '--export', join(c.caseDir, 'second.json'), '--yes', '--database-url', c.url, '--json']);

    expect(second.exitCode).toBe(0);
    expect(second.payload).toMatchObject({ mode: 'apply', deleted: 0, remaining: 0, plan: { counts: { rows: 0 } } });
    expect(existsSync(join(c.caseDir, 'second.json'))).toBe(false);
    expect(await idsOf(c.dbFile)).toEqual(SURVIVOR_IDS);
  }, CASE_TIMEOUT_MS);
});

describe('[#35955] os migrate list-preferences — refusals answer their code and exit 1, with nothing deleted', () => {
  it('--apply without --export is refused before anything boots', async () => {
    const c = prepareCase();
    const before = await readState(c.dbFile);

    const { payload, exitCode } = await runJson(['--apply', '--yes', '--database-url', c.url, '--json']);

    expect(payload.error).toBe('export_required');
    expect(exitCode).toBe(1);
    expect(await readState(c.dbFile)).toEqual(before);
  }, CASE_TIMEOUT_MS);

  it('an export path that already exists is refused, and left as it was', async () => {
    const c = prepareCase();
    const exportPath = join(c.caseDir, 'export.json');
    writeFileSync(exportPath, 'not ours');

    const { payload, exitCode } = await runJson(['--apply', '--export', exportPath, '--yes', '--database-url', c.url, '--json']);

    expect(payload.error).toBe('export_exists');
    expect(exitCode).toBe(1);
    expect(readFileSync(exportPath, 'utf8')).toBe('not ours');
    expect(await idsOf(c.dbFile)).toEqual([...FAMILY_IDS, ...SURVIVOR_IDS].sort());
  }, CASE_TIMEOUT_MS);

  it('an export path that cannot be written refuses the run, with no row deleted', async () => {
    const c = prepareCase();
    const exportPath = join(c.caseDir, 'no-such-directory', 'export.json');

    const { payload, exitCode } = await runJson(['--apply', '--export', exportPath, '--yes', '--database-url', c.url, '--json']);

    expect(payload.error).toBe('export_failed');
    expect(exitCode).toBe(1);
    expect(existsSync(exportPath)).toBe(false);
    expect(await idsOf(c.dbFile)).toEqual([...FAMILY_IDS, ...SURVIVOR_IDS].sort());
  }, CASE_TIMEOUT_MS);

  it('--apply under --json without --yes asks for it, with nothing written', async () => {
    const c = prepareCase();
    const exportPath = join(c.caseDir, 'export.json');

    const { payload, exitCode } = await runJson(['--apply', '--export', exportPath, '--database-url', c.url, '--json']);

    expect(payload.error).toBe('confirmation_required');
    expect(exitCode).toBe(1);
    expect(existsSync(exportPath)).toBe(false);
    expect(await idsOf(c.dbFile)).toEqual([...FAMILY_IDS, ...SURVIVOR_IDS].sort());
  }, CASE_TIMEOUT_MS);
});
