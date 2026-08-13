// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8373] The exported file must show the same clock as the screen.
 *
 * `formatDate` read `getUTC*` unconditionally, so every `datetime` column of a
 * CSV / XLSX / JSON export streamed UTC while the UI rendered the business
 * timezone. The harm is not "8 hours off": a record at `2026-08-01 06:00 +08`
 * exported as `2026-07-31 22:00`, i.e. it left AUGUST — a downstream monthly
 * reconciliation stopped balancing on exactly that. `getUTC*` ignores the
 * process `TZ`, so there was no deployment-side workaround.
 *
 * Every datetime fixture below therefore straddles a **month** boundary, not a
 * comfortable mid-day instant: a test written at 12:00 would have passed both
 * before and after the fix while the reported symptom survived untouched.
 *
 * Three contracts are pinned here:
 *
 *  1. `datetime` renders in `ExecutionContext.timezone` — CSV **and** XLSX
 *     (both reproduce; the XLSX path writes its own cells through
 *     `formatRowCells`, so a CSV-only fix would leave the symptom half-standing),
 *     plus JSON, which shares `formatCellValue` through `formatRowForJson`.
 *  2. **No timezone ⇒ UTC**, byte-identical to the pre-#8373 output. That is the
 *     backward-compatibility promise for every deployment that never set one,
 *     and it also covers a zone the platform does not know.
 *  3. `date` is a **timezone-naive calendar day** (ADR-0053) and is NOT
 *     re-projected. `driver-sql`'s `toDateOnly` is the source of truth for what
 *     a `date` is; projecting one through a zone would move `2026-08-01` to
 *     `2026-07-31` for every deployment west of UTC — the off-by-one-day defect
 *     ADR-0053 exists to remove.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';
import { formatCellValue, formatRowCells, formatRowForJson } from './export-format.js';
import type { ExportFieldMeta } from './export-format.js';

// The instant at the heart of the report: 2026-08-01 06:00 in +08 is
// 2026-07-31 22:00 in UTC — a different day, month and quarter-of-year.
const CROSS_MONTH_UTC = '2026-07-31T22:00:00.000Z';
const IN_SHANGHAI = '2026-08-01 06:00:00';
const IN_UTC = '2026-07-31 22:00:00';
const SHANGHAI = 'Asia/Shanghai';

// ---------------------------------------------------------------------------
// Unit level — the formatter itself.
// ---------------------------------------------------------------------------

const DATETIME_META: ExportFieldMeta = { name: 'scanned_at', type: 'datetime' };
const DATE_META: ExportFieldMeta = { name: 'due', type: 'date' };

describe('formatCellValue — datetime renders in the business timezone', () => {
  it('moves a cross-month instant back into the month the UI shows', () => {
    expect(formatCellValue(CROSS_MONTH_UTC, DATETIME_META, SHANGHAI)).toBe(IN_SHANGHAI);
  });

  it('falls back to UTC when no timezone is resolved (pre-#8373 behaviour)', () => {
    expect(formatCellValue(CROSS_MONTH_UTC, DATETIME_META)).toBe(IN_UTC);
    expect(formatCellValue(CROSS_MONTH_UTC, DATETIME_META, undefined)).toBe(IN_UTC);
    expect(formatCellValue(CROSS_MONTH_UTC, DATETIME_META, 'UTC')).toBe(IN_UTC);
  });

  it('falls back to UTC for a zone this platform does not know', () => {
    expect(formatCellValue(CROSS_MONTH_UTC, DATETIME_META, 'Mars/Olympus_Mons')).toBe(IN_UTC);
    expect(formatCellValue(CROSS_MONTH_UTC, DATETIME_META, '')).toBe(IN_UTC);
  });

  it('renders midnight as 00, never 24 (hourCycle h23)', () => {
    // 2026-08-01T16:00Z is 2026-08-02 00:00 in +08.
    expect(formatCellValue('2026-08-01T16:00:00.000Z', DATETIME_META, SHANGHAI))
      .toBe('2026-08-02 00:00:00');
  });

  it('crosses BACK a day for a zone west of UTC', () => {
    // 2026-08-01T02:30Z is 2026-07-31 22:30 in New York (-04:00, DST).
    expect(formatCellValue('2026-08-01T02:30:00.000Z', DATETIME_META, 'America/New_York'))
      .toBe('2026-07-31 22:30:00');
  });

  it('reads the tz database for DST rather than a fixed offset', () => {
    // Same zone, opposite sides of the US DST boundary: -05:00 then -04:00.
    expect(formatCellValue('2026-01-15T12:00:00.000Z', DATETIME_META, 'America/New_York'))
      .toBe('2026-01-15 07:00:00');
    expect(formatCellValue('2026-07-15T12:00:00.000Z', DATETIME_META, 'America/New_York'))
      .toBe('2026-07-15 08:00:00');
  });

  it('leaves an unparseable value untouched', () => {
    expect(formatCellValue('not a date', DATETIME_META, SHANGHAI)).toBe('not a date');
  });
});

