// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25078] Export → import round trip through each REST door that parses CSV.
 *
 * The CSV export writes a text cell its consumer would interpret in a form that
 * consumer reads as text; the CSV import parse reverses exactly that. The rule
 * is pinned at its readers in `csv-text-cell.test.ts`. This file drives the
 * REAL routes over a REAL `ObjectQL` engine with a better-sqlite3 `:memory:`
 * driver: rows are stored in `note`, exported as CSV through
 * `GET /data/note/export`, and that file is imported into `note_copy`'s text
 * fields through
 *
 *   - the sync door, `POST /data/note_copy/import`, with an inline mapping;
 *   - the sync door with a NAMED mapping, whose rows keep their source headers
 *     until core's `applyMappingToRows` — the reversal must not depend on a
 *     target field's type;
 *   - the async door, `POST /data/note_copy/import/jobs`.
 *
 * Every stored value comes back exactly. Each case also asserts that the file
 * it imported carried the marks, so the round trip cannot pass by the export
 * never having marked anything. plugin-auth's admin user import is pinned in
 * its own package (`admin-import-users.test.ts`).
 *
 * Control characters are written as escapes in this file, never as raw bytes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { SysImportJob } from '@objectstack/platform-objects/audit';
import { RestServer } from './rest-server';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * Text fields only, so every value lands in a text field. `memo`'s label starts
 * with a trigger character, so the header row carries a marked label too.
 */
function noteObject(name: string) {
  return {
    name,
    label: name,
    systemFields: false,
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
      body: { name: 'body', type: 'text' as const, label: 'Body' },
      memo: { name: 'memo', type: 'text' as const, label: '-Memo' },
    },
  };
}

/** Plain words after a trigger character: marked by the export. */
const MARKED = ['=Total', '+Name', '-Note', '@acme'];
/** Ordinary business values, and a user-authored cell that begins with the mark itself. */
const UNMARKED = ['+86 138 0013 8000', '+1 555 010 0000', '-120.50', 'Acme Ltd', '120.50', "'Quoted"];
const VALUES = [...MARKED, ...UNMARKED];

const INLINE_MAPPING = { ID: 'id', Body: 'body', '-Memo': 'memo' };

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const chunks: string[] = [];
  const res: any = {
    write: (s: string) => { chunks.push(typeof s === 'string' ? s : String(s)); return true; },
    end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return { res, text: () => chunks.join('') };
}

async function boot(values: string[]) {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  engine.registry.registerObject(noteObject('note') as any);
  engine.registry.registerObject(noteObject('note_copy') as any);
  engine.registry.registerObject(SysImportJob as any);
  await engine.syncSchemas();
  for (let i = 0; i < values.length; i++) {
    await engine.insert('note', { id: `r${i + 1}`, body: values[i], memo: values[i] });
  }
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  engine.registry.registerItem('mapping', {
    name: 'note_copy_feed',
    label: 'Note copy feed',
    sourceFormat: 'csv',
    targetObject: 'note_copy',
    fieldMapping: [
      { source: 'ID', target: 'id', transform: 'none' },
      { source: 'Body', target: 'body', transform: 'none' },
      { source: '-Memo', target: 'memo', transform: 'none' },
    ],
  } as any, 'name');
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const routes = rest.getRoutes();
  const find = (method: string, path: string) => routes.find((r: any) => r.method === method && r.path === path)!;
  return {
    engine,
    exportRoute: find('GET', '/api/v1/data/:object/export'),
    importRoute: find('POST', '/api/v1/data/:object/import'),
    jobCreate: find('POST', '/api/v1/data/:object/import/jobs'),
    jobProgress: find('GET', '/api/v1/data/import/jobs/:jobId'),
  };
}

type Booted = Awaited<ReturnType<typeof boot>>;

async function exportCsv(ctx: Booted): Promise<string> {
  const { res, text } = makeRes();
  await ctx.exportRoute.handler({ params: { object: 'note' }, query: { format: 'csv' } } as any, res);
  return text();
}

async function importSync(ctx: Booted, body: Record<string, unknown>): Promise<any> {
  const { res } = makeRes();
  await ctx.importRoute.handler({ params: { object: 'note_copy' }, body } as any, res);
  return res._json;
}

