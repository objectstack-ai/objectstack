// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20602] `GET /api/v1/data/:object/export` spells a `date` or `datetime`
 * cell's year with four digits, so the platform's own export re-imports
 * through `POST /api/v1/data/:object/import`.
 *
 * The export read the year as `getUTCFullYear()` or as `Intl`'s `year` part,
 * both unpadded numbers, so a `date` `0500-01-01` left as `500-01-01` and a
 * `datetime` `0500-01-01T10:00:00.000Z` as `500-01-01 10:00:00`. The import
 * reader takes a four-digit year only (#20534), so re-importing the file
 * refused the row as `invalid_date`. Every export `date` and `datetime` cell
 * now takes its day from core's `temporalStorageForm` `date` rule, the storage
 * form the doors write, which pads 0001..0999 and leaves a year outside
 * 0001..9999 unpadded.
 *
 * Two layers:
 *
 * - **The formatter** (`formatCellValue`, the one path CSV, xlsx and JSON
 *   share): a census over the years 0001, 0050, 0099, 0500, 0999, 1000, 2026
 *   and 9999, `date` and `datetime`, with and without a business timezone.
 *   The 1000, 2026 and 9999 cells are the pre-#20602 output, byte for byte.
 * - **The routes**: rows written through the create door, exported as CSV,
 *   xlsx and JSON, and re-imported into a fresh stack through the import door,
 *   store the same `date` and `datetime` values, under no business timezone,
 *   Asia/Shanghai and America/New_York.
 *
 * A `datetime` names a year from 1000 (#20280): the create door refuses an
 * earlier one, so the route rows before 1000 carry a `date` only. The one
 * `datetime` cell the padding still reaches at the routes is an instant from
 * 1000 on whose business-timezone day is in 0999: the boundary row, at
 * `1000-01-01T02:00:00.000Z`, which America/New_York reads on 0999-12-31.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';
import { formatCellValue } from './export-format.js';
import type { ExportFieldMeta } from './export-format.js';
import { loadXlsxWorkbook } from './xlsx-test-loader.js';

const DATE: ExportFieldMeta = { name: 'd', type: 'date' };
const DATETIME: ExportFieldMeta = { name: 'dt', type: 'datetime' };

const YEARS = ['0001', '0050', '0099', '0500', '0999', '1000', '2026', '9999'] as const;

const ZONES = [undefined, 'UTC', 'Asia/Shanghai', 'America/New_York', 'Not/AZone'] as const;

// ---------------------------------------------------------------------------
// The formatter — the one cell path CSV, xlsx and JSON share.
// ---------------------------------------------------------------------------

describe('[#20602] formatCellValue spells a four-digit year for every date and datetime', () => {
  describe.each(ZONES)('business timezone %s', (zone) => {
    it.each(YEARS)('date %s-01-01 exports as itself', (year) => {
      expect(formatCellValue(`${year}-01-01`, DATE, zone)).toBe(`${year}-01-01`);
    });

    it.each(YEARS)('datetime %s-01-01T10:00:00.000Z exports on its own day', (year) => {
      const cell = formatCellValue(`${year}-01-01T10:00:00.000Z`, DATETIME, zone);
      expect(cell).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(String(cell).slice(0, 11)).toBe(`${year}-01-01 `);
    });
  });

  it.each(YEARS)('datetime %s-01-01T10:00:00.000Z reads 10:00:00 with no zone, UTC or an unknown zone', (year) => {
    for (const zone of [undefined, 'UTC', 'Not/AZone']) {
      expect(formatCellValue(`${year}-01-01T10:00:00.000Z`, DATETIME, zone)).toBe(`${year}-01-01 10:00:00`);
    }
  });

  it('keeps the 2026 control exactly as it was, in every zone', () => {
    expect(formatCellValue('2026-07-15', DATE, 'Asia/Shanghai')).toBe('2026-07-15');
    expect(formatCellValue('2026-07-15T10:00:00.000Z', DATETIME)).toBe('2026-07-15 10:00:00');
    expect(formatCellValue('2026-07-15T10:00:00.000Z', DATETIME, 'Asia/Shanghai')).toBe('2026-07-15 18:00:00');
    expect(formatCellValue('2026-07-15T10:00:00.000Z', DATETIME, 'America/New_York')).toBe('2026-07-15 06:00:00');
  });

  it('pads a Date and an epoch-ms value the same way', () => {
    const instant = Date.parse('0500-01-01T10:00:00.000Z');
    expect(formatCellValue(new Date(instant), DATE)).toBe('0500-01-01');
    expect(formatCellValue(instant, DATE)).toBe('0500-01-01');
    expect(formatCellValue(new Date(instant), DATETIME)).toBe('0500-01-01 10:00:00');
    expect(formatCellValue(instant, DATETIME)).toBe('0500-01-01 10:00:00');
  });

  // A zone's calendar day can sit in the year either side of the UTC one. Its
  // year is the instant's, never `Intl`'s `year` part: that is an ERA year, and
  // year 0 (1 BC) reads `1` there.
  it('takes the year the zone has reached across a year boundary', () => {
    expect(String(formatCellValue('0999-12-31T23:30:00.000Z', DATETIME, 'Asia/Shanghai')).slice(0, 11)).toBe('1000-01-01 ');
    expect(String(formatCellValue('1000-01-01T02:00:00.000Z', DATETIME, 'America/New_York')).slice(0, 11)).toBe('0999-12-31 ');
    // Year 1 in UTC, still year 0 in New York: year 0 has no four-digit form,
    // so it is spelled unpadded as the storage rule spells it and the import
    // refuses it. Padding `Intl`'s era year would spell the last day of year 1,
    // a day a year later than the instant's.
    const cell = String(formatCellValue('0001-01-01T03:00:00.000Z', DATETIME, 'America/New_York'));
    expect(cell.startsWith('0-12-31 ')).toBe(true);
    expect(cell.startsWith('0001-')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The routes — create, export, then import into a fresh stack.
// ---------------------------------------------------------------------------

const OBJECT = 'export_year_pad_20602';

const LEDGER = {
  name: OBJECT, label: 'Ledger 20602', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    d: { name: 'd', type: 'date' as const, label: 'Day' },
    dt: { name: 'dt', type: 'datetime' as const, label: 'At' },
  },
};

const MAPPING = { ID: 'id', Day: 'd', At: 'dt' };

/** [#20280] The first year the create door takes for a `datetime`. */
const DATETIME_FIRST_YEAR = 1000;

type Row = { year: string; id: string; d: string; dt?: string; dtDay: (zone: string | undefined) => string };

/**
 * One row per year: the day `Y-01-01` and, from 1000 on, the instant at 10:00
 * UTC on it (the module note). Then the boundary row: the instant 02:00 UTC on
 * 1000-01-01, which America/New_York reads on 0999-12-31.
 */
const ROWS: Row[] = [
  ...YEARS.map((year) => ({
    year,
    id: `y${year}`,
    d: `${year}-01-01`,
    dt: Number(year) >= DATETIME_FIRST_YEAR ? `${year}-01-01T10:00:00.000Z` : undefined,
    dtDay: () => `${year}-01-01`,
  })),
  {
    year: '0999',
    id: 'y0999-boundary',
    d: '0999-12-31',
    dt: '1000-01-01T02:00:00.000Z',
    dtDay: (zone) => (zone === 'America/New_York' ? '0999-12-31' : '1000-01-01'),
  },
];

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const chunks: Buffer[] = [];
  const res: any = {
    write: (c: unknown) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; },
    end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  res._buffer = () => Buffer.concat(chunks);
  return res;
}

async function boot(timezone: string | undefined, engines: ObjectQL[]) {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
  }), true);
  await engine.init();
  engine.registerObject(LEDGER as any);
  await engine.syncSchemas();
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user', ...(timezone ? { timezone } : {}) });
  rest.registerRoutes();
  const route = (method: string, path: string) => {
    const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path) as any;
    expect(found, `${method} ${path}`).toBeDefined();
    return found;
  };
  const createRoute = route('POST', '/api/v1/data/:object');
  const exportRoute = route('GET', '/api/v1/data/:object/export');
  const importRoute = route('POST', '/api/v1/data/:object/import');
  const send = async (r: any, req: Record<string, unknown>) => {
    const res = makeRes();
    await r.handler({ params: { object: OBJECT }, ...req } as any, res);
    return res;
  };
  return {
    engine,
    create: (body: Record<string, unknown>) => send(createRoute, { body }),
    exportAs: (format: 'csv' | 'xlsx' | 'json') => send(exportRoute, { query: { format } }),
    importBody: (body: Record<string, unknown>) => send(importRoute, { body }),
  };
}

/** Each row's exported `date` and `datetime` cells, by row id. */
async function exportedCells(format: 'csv' | 'xlsx' | 'json', buffer: Buffer): Promise<Map<string, { d: string; dt: string }>> {
  const cells = new Map<string, { d: string; dt: string }>();
  if (format === 'json') {
    for (const row of JSON.parse(buffer.toString('utf8'))) {
      cells.set(String(row.id), { d: String(row.d ?? ''), dt: String(row.dt ?? '') });
    }
    return cells;
  }
  if (format === 'csv') {
    const [header, ...lines] = buffer.toString('utf8').split('\r\n').filter((l) => l.length > 0);
    expect(header).toBe('ID,Day,At');
    for (const line of lines) {
      const [id, d, dt] = line.split(',');
      cells.set(id, { d, dt: dt ?? '' });
    }
    return cells;
  }
  const ws = (await loadXlsxWorkbook(buffer)).worksheets[0];
  expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(['ID', 'Day', 'At']);
  for (let r = 2; r <= ws.rowCount; r++) {
    const [id, d, dt] = (ws.getRow(r).values as unknown[]).slice(1);
    // A text cell, never a Date: the import reads the export's own spelling.
    expect(typeof d).toBe('string');
    cells.set(String(id), { d: String(d), dt: dt == null ? '' : String(dt) });
  }
  return cells;
}

function importBodyFor(format: 'csv' | 'xlsx' | 'json', buffer: Buffer): Record<string, unknown> {
  if (format === 'json') return { format, rows: JSON.parse(buffer.toString('utf8')), writeMode: 'insert' };
  if (format === 'csv') return { format, csv: buffer.toString('utf8'), mapping: MAPPING, writeMode: 'insert' };
  return { format, xlsxBase64: buffer.toString('base64'), mapping: MAPPING, writeMode: 'insert' };
}

/** The 2026 control's `datetime` cell, as it exported before #20602. */
const CONTROL_DATETIME_CELL: Record<string, string> = {
  none: '2026-01-01 10:00:00',
  'Asia/Shanghai': '2026-01-01 18:00:00',
  'America/New_York': '2026-01-01 05:00:00',
};

const BUSINESS_ZONES = [undefined, 'Asia/Shanghai', 'America/New_York'] as const;
const FORMATS = ['csv', 'xlsx', 'json'] as const;

describe.each(BUSINESS_ZONES)('[#20602] GET /export then POST /import, business timezone %s', (zone) => {
  describe.each(FORMATS)('format %s', (format) => {
    const engines: ObjectQL[] = [];
    let source: Awaited<ReturnType<typeof boot>>;
    let target: Awaited<ReturnType<typeof boot>>;
    let cells: Map<string, { d: string; dt: string }>;
    let imported: any;

    beforeAll(async () => {
      source = await boot(zone, engines);
      for (const row of ROWS) {
        const created = await source.create({ id: row.id, d: row.d, ...(row.dt ? { dt: row.dt } : {}) });
        expect(created._status ?? 201, `create ${row.id}`).toBe(201);
      }
      const exported = await source.exportAs(format);
      expect(exported._status ?? 200).toBe(200);
      cells = await exportedCells(format, exported._buffer());
      expect([...cells.keys()].sort()).toEqual(ROWS.map((r) => r.id).sort());

      target = await boot(zone, engines);
      imported = (await target.importBody(importBodyFor(format, exported._buffer())))._json;
      expect(imported).toMatchObject({ total: ROWS.length });
    });

    afterAll(async () => {
      while (engines.length) {
        try { await engines.pop()?.destroy(); } catch { /* noop */ }
      }
    });

    it.each(ROWS)('exports the $id row with a four-digit year and re-imports it unchanged', async (row) => {
      const cell = cells.get(row.id)!;
      expect(cell.d).toBe(row.d);
      if (row.dt) {
        expect(cell.dt.slice(0, 11)).toBe(`${row.dtDay(zone)} `);
        if (row.year === '2026') expect(cell.dt).toBe(CONTROL_DATETIME_CELL[zone ?? 'none']);
      } else {
        expect(cell.dt).toBe('');
      }

      // The import's per-row result sits at the row's position in the file.
      const position = [...cells.keys()].indexOf(row.id) + 1;
      const refusal = imported.results?.find((r: any) => r.row === position && r.ok === false);
      expect(refusal, `the import refused the ${row.year} row`).toBeUndefined();
      const back = await target.engine.findOne(OBJECT, { where: { id: row.id } });
      const src = await source.engine.findOne(OBJECT, { where: { id: row.id } });
      expect(src?.d).toBe(row.d);
      expect({ d: back?.d, dt: back?.dt ?? null }).toEqual({ d: src?.d, dt: src?.dt ?? null });
      if (row.dt) expect(back?.dt).toBe(row.dt);
    });
  });
});