describe('formatCellValue — date stays a timezone-naive calendar day (ADR-0053)', () => {
  it('does not re-project a date-only value into the business timezone', () => {
    expect(formatCellValue('2026-08-01', DATE_META, SHANGHAI)).toBe('2026-08-01');
    // The direction that would have broken: a zone west of UTC must not pull
    // the calendar day back to 2026-07-31.
    expect(formatCellValue('2026-08-01', DATE_META, 'America/New_York')).toBe('2026-08-01');
    expect(formatCellValue('2026-08-01', DATE_META, 'Pacific/Honolulu')).toBe('2026-08-01');
  });

  it('is identical with and without a timezone', () => {
    expect(formatCellValue('2026-08-01', DATE_META, SHANGHAI))
      .toBe(formatCellValue('2026-08-01', DATE_META));
  });
});

describe('row helpers thread the timezone through', () => {
  const metaMap = new Map<string, ExportFieldMeta>([
    ['scanned_at', DATETIME_META],
    ['due', DATE_META],
  ]);
  const row = { scanned_at: CROSS_MONTH_UTC, due: '2026-08-01' };

  it('formatRowCells (the CSV / XLSX column path)', () => {
    expect(formatRowCells(row, ['scanned_at', 'due'], metaMap, SHANGHAI))
      .toEqual([IN_SHANGHAI, '2026-08-01']);
    expect(formatRowCells(row, ['scanned_at', 'due'], metaMap))
      .toEqual([IN_UTC, '2026-08-01']);
  });

  it('formatRowForJson', () => {
    expect(formatRowForJson(row, metaMap, SHANGHAI))
      .toMatchObject({ scanned_at: IN_SHANGHAI, due: '2026-08-01' });
    expect(formatRowForJson(row, metaMap))
      .toMatchObject({ scanned_at: IN_UTC, due: '2026-08-01' });
  });
});

// ---------------------------------------------------------------------------
// Route level — the REAL export route over a REAL engine, sqlite `:memory:`
// and the real metadata accessor, mirroring `export-integration.test.ts`. The
// only stub is `resolveExecCtx`, which stands in for the identity + localization
// cascade (`resolveLocalizationContext` → `ExecutionContext.timezone`).
// ---------------------------------------------------------------------------

const SHIFT = {
  name: 'shift',
  label: 'Shift',
  systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    scanned_at: { name: 'scanned_at', type: 'datetime' as const, label: '扫码时间' },
    due: { name: 'due', type: 'date' as const, label: '截止' },
  },
};

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

function createMockServer() {
  const noop = () => {};
  return {
    get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop,
    listen: async () => {}, close: async () => {},
  };
}

function makeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const res: any = {
    write: (s: string) => { chunks.push(typeof s === 'string' ? s : String(s)); return true; },
    end: () => {},
    header: (n: string, v: string) => { headers[n] = v; return res; },
    status: () => res,
    json: () => res,
  };
  return { res, chunks, headers };
}

