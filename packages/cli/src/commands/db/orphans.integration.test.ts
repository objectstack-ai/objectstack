// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24964] `os db orphans` against a real boot and a real SQLite database:
 * the ruling's constraints, each pinned where it can fail.
 *
 * ## The fixture
 *
 * A campaign with a roll-up over its members, members that are required
 * master-detail children of a campaign (`controlled_by_parent`), and notes that
 * are required master-detail children of a member. Seeded through a SYSTEM
 * write, the one door that skips the write-time reference check, as the
 * elevated writer that produced these rows in the field did:
 *
 *  - a live member with a live campaign, and its note — the rows that must
 *    survive;
 *  - an ORPHAN member whose campaign id names no campaign, and its note — the
 *    deeper detail its delete's cascade reaches;
 *  - a member of an object whose master object is not registered at all — its
 *    reference cannot be probed, so it is UNDETERMINED, never an orphan;
 *  - a plain lookup naming no campaign, on the live member — dangling, listed,
 *    never deleted, and no reason to delete the row it sits on;
 *  - an object with no required master-detail at all — not read.
 *
 * ## What each case proves
 *
 *  - The default run reports the orphan with its object, record id, field and
 *    missing master id, and its deeper detail; it writes no row, no table and
 *    no file.
 *  - `--delete` writes the export first — the first delete call FINDS it
 *    complete on disk (the order pin) — and then removes the orphan and its
 *    cascade, and nothing else. The roll-up on the missing master cannot be
 *    recomputed, and the run says so instead of failing.
 *  - The refusals answer their own `error` code and exit 1, with nothing
 *    deleted.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectQL, SUMMARY_RECOMPUTE_CODE } from '@objectstack/objectql';
import { isExitSignal } from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import DbOrphans from './orphans.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 120_000;
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;
const SYSTEM = { context: { isSystem: true } };

const ARTIFACT = {
  manifest: { id: 'com.example.orphan-details', name: 'Orphan Details', version: '0.0.0', type: 'app' },
  objects: [
    {
      name: 'od_campaign',
      fields: {
        name: { type: 'text' },
        member_total: { type: 'summary', summaryOperations: { object: 'od_member', field: 'amount', function: 'sum' } },
      },
    },
    {
      name: 'od_member',
      sharingModel: 'controlled_by_parent',
      fields: {
        name: { type: 'text' },
        amount: { type: 'number' },
        campaign: { type: 'master_detail', reference: 'od_campaign', required: true },
        // A plain lookup: when it dangles, the row does not depend on it to exist.
        referrer: { type: 'lookup', reference: 'od_campaign' },
      },
    },
    {
      name: 'od_member_note',
      sharingModel: 'controlled_by_parent',
      fields: { body: { type: 'text' }, member: { type: 'master_detail', reference: 'od_member', required: true } },
    },
    {
      // Its master object is not registered: no probe of it can run.
      name: 'od_ghost_member',
      fields: { name: { type: 'text' }, ghost: { type: 'master_detail', reference: 'od_ghost', required: true } },
    },
    {
      // No required master-detail field at all: not this command's to read.
      name: 'od_ref',
      fields: { name: { type: 'text' }, campaign_ref: { type: 'lookup', reference: 'od_campaign' } },
    },
  ],
};

const MISSING_CAMPAIGN = 'Spring Promo';

let dir: string;
let templateDb: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

/** A system insert; the roll-up on a missing master refuses AFTER the row is written, as it does in the field. */
async function seedRow(ql: any, object: string, data: Record<string, unknown>): Promise<void> {
  try {
    await ql.insert(object, data, SYSTEM);
  } catch (error) {
    if ((error as { code?: unknown })?.code !== SUMMARY_RECOMPUTE_CODE) throw error;
  }
}

