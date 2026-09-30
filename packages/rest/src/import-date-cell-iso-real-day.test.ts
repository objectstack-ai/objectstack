// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20534] `POST /api/v1/data/:object/import` reads a `date`, `datetime` or
 * `time` text cell only in ISO 8601, the platform's own export shape
 * (`YYYY-MM-DD HH:mm:ss`) or a year-first date (`2026/7/15`, `2026/7/15 9:00`,
 * by the maintainer ruling on the card), on a calendar day that exists, and
 * pads a `date`'s year to four digits — through the real route over a real `SqlDriver`
 * (better-sqlite3 `:memory:`), under two host zones twelve hours apart.
 *
 * Measured through this route, JSON rows, `writeMode: 'insert'`, no business
 * timezone, on `InMemoryDriver` and on `SqlDriver` (better-sqlite3) alike,
 * under `TZ=America/New_York` and `TZ=Asia/Shanghai`, at the base
 * (`f11b5f20a2`):
 *
 * | cell | kind | base: stored (New York · Shanghai) | head |
 * |:--|:--|:--|:--|
 * | `2026-02-30` | datetime | `2026-03-02T00:00:00.000Z` on both | row refused, `invalid_date` |
 * | `2026-02-30 10:00` / `2026-02-30T10:00:00Z` | datetime | `2026-03-02T10:00:00.000Z` on both | row refused |
 * | `2026-02-30T10:00:00Z` | date | `2026-03-02` on both | row refused |
 * | `07/15/2026 10:00` | datetime | `…T14:00:00.000Z` · `…T02:00:00.000Z` | row refused |
 * | `07/08/2026` | datetime | `2026-07-08T04:00Z` · `2026-07-07T16:00Z` (month-first) | row refused |
 * | `07/15/2026` / `15 July 2026` | date | `2026-07-15` · `2026-07-14` | row refused |
 * | `07/15/2026 10:00` | time | `14:00:00` · `02:00:00` | row refused |
 * | `2026-07-15 24:00` | datetime | `2026-07-16T04:00Z` · `2026-07-15T16:00Z` | row refused |
 * | `0500-01-01` / `0001-01-01` | date | row refused (`500-01-01` reached the write door) | `0500-01-01` / `0001-01-01` |
 * | `0001-01-01` | datetime | `1901-01-01T00:00:00.000Z` | `0001-01-01T00:00:00.000Z` |
 * | `2026/7/15` | date | `2026-07-15` | unchanged |
 * | `2026/7/15 9:00` | datetime | `2026-07-15T09:00:00.000Z` | unchanged |
 * | `2026/2/30` | date | refused (`2026-02-30` reached the write door) | row refused by the reader |
 *
 * The `InMemoryDriver` column is this file's by construction, not by a second
 * arm: every cell is judged by the import's own reader (`parseDateCell`) before
 * a driver is reached, so one verdict holds on every driver. A test import of
 * `@objectstack/driver-memory` is also not this file's to add — its test
 * consumers are a ruled, ledgered set (`pnpm check:driver-memory-census`).
 *
 * The reader's own case table is `import-coerce.test.ts`'s `[#20534]` block;
 * this file pins the door.
 *
 * [#20280] The `datetime` cell `0001-01-01` in the table above is read right
 * by the reader and is refused now by the write door behind it: a `datetime`
 * begins at year 1000 (MySQL's documented `DATETIME` floor). The floor's own
 * day is the admitted `datetime` control; a `date` keeps 0001..0999.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { loadExcelJs } from './xlsx-module.js';

const OBJECT = 'import_date_cell_20534';

const LEDGER = {
  name: OBJECT, label: 'Ledger 20534', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    d: { name: 'd', type: 'date' as const, label: 'Day' },
    dt: { name: 'dt', type: 'datetime' as const, label: 'At' },
    t: { name: 't', type: 'time' as const, label: 'Clock' },
  },
};

type Field = 'd' | 'dt' | 't';

/** The card's rows: each used to be stored as some other value, or not at all. */
const REFUSED: ReadonlyArray<readonly [field: Field, cell: string]> = [
  ['dt', '2026-02-30'],
  ['dt', '2026-02-30 10:00'],
  ['dt', '2026-02-30T10:00:00Z'],
  ['d', '2026-02-30T10:00:00Z'],
  ['d', '2026-02-30'],
  ['dt', '07/15/2026 10:00'],
  ['dt', '07/08/2026'],
  ['d', '07/15/2026'],
  ['d', '15 July 2026'],
  ['t', '07/15/2026 10:00'],
  ['dt', '2026-07-15 24:00'],
  ['d', '2026/2/30'],
  // [#20280] Read right, and refused by the write door: a datetime begins at 1000.
  ['dt', '0001-01-01'],
];

/** [#20722] The write door's field code for a refused cell: `invalid_time` for a `time`. */
const codeOf = (field: Field) => (field === 't' ? 'invalid_time' : 'invalid_date');

/** Admitted cells and what they store — the padding, the ISO control and the export shape. */
const ADMITTED: ReadonlyArray<readonly [field: Field, cell: string, stored: string]> = [
  ['d', '0500-01-01', '0500-01-01'],
  ['d', '0001-01-01', '0001-01-01'],
  ['dt', '1000-01-01', '1000-01-01T00:00:00.000Z'],
  ['d', '2026-07-15', '2026-07-15'],
  ['dt', '2026-07-15T10:00:00Z', '2026-07-15T10:00:00.000Z'],
  ['dt', '2026-07-15T10:00:00+08:00', '2026-07-15T02:00:00.000Z'],
  ['dt', '2026-07-15 10:00:00', '2026-07-15T10:00:00.000Z'],
  ['t', '10:00', '10:00:00'],
  // A year-first date (Excel's zh-CN / ja-JP short date) stays admitted, padded.
  ['d', '2026/7/15', '2026-07-15'],
  ['dt', '2026/7/15 9:00', '2026-07-15T09:00:00.000Z'],
];

function makeSqliteDriver() {
  return new SqlDriver({
    client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
  });
}

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const chunks: string[] = [];
  const res: any = {
    write: (s: unknown) => { chunks.push(String(s)); return true; },
    end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  res._text = () => chunks.join('');
  return res;
}

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(makeSqliteDriver(), true);
  await engine.init();
  engine.registry.registerObject(LEDGER as any);
  await engine.syncSchemas();
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const find = (method: string, path: string) =>
    rest.getRoutes().find((r: any) => r.method === method && r.path === path) as any;
  const importRoute = find('POST', '/api/v1/data/:object/import');
  const createRoute = find('POST', '/api/v1/data/:object');
  const exportRoute = find('GET', '/api/v1/data/:object/export');
  expect(importRoute).toBeDefined();
  expect(createRoute).toBeDefined();
  expect(exportRoute).toBeDefined();
  const send = async (route: any, req: Record<string, unknown>) => {
    const res = makeRes();
    await route.handler({ params: { object: OBJECT }, ...req } as any, res);
    return res;
  };
  return {
    engine,
    importRows: (body: Record<string, unknown>) => send(importRoute, { body }),
    create: (body: Record<string, unknown>) => send(createRoute, { body }),
    exportCsv: () => send(exportRoute, { query: { format: 'csv' } }),
  };
}