async function importAsync(ctx: Booted, body: Record<string, unknown>): Promise<any> {
  const { res } = makeRes();
  await ctx.jobCreate.handler({ params: { object: 'note_copy' }, body } as any, res);
  expect(res._status).toBe(201);
  const jobId = res._json.jobId;
  for (let i = 0; i < 200; i++) {
    const p = makeRes();
    await ctx.jobProgress.handler({ params: { jobId }, query: {} } as any, p.res);
    const status = p.res._json?.status;
    if (status === 'succeeded' || status === 'failed' || status === 'cancelled') return p.res._json;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`import job ${jobId} did not finish`);
}

async function storedCopies(ctx: Booted, count: number): Promise<Array<{ body: unknown; memo: unknown }>> {
  const out: Array<{ body: unknown; memo: unknown }> = [];
  for (let i = 1; i <= count; i++) {
    const row: any = await ctx.engine.findOne('note_copy', { where: { id: `r${i}` } });
    out.push({ body: row?.body, memo: row?.memo });
  }
  return out;
}

/** The file carried the marks: the round trip below is not a pass-through. */
function expectMarkedFile(csv: string): void {
  expect(csv.split('\r\n')[0]).toBe("ID,Body,'-Memo");
  for (const v of MARKED) expect(csv).toContain(`,'${v},'${v}\r\n`);
  for (const v of ['+86 138 0013 8000', '-120.50', 'Acme Ltd']) expect(csv).toContain(`,${v},${v}\r\n`);
}

describe('CSV export → import round trip, every value returns exactly (#25078)', () => {
  let ctx: Booted;
  beforeEach(async () => {
    ctx = await boot(VALUES);
  });

  it('sync door, inline mapping', async () => {
    const csv = await exportCsv(ctx);
    expectMarkedFile(csv);
    const res = await importSync(ctx, { format: 'csv', csv, mapping: INLINE_MAPPING });
    expect(res).toMatchObject({ total: VALUES.length, ok: VALUES.length, errors: 0, created: VALUES.length });
    expect(await storedCopies(ctx, VALUES.length)).toEqual(VALUES.map((v) => ({ body: v, memo: v })));
  });

  it('sync door, named mapping (reversal runs before the mapping renames the columns)', async () => {
    const csv = await exportCsv(ctx);
    expectMarkedFile(csv);
    const res = await importSync(ctx, { format: 'csv', csv, mappingName: 'note_copy_feed' });
    expect(res).toMatchObject({ total: VALUES.length, ok: VALUES.length, errors: 0, created: VALUES.length });
    expect(await storedCopies(ctx, VALUES.length)).toEqual(VALUES.map((v) => ({ body: v, memo: v })));
  });

  it('async import-job door', async () => {
    const csv = await exportCsv(ctx);
    expectMarkedFile(csv);
    const done = await importAsync(ctx, { format: 'csv', csv, mapping: INLINE_MAPPING });
    expect(done).toMatchObject({ status: 'succeeded', total: VALUES.length, created: VALUES.length, errors: 0 });
    expect(await storedCopies(ctx, VALUES.length)).toEqual(VALUES.map((v) => ({ body: v, memo: v })));
  });
});

describe('CSV round trip of a value that begins with TAB or CR (#25078)', () => {
  const LEADING_WHITESPACE = ['\tTotal', '\rTotal'];
  let ctx: Booted;
  beforeEach(async () => {
    ctx = await boot(LEADING_WHITESPACE);
  });

  it('the file carries the mark, and `trimWhitespace: false` returns the stored value exactly', async () => {
    const csv = await exportCsv(ctx);
    expect(csv).toContain("r1,'\tTotal,'\tTotal\r\n");
    expect(csv).toContain(`r2,"'\rTotal","'\rTotal"\r\n`);
    const res = await importSync(ctx, { format: 'csv', csv, mapping: INLINE_MAPPING, trimWhitespace: false });
    expect(res).toMatchObject({ ok: 2, errors: 0 });
    expect(await storedCopies(ctx, 2)).toEqual(LEADING_WHITESPACE.map((v) => ({ body: v, memo: v })));
  });

  it("under the default `trimWhitespace`, core's text trim still removes the leading TAB / CR after the reversal", async () => {
    const csv = await exportCsv(ctx);
    const res = await importSync(ctx, { format: 'csv', csv, mapping: INLINE_MAPPING });
    expect(res).toMatchObject({ ok: 2, errors: 0 });
    expect(await storedCopies(ctx, 2)).toEqual([{ body: 'Total', memo: 'Total' }, { body: 'Total', memo: 'Total' }]);
  });
});