/** The ids each table holds, read on a connection of our own. */
async function idsOf(dbFile: string): Promise<Record<string, string[]>> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  const k = (driver as any).knex;
  try {
    const out: Record<string, string[]> = {};
    for (const table of ['od_campaign', 'od_member', 'od_member_note', 'od_ghost_member', 'od_ref']) {
      out[table] = ((await k(table).select('id').orderBy('id')) as Array<{ id: string }>).map((r) => r.id);
    }
    return out;
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
      await DbOrphans.run(argv, { root: CLI_ROOT });
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
  dir = mkdtempSync(join(tmpdir(), 'os-24964-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  writeFileSync(process.env.OS_ARTIFACT_PATH, JSON.stringify(ARTIFACT));
  templateDb = join(dir, 'data', 'template.db');
  process.chdir(dir);
  const stack = await bootSchemaStack({ jsonOutput: false, databaseUrl: `file:${templateDb}`, projectRoot: dir });
  try {
    const ql = stack.kernel.getService('objectql') as any;
    await seedRow(ql, 'od_campaign', { id: 'c_live', name: 'Live' });
    await seedRow(ql, 'od_member', { id: 'm_live', name: 'kept', amount: 5, campaign: 'c_live', referrer: 'Gone Campaign' });
    await seedRow(ql, 'od_member', { id: 'm_orphan', name: 'orphan', amount: 7, campaign: MISSING_CAMPAIGN });
    await seedRow(ql, 'od_member_note', { id: 'n_live', body: 'kept', member: 'm_live' });
    await seedRow(ql, 'od_member_note', { id: 'n_orphan', body: 'goes with its member', member: 'm_orphan' });
    await seedRow(ql, 'od_ghost_member', { id: 'g_row', name: 'unknown master', ghost: 'nobody_knows' });
    await seedRow(ql, 'od_ref', { id: 'r_row', name: 'dangling lookup', campaign_ref: 'Gone Campaign' });
  } finally {
    await stack.shutdown();
  }
  process.chdir(savedCwd);
  // Non-vacuity: the seed is the state every case starts from.
  expect(await idsOf(templateDb)).toEqual({
    od_campaign: ['c_live'],
    od_member: ['m_live', 'm_orphan'],
    od_member_note: ['n_live', 'n_orphan'],
    od_ghost_member: ['g_row'],
    od_ref: ['r_row'],
  });
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

describe('[#24964] os db orphans — the default run is a report that writes nothing', () => {
  it('lists the orphan with object, record id, field and missing master id, and the deeper detail its delete removes', async () => {
    const c = prepareCase();
    const before = await readState(c.dbFile);

    const { payload, exitCode } = await runJson(['--database-url', c.url, '--json']);

    expect(exitCode).toBe(0);
    expect(payload.mode).toBe('report');
    expect(payload.plan.orphans).toEqual([{
      object: 'od_member',
      recordId: 'm_orphan',
      fields: [{ field: 'campaign', master: 'od_campaign', missingMasterId: MISSING_CAMPAIGN }],
      cascade: [{ object: 'od_member_note', id: 'n_orphan' }],
    }]);
    expect(payload.plan.counts).toMatchObject({ orphans: 1, deeperDetails: 1, withheld: 0 });
    // Zero writes: no row, no table, and no file beside the database.
    expect(await readState(c.dbFile)).toEqual(before);
    expect(existsSync(join(c.caseDir, 'export.json'))).toBe(false);
  }, CASE_TIMEOUT_MS);

  it('an unprobeable master is UNDETERMINED, and a dangling plain lookup is named — neither is an orphan', async () => {
    const c = prepareCase();

    const { payload } = await runJson(['--database-url', c.url, '--json']);

    // The ghost master's object is not registered, so its probe cannot run.
    expect(payload.plan.undetermined).toBeGreaterThanOrEqual(1);
    expect(payload.plan.complete).toBe(false);
    const orphanIds = payload.plan.orphans.map((o: { recordId: string }) => o.recordId);
    expect(orphanIds).not.toContain('g_row');
    // The scan READ the ghost's object: it is undetermined, not unscanned.
    expect(payload.plan.objects).toContain('od_ghost_member');
    // A dangling lookup does not make its row an orphan; it is named for the operator.
    expect(orphanIds).not.toContain('m_live');
    expect(payload.plan.otherDangling).toEqual([{
      objectName: 'od_member', recordId: 'm_live', field: 'referrer', target: 'od_campaign', value: 'Gone Campaign',
    }]);
    // An object with no required master-detail is not this command's to read.
    expect(payload.plan.objects).not.toContain('od_ref');
  }, CASE_TIMEOUT_MS);
});

describe('[#24964] os db orphans --delete', () => {
  it('writes the export first, then removes the orphan and its cascade and nothing else', async () => {
    const c = prepareCase();
    const exportPath = join(c.caseDir, 'export.json');

    const { payload, exitCode } = await runJson(['--delete', '--export', exportPath, '--yes', '--database-url', c.url, '--json']);

    expect(payload.error, JSON.stringify(payload).slice(0, 400)).toBeUndefined();
    expect(exitCode).toBe(0);
    expect(payload.deleted).toEqual([expect.objectContaining({
      object: 'od_member',
      recordId: 'm_orphan',
      removed: [{ object: 'od_member', id: 'm_orphan' }, { object: 'od_member_note', id: 'n_orphan' }],
    })]);
    // The roll-up on the master that does not exist cannot be recomputed; the run says so, and deleted anyway.
    expect(payload.deleted[0].notes.join(' ')).toMatch(/od_campaign\.member_total was not recomputed for Spring Promo/);
    expect(payload.failed).toEqual([]);

    expect(await idsOf(c.dbFile)).toEqual({
      od_campaign: ['c_live'],
      od_member: ['m_live'],
      od_member_note: ['n_live'],
      od_ghost_member: ['g_row'],
      od_ref: ['r_row'],
    });

    const doc = JSON.parse(readFileSync(exportPath, 'utf8'));
    expect(doc.format).toBe('objectstack.orphan-detail.pre-delete-export.v1');
    expect(doc.rows.map((r: { object: string; id: string }) => `${r.object}/${r.id}`)).toEqual([
      'od_member/m_orphan', 'od_member_note/n_orphan',
    ]);
    expect(doc.rows[0].row).toMatchObject({ id: 'm_orphan', name: 'orphan', campaign: MISSING_CAMPAIGN });
    expect(doc.rows[1].row).toMatchObject({ id: 'n_orphan', body: 'goes with its member', member: 'm_orphan' });
  }, CASE_TIMEOUT_MS);

  it('the first delete finds the export already on disk, holding every record the run deletes', async () => {
    const c = prepareCase();
    const exportPath = join(c.caseDir, 'export.json');
    const original = ObjectQL.prototype.delete;
    let seenAtFirstDelete: string[] | 'no file' | undefined;
    // Intercept the command's own delete, and only that one: the boot may delete
    // rows of its own, and those are not this pin's.
    vi.spyOn(ObjectQL.prototype, 'delete').mockImplementation(async function (this: ObjectQL, object: string, options?: any) {
      if (object === 'od_member' && seenAtFirstDelete === undefined) {
        seenAtFirstDelete = existsSync(exportPath)
          ? JSON.parse(readFileSync(exportPath, 'utf8')).rows.map((r: { object: string; id: string }) => `${r.object}/${r.id}`)
          : 'no file';
        throw Object.assign(new Error('injected: the first delete refuses'), { code: 'INJECTED_REFUSAL' });
      }
      return original.call(this, object, options);
    });

    const { payload, exitCode } = await runJson(['--delete', '--export', exportPath, '--yes', '--database-url', c.url, '--json']);

    // Non-vacuity: the command reached its delete through the intercepted method.
    expect(seenAtFirstDelete).toBeDefined();
    expect(seenAtFirstDelete).toEqual(['od_member/m_orphan', 'od_member_note/n_orphan']);
    expect(exitCode).toBe(1);
    expect(payload.failed).toEqual([expect.objectContaining({ object: 'od_member', recordId: 'm_orphan', code: 'INJECTED_REFUSAL' })]);
    // Refused, so nothing went.
    expect((await idsOf(c.dbFile)).od_member).toEqual(['m_live', 'm_orphan']);
    expect((await idsOf(c.dbFile)).od_member_note).toEqual(['n_live', 'n_orphan']);
  }, CASE_TIMEOUT_MS);
});

describe('[#24964] os db orphans — refusals answer their code and exit 1, with nothing deleted', () => {
  it('--delete without --export is refused before anything boots', async () => {
    const c = prepareCase();
    const before = await readState(c.dbFile);

    const { payload, exitCode } = await runJson(['--delete', '--yes', '--database-url', c.url, '--json']);

    expect(payload.error).toBe('export_required');
    expect(exitCode).toBe(1);
    expect(await readState(c.dbFile)).toEqual(before);
  }, CASE_TIMEOUT_MS);

  it('an export path that cannot be written refuses the run, with no row deleted', async () => {
    const c = prepareCase();
    const exportPath = join(c.caseDir, 'no-such-directory', 'export.json');

    const { payload, exitCode } = await runJson(['--delete', '--export', exportPath, '--yes', '--database-url', c.url, '--json']);

    expect(payload.error).toBe('export_failed');
    expect(exitCode).toBe(1);
    expect(existsSync(exportPath)).toBe(false);
    expect((await idsOf(c.dbFile)).od_member).toEqual(['m_live', 'm_orphan']);
    expect((await idsOf(c.dbFile)).od_member_note).toEqual(['n_live', 'n_orphan']);
  }, CASE_TIMEOUT_MS);

  it('an export path that already exists is refused, and left as it was', async () => {
    const c = prepareCase();
    const exportPath = join(c.caseDir, 'export.json');
    writeFileSync(exportPath, 'not ours');

    const { payload, exitCode } = await runJson(['--delete', '--export', exportPath, '--yes', '--database-url', c.url, '--json']);

    expect(payload.error).toBe('export_exists');
    expect(exitCode).toBe(1);
    expect(readFileSync(exportPath, 'utf8')).toBe('not ours');
    expect((await idsOf(c.dbFile)).od_member).toEqual(['m_live', 'm_orphan']);
  }, CASE_TIMEOUT_MS);

  it('--delete under --json without --yes asks for it, with nothing written', async () => {
    const c = prepareCase();
    const exportPath = join(c.caseDir, 'export.json');

    const { payload, exitCode } = await runJson(['--delete', '--export', exportPath, '--database-url', c.url, '--json']);

    expect(payload.error).toBe('confirmation_required');
    expect(exitCode).toBe(1);
    expect(existsSync(exportPath)).toBe(false);
    expect((await idsOf(c.dbFile)).od_member).toEqual(['m_live', 'm_orphan']);
  }, CASE_TIMEOUT_MS);
});