function makeBinRes() {
  const chunks: Buffer[] = [];
  const res: any = {
    write: (c: any) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); return true; },
    end: () => {},
    header: () => res,
    status: () => res,
    json: () => res,
  };
  return { res, getBuffer: () => Buffer.concat(chunks) };
}

/** Boot the real stack; `timezone` is what the resolved ExecutionContext carries. */
async function boot(timezone?: string) {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  engine.registry.registerObject(SHIFT as any);
  await engine.syncSchemas();
  await engine.insert('shift', { id: '1', scanned_at: CROSS_MONTH_UTC, due: '2026-08-01' });

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(
    createMockServer() as any,
    protocol as any,
    { api: { requireAuth: false } } as any,
  );
  (rest as any).resolveExecCtx = async () => ({
    userId: 'test-user',
    ...(timezone ? { timezone } : {}),
  });
  rest.registerRoutes();
  const route = rest.getRoutes().find(
    (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export',
  );
  return route as any;
}

async function csvRow(timezone?: string): Promise<string[]> {
  const route = await boot(timezone);
  const { res, chunks } = makeRes();
  await route.handler({ params: { object: 'shift' }, query: { format: 'csv' } } as any, res);
  const lines = chunks.join('').split('\r\n').filter((l) => l.length > 0);
  return lines[1].split(',');
}

async function xlsxRow(timezone?: string): Promise<string[]> {
  const route = await boot(timezone);
  const { res, getBuffer } = makeBinRes();
  await route.handler({ params: { object: 'shift' }, query: { format: 'xlsx' } } as any, res);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(getBuffer() as any);
  return (wb.worksheets[0].getRow(2).values as any[]).slice(1).map((v) => String(v));
}

describe('GET /data/:object/export — the file agrees with the screen', () => {
  let sanity: any;
  beforeEach(async () => {
    sanity = await boot(SHANGHAI);
    expect(sanity).toBeDefined();
  });

  it('CSV: the cross-month row stays in August under Asia/Shanghai', async () => {
    const cells = await csvRow(SHANGHAI);
    expect(cells).toEqual(['1', IN_SHANGHAI, '2026-08-01']);
    // The whole point, stated as the customer would: the row is in the month
    // they see on screen, not the previous one.
    expect(cells[1].startsWith('2026-08')).toBe(true);
  });

  it('XLSX: the same row, the same clock — not just the CSV path', async () => {
    const cells = await xlsxRow(SHANGHAI);
    expect(cells).toEqual(['1', IN_SHANGHAI, '2026-08-01']);
    expect(cells[1].startsWith('2026-08')).toBe(true);
  });

  it('JSON: shares the formatter, so it shares the clock', async () => {
    const route = await boot(SHANGHAI);
    const { res, chunks } = makeRes();
    await route.handler({ params: { object: 'shift' }, query: { format: 'json' } } as any, res);
    const arr = JSON.parse(chunks.join(''));
    expect(arr[0]).toMatchObject({ scanned_at: IN_SHANGHAI, due: '2026-08-01' });
  });

  it('CSV and XLSX agree cell for cell', async () => {
    expect(await csvRow(SHANGHAI)).toEqual(await xlsxRow(SHANGHAI));
  });

  it('no timezone on the context ⇒ UTC, exactly as before #8373', async () => {
    expect(await csvRow()).toEqual(['1', IN_UTC, '2026-08-01']);
    expect(await xlsxRow()).toEqual(['1', IN_UTC, '2026-08-01']);
  });

  it('an unknown zone degrades to UTC rather than failing the export', async () => {
    expect(await csvRow('Not/AZone')).toEqual(['1', IN_UTC, '2026-08-01']);
  });

  it('the date column is the same calendar day in every zone', async () => {
    const shanghai = await csvRow(SHANGHAI);
    const newYork = await csvRow('America/New_York');
    const utc = await csvRow();
    expect(shanghai[2]).toBe('2026-08-01');
    expect(newYork[2]).toBe('2026-08-01');
    expect(utc[2]).toBe('2026-08-01');
  });
});