const stored = async (engine: ObjectQL, id: string, field: Field) =>
  (await engine.findOne(OBJECT, { where: { id } }))?.[field];

// Two host zones twelve hours apart: a host-zone reading answers differently
// under each, so a cell that stores one value under both was not read in the
// host's zone.
const HOST_ZONES = [
  { tz: 'America/New_York', julyOffset: 240 },
  { tz: 'Asia/Shanghai', julyOffset: -480 },
];
const originalTz = process.env.TZ;

describe.each(HOST_ZONES)('[#20534] /import date cells, host TZ=$tz', ({ tz, julyOffset }) => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => {
    process.env.TZ = tz;
    // The host really did change — otherwise both legs assert one host.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(tz);
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(julyOffset);
    ctx = await boot();
  });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it.each(REFUSED)('refuses the %s cell %j as that row\'s invalid_date (a time cell: invalid_time) and writes its sibling row', async (field, cell) => {
    const res = await ctx.importRows({
      format: 'json', writeMode: 'insert',
      rows: [{ id: 'bad', [field]: cell }, { id: 'good', d: '2026-07-15' }],
    });

    expect(res._status ?? 200).toBe(200);
    expect(res._json).toMatchObject({ total: 2, ok: 1, errors: 1, created: 1 });
    expect(res._json.results[0]).toMatchObject({
      row: 1, ok: false, action: 'failed', field, code: codeOf(field),
    });
    // Refused, not stored as some other day or instant.
    expect(await ctx.engine.findOne(OBJECT, { where: { id: 'bad' } })).toBeNull();
    expect(await stored(ctx.engine, 'good', 'd')).toBe('2026-07-15');
  });

  it.each(ADMITTED)('stores the %s cell %j as %j', async (field, cell, value) => {
    const res = await ctx.importRows({
      format: 'json', writeMode: 'insert',
      rows: [{ id: 'r', [field]: cell }],
    });

    expect(res._json).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
    expect(await stored(ctx.engine, 'r', field)).toBe(value);
  });

  it('takes a padded year the write door takes, and stores what the write door stores', async () => {
    for (const [i, day] of ['0500-01-01', '0001-01-01'].entries()) {
      const direct = await ctx.create({ id: `w${i}`, d: day });
      expect(direct._status ?? 201).toBeLessThan(300);
      const imported = await ctx.importRows({ format: 'json', writeMode: 'insert', rows: [{ id: `i${i}`, d: day }] });
      expect(imported._json).toMatchObject({ ok: 1, errors: 0 });
      expect(await stored(ctx.engine, `i${i}`, 'd')).toBe(await stored(ctx.engine, `w${i}`, 'd'));
      expect(await stored(ctx.engine, `i${i}`, 'd')).toBe(day);
    }
  });

  it('stores a year-first date-time as the same instant the export shape stores', async () => {
    const res = await ctx.importRows({
      format: 'json', writeMode: 'insert',
      rows: [{ id: 'yf', dt: '2026/7/15 9:00' }, { id: 'ex', dt: '2026-07-15 09:00:00' }],
    });
    expect(res._json).toMatchObject({ total: 2, ok: 2, errors: 0, created: 2 });
    const yearFirst = await stored(ctx.engine, 'yf', 'dt');
    expect(yearFirst).toBe(await stored(ctx.engine, 'ex', 'dt'));
    expect(yearFirst).toBe('2026-07-15T09:00:00.000Z');
  });

  it('round-trips the export shape: an exported row re-imports as the same day and instant', async () => {
    await ctx.engine.insert(OBJECT, { id: 'src', d: '2026-07-15', dt: '2026-07-15T10:00:00.000Z', t: '10:00:00' });
    const exported = await ctx.exportCsv();
    const lines = exported._text().split('\r\n').filter((l: string) => l.length > 0);
    expect(lines[0]).toBe('ID,Day,At,Clock');
    expect(lines[1]).toBe('src,2026-07-15,2026-07-15 10:00:00,10:00:00');

    const csv = [lines[0], lines[1].replace(/^src,/, 'back,')].join('\n');
    const res = await ctx.importRows({ format: 'csv', csv, writeMode: 'insert', mapping: { ID: 'id', Day: 'd', At: 'dt', Clock: 't' } });
    expect(res._json).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
    const back = await ctx.engine.findOne(OBJECT, { where: { id: 'back' } });
    const src = await ctx.engine.findOne(OBJECT, { where: { id: 'src' } });
    expect({ d: back?.d, dt: back?.dt, t: back?.t }).toEqual({ d: src?.d, dt: src?.dt, t: src?.t });
    expect(back?.dt).toBe('2026-07-15T10:00:00.000Z');
  });

  it('reads an xlsx date cell as before', async () => {
    const ExcelJS = await loadExcelJs();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['ID', 'Day', 'At']);
    ws.addRow(['x1', new Date('2026-06-30T00:00:00Z'), new Date('2026-06-30T10:00:00Z')]);
    const xlsxBase64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');

    const res = await ctx.importRows({ format: 'xlsx', xlsxBase64, writeMode: 'insert', mapping: { ID: 'id', Day: 'd', At: 'dt' } });
    expect(res._json).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
    expect(await stored(ctx.engine, 'x1', 'd')).toBe('2026-06-30');
    expect(await stored(ctx.engine, 'x1', 'dt')).toBe('2026-06-30T10:00:00.000Z');
  });

  it('gives quoted CSV cells the same verdicts', async () => {
    const csv = [
      'ID,Day,At,Clock',
      ...REFUSED.map(([field, cell], i) => `r${i},${field === 'd' ? `"${cell}"` : ''},${field === 'dt' ? `"${cell}"` : ''},${field === 't' ? `"${cell}"` : ''}`),
    ].join('\n');
    const res = await ctx.importRows({ format: 'csv', csv, writeMode: 'insert', mapping: { ID: 'id', Day: 'd', At: 'dt', Clock: 't' } });

    expect(res._json).toMatchObject({ total: REFUSED.length, ok: 0, errors: REFUSED.length });
    const failedFields = res._json.results.map((r: any) => [r.field, r.code]);
    expect(failedFields).toEqual(REFUSED.map(([field]) => [field, codeOf(field)]));
  });

  it('dry run predicts the same refusals and persists nothing', async () => {
    const res = await ctx.importRows({
      format: 'json', writeMode: 'insert', dryRun: true,
      rows: REFUSED.map(([field, cell], i) => ({ id: `d${i}`, [field]: cell })),
    });

    expect(res._json).toMatchObject({ dryRun: true, total: REFUSED.length, ok: 0, errors: REFUSED.length });
    for (const [i, r] of res._json.results.entries()) {
      expect(r).toMatchObject({ ok: false, field: REFUSED[i][0], code: codeOf(REFUSED[i][0]) });
    }
    for (const [i] of REFUSED.entries()) {
      expect(await ctx.engine.findOne(OBJECT, { where: { id: `d${i}` } })).toBeNull();
    }
  });
});
