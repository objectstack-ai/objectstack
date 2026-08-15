// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8485] A spreadsheet cell with no offset is a WALL CLOCK, and the import
 * path must read it in the tenant's business timezone — not in the deployment
 * host's `TZ`.
 *
 * `parseDateCell` ended in `new Date(s)`, which resolves an offset-free
 * date-time form against the **process** timezone (ECMAScript; date-only forms
 * are UTC, which is why the fast path above it is fine). So the stored instant
 * was a property of the host: `2026-08-01 06:00:00` became `2026-07-31T22:00Z`
 * on a `TZ=Asia/Shanghai` host and `2026-08-01T06:00Z` on a `TZ=UTC` one —
 * eight hours apart for the same file, same tenant, same cell, decided by a
 * setting nobody authoring the spreadsheet can see.
 *
 * Since export renders `datetime` cells in the business timezone (#8373), the
 * advertised export → edit → re-import round trip was lossless **only** where
 * the host `TZ` happened to equal that zone. Every fixture here therefore runs
 * under a host `TZ` deliberately different from the business timezone — a test
 * that runs only under a matching `TZ` cannot fail — and every datetime fixture
 * straddles a **month** boundary, because a mid-day instant survives most wrong
 * implementations untouched.
 *
 * Four contracts are pinned:
 *
 *  1. a naive `datetime` cell is read in `ExecutionContext.timezone`, and the
 *     answer does not move when the host `TZ` does;
 *  2. a cell that carries an explicit offset (`…Z`, `…+08:00`) is honoured
 *     exactly as written — this change touches naive cells only;
 *  3. the date-only fast path stays UTC (ADR-0053: a `date` is a
 *     timezone-naive calendar day, and ECMAScript already reads `YYYY-MM-DD`
 *     as UTC);
 *  4. **no timezone resolved ⇒ UTC**, matching what the export writes in that
 *     case, so the round trip stays exact for deployments that configure none.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';
import { parseDateCell, coerceFieldValue, coerceRow } from './import-coerce.js';
import { parseXlsxToRows } from './import-prepare.js';
import { formatCellValue } from './export-format.js';
import type { ExportFieldMeta } from './export-format.js';

// The instant at the heart of the report, shared with `export-business-timezone.test.ts`:
// 2026-08-01 06:00 in +08 is 2026-07-31 22:00 UTC — a different day, MONTH and quarter.
const CROSS_MONTH_UTC = '2026-07-31T22:00:00.000Z';
const IN_SHANGHAI = '2026-08-01 06:00:00';
const SHANGHAI = 'Asia/Shanghai';
const NEW_YORK = 'America/New_York';

const DATETIME_META: ExportFieldMeta = { name: 'scanned_at', type: 'datetime' };
const DATE_META: ExportFieldMeta = { name: 'due', type: 'date' };
const TIME_META: ExportFieldMeta = { name: 'opens_at', type: 'time' };

// ---------------------------------------------------------------------------
// Host-`TZ` control. Node re-reads `process.env.TZ` on the next Date operation,
// so a test can stand in for a deployment host without a second process. Every
// host below is chosen to DISAGREE with the business timezone under test.
// ---------------------------------------------------------------------------

const HOSTS = ['UTC', 'America/Los_Angeles', SHANGHAI, 'Pacific/Kiritimati'];
const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** Run `fn` once per host timezone, returning what each host produced. */
function onEveryHost<T>(fn: () => T): T[] {
  return HOSTS.map((tz) => {
    process.env.TZ = tz;
    // The host really did change under us — otherwise this file asserts one
    // configuration four times and every "host-independent" claim below is
    // vacuous. Node re-reads TZ lazily, so this is also what forces the switch.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(tz);
    return fn();
  });
}

/** The process clock's own reading of an offset-free cell — what the fix removes. */
const processClockReading = (cell: string) => new Date(cell).toISOString();

describe('parseDateCell — an offset-free datetime cell reads in the business timezone', () => {
  it('the reported cell lands in the month the tenant sees, on every host', () => {
    const answers = onEveryHost(() => parseDateCell(IN_SHANGHAI, 'datetime', SHANGHAI));
    expect(answers).toEqual(HOSTS.map(() => CROSS_MONTH_UTC));
  });

  it('the host TZ no longer decides the instant — that IS the defect', () => {
    const cell = '2026-09-01 00:30:00';
    // Before the fix this array held FOUR different instants, one per host…
    const hostReadings = onEveryHost(() => processClockReading(cell));
    expect(new Set(hostReadings).size).toBe(HOSTS.length);
    // …and now one, whatever the host.
    const answers = onEveryHost(() => parseDateCell(cell, 'datetime', SHANGHAI));
    expect(new Set(answers).size).toBe(1);
    // Cross-month in the other direction: 00:30 on Sep 1 (+08) is Aug 31 UTC.
    expect(answers[0]).toBe('2026-08-31T16:30:00.000Z');
  });

  it('honours a DST zone on both sides of the year', () => {
    process.env.TZ = SHANGHAI; // a host that agrees with neither answer
    expect(parseDateCell('2026-06-15 12:00:00', 'datetime', NEW_YORK)).toBe('2026-06-15T16:00:00.000Z');
    expect(parseDateCell('2026-01-15 12:00:00', 'datetime', NEW_YORK)).toBe('2026-01-15T17:00:00.000Z');
  });

  it('accepts the shapes a spreadsheet actually writes (T or space, optional seconds/millis, slashes)', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(parseDateCell('2026-08-01T06:00:00', 'datetime', SHANGHAI)).toBe(CROSS_MONTH_UTC);
    expect(parseDateCell('2026-08-01 06:00', 'datetime', SHANGHAI)).toBe(CROSS_MONTH_UTC);
    expect(parseDateCell('2026/08/01 06:00:00', 'datetime', SHANGHAI)).toBe(CROSS_MONTH_UTC);
    expect(parseDateCell('2026-08-01 06:00:00.123', 'datetime', SHANGHAI)).toBe('2026-07-31T22:00:00.123Z');
  });

  it('an unparseable cell is still a coercion failure, not an invalid instant', () => {
    expect(parseDateCell('not a date', 'datetime', SHANGHAI)).toBeUndefined();
    expect(parseDateCell('2026-13-45 99:00:00', 'datetime', SHANGHAI)).toBeUndefined();
  });
});

describe('parseDateCell — what deliberately does NOT move', () => {
  it('an explicit offset is honoured exactly as written', () => {
    // The cell already names one instant; a business timezone has no say.
    for (const cell of ['2026-08-01T06:00:00Z', '2026-08-01T06:00:00+08:00', '2026-08-01T06:00:00-05:00']) {
      const answers = onEveryHost(() => [
        parseDateCell(cell, 'datetime', SHANGHAI),
        parseDateCell(cell, 'datetime', NEW_YORK),
        parseDateCell(cell, 'datetime'),
      ]);
      const flat = answers.flat();
      expect(new Set(flat).size).toBe(1);
      expect(flat[0]).toBe(new Date(cell).toISOString());
    }
  });

  it('the date-only fast path stays UTC in every zone (ADR-0053)', () => {
    const answers = onEveryHost(() => [
      parseDateCell('2026-08-01', 'datetime', SHANGHAI),
      parseDateCell('2026-08-01', 'datetime', NEW_YORK),
      parseDateCell('2026-08-01', 'datetime'),
      parseDateCell('2026-08-01', 'date', SHANGHAI),
    ]);
    for (const [dtShanghai, dtNewYork, dtNone, dateShanghai] of answers) {
      expect(dtShanghai).toBe('2026-08-01T00:00:00.000Z');
      expect(dtNewYork).toBe('2026-08-01T00:00:00.000Z');
      expect(dtNone).toBe('2026-08-01T00:00:00.000Z');
      expect(dateShanghai).toBe('2026-08-01');
    }
  });

  it('a `date` field takes the typed calendar day, never a re-projected one', () => {
    // A naive datetime cell aimed at a `date` column: the day the author typed,
    // on every host. (This branch used to read the process clock too, so
    // `2026-08-01 06:00:00` stored `2026-07-31` on any host east of the cell.)
    const answers = onEveryHost(() => parseDateCell(IN_SHANGHAI, 'date', NEW_YORK));
    expect(answers).toEqual(HOSTS.map(() => '2026-08-01'));
  });

  it('a `time` field takes the typed clock, never a re-projected one', () => {
    const answers = onEveryHost(() => parseDateCell(IN_SHANGHAI, 'time', NEW_YORK));
    expect(answers).toEqual(HOSTS.map(() => '06:00:00'));
    expect(parseDateCell('06:00', 'time', NEW_YORK)).toBe('06:00:00');
  });
});

describe('parseDateCell — the no-zone-resolves fallback is UTC, and pinned', () => {
  it('no timezone ⇒ the wall clock is read as UTC, on every host', () => {
    // The deliberate choice (#8485): the export renderer writes UTC when no
    // business timezone resolves, so import reads UTC and the round trip stays
    // an inverse. Falling back to the process clock would have preserved the
    // defect for exactly the deployments that never configured a zone.
    const answers = onEveryHost(() => parseDateCell(IN_SHANGHAI, 'datetime'));
    expect(answers).toEqual(HOSTS.map(() => '2026-08-01T06:00:00.000Z'));
  });

  it('a zone the platform does not know degrades to UTC rather than failing the row', () => {
    const answers = onEveryHost(() => parseDateCell(IN_SHANGHAI, 'datetime', 'Not/AZone'));
    expect(answers).toEqual(HOSTS.map(() => '2026-08-01T06:00:00.000Z'));
  });

  it("an explicit 'UTC' is a RESOLVED zone, and agrees", () => {
    expect(parseDateCell(IN_SHANGHAI, 'datetime', 'UTC')).toBe('2026-08-01T06:00:00.000Z');
  });
});

describe('coerceFieldValue / coerceRow — the timezone reaches the cell', () => {
  it('CoerceContext.timezone drives the datetime branch', async () => {
    process.env.TZ = 'America/Los_Angeles';
    await expect(coerceFieldValue(IN_SHANGHAI, DATETIME_META, { timezone: SHANGHAI }))
      .resolves.toEqual({ value: CROSS_MONTH_UTC });
    await expect(coerceFieldValue(IN_SHANGHAI, DATETIME_META, {}))
      .resolves.toEqual({ value: '2026-08-01T06:00:00.000Z' });
  });

  it('a whole row coerces its date-ish columns in one zone', async () => {
    process.env.TZ = 'Pacific/Kiritimati';
    const metaMap = new Map<string, ExportFieldMeta>([
      ['scanned_at', DATETIME_META],
      ['due', DATE_META],
      ['opens_at', TIME_META],
    ]);
    const { data, errors } = await coerceRow(
      { scanned_at: IN_SHANGHAI, due: '2026-08-01', opens_at: '09:30' },
      metaMap,
      { timezone: SHANGHAI },
    );
    expect(errors).toEqual([]);
    expect(data).toEqual({
      scanned_at: CROSS_MONTH_UTC,
      due: '2026-08-01',
      opens_at: '09:30:00',
    });
  });
});

// ---------------------------------------------------------------------------
// The acceptance criterion: `import-coerce.ts` opens by declaring itself "the
// inverse of `export-format.ts`". Inverse-ness is a property of the PAIR, so it
// is asserted on the pair — under hosts that agree with neither the business
// timezone nor UTC.
// ---------------------------------------------------------------------------

describe('export → import is an identity on the instant', () => {
  it('every zone × every host: the cell the export wrote re-imports to the same instant', () => {
    for (const businessTz of [SHANGHAI, NEW_YORK, 'Asia/Kathmandu', 'UTC', undefined]) {
      onEveryHost(() => {
        for (const instant of [
          CROSS_MONTH_UTC,               // crosses a month in +08
          '2026-01-01T04:30:00.000Z',    // crosses a YEAR in −05
          '2026-06-15T16:00:00.000Z',    // DST summer in New York
          '2026-01-15T17:00:00.000Z',    // DST winter in New York
          '2026-03-08T07:30:00.000Z',    // the hour after a US spring-forward
          '2026-11-01T05:30:00.000Z',    // the first of the two US fall-back 01:30s
        ]) {
          const cell = String(formatCellValue(instant, DATETIME_META, businessTz));
          expect(parseDateCell(cell, 'datetime', businessTz)).toBe(instant);
        }
      });
    }
  });

  it('the export cell really is offset-free — otherwise the round trip proves nothing', () => {
    // If the export ever started writing an offset, the assertion above would
    // pass through the honoured-offset branch instead and stop covering this.
    expect(formatCellValue(CROSS_MONTH_UTC, DATETIME_META, SHANGHAI)).toBe(IN_SHANGHAI);
    expect(IN_SHANGHAI).not.toMatch(/(Z|[+-]\d{2}:?\d{2})$/);
  });
});

// ---------------------------------------------------------------------------
// xlsx: an Excel serial date carries NO zone. ExcelJS materialises it as a Date
// whose UTC components are the sheet's wall clock, so rendering it with
// `toISOString()` stamped a `Z` the file never had — and a written offset is
// honoured by contract, which silently outranked the business timezone for
// every real date cell in a user-authored workbook.
// ---------------------------------------------------------------------------

describe('xlsx import — a sheet date cell is a wall clock, not a UTC instant', () => {
  async function xlsxWithDateCell(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('rows');
    ws.addRow(['id', 'scanned_at']);
    // What Excel shows in the cell: 2026-08-01 06:00:00, no zone anywhere.
    ws.addRow(['1', new Date(Date.UTC(2026, 7, 1, 6, 0, 0))]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('the parsed cell is the sheet wall clock, and coerces in the business timezone', async () => {
    const buf = await xlsxWithDateCell();
    process.env.TZ = 'America/Los_Angeles';
    const rows = await parseXlsxToRows(buf);
    expect(rows[0].scanned_at).toBe(IN_SHANGHAI);

    const metaMap = new Map<string, ExportFieldMeta>([['scanned_at', DATETIME_META]]);
    const { data, errors } = await coerceRow(rows[0], metaMap, { timezone: SHANGHAI });
    expect(errors).toEqual([]);
    expect(data.scanned_at).toBe(CROSS_MONTH_UTC);
  });

  it('with no timezone resolved it is UTC — the same fallback as every other cell', async () => {
    const buf = await xlsxWithDateCell();
    process.env.TZ = SHANGHAI;
    const rows = await parseXlsxToRows(buf);
    const metaMap = new Map<string, ExportFieldMeta>([['scanned_at', DATETIME_META]]);
    const { data } = await coerceRow(rows[0], metaMap, {});
    expect(data.scanned_at).toBe('2026-08-01T06:00:00.000Z');
  });

  it('a RAW Excel serial — what a user-authored file actually stores — reads the same', async () => {
    // The fixtures above hand ExcelJS a `Date` and let it encode the serial, so
    // they would still pass if its encode and decode were wrong symmetrically.
    // A real .xlsx holds a serial number plus a date `numFmt` and no zone at
    // all, so build that shape directly: days since the 1899-12-30 epoch, +0.25
    // of a day for 06:00. Measured host-independent — ExcelJS reads the serial
    // into a `Date` whose UTC components are the sheet's wall clock.
    const serial =
      Math.round((Date.UTC(2026, 7, 1) - Date.UTC(1899, 11, 30)) / 86400000) + 0.25;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('rows');
    ws.addRow(['id', 'scanned_at']);
    const row = ws.addRow(['1', serial]);
    row.getCell(2).numFmt = 'yyyy-mm-dd hh:mm:ss';
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const metaMap = new Map<string, ExportFieldMeta>([['scanned_at', DATETIME_META]]);
    for (const host of HOSTS) {
      process.env.TZ = host;
      const rows = await parseXlsxToRows(buf);
      expect(rows[0].scanned_at).toBe(IN_SHANGHAI);
      const { data, errors } = await coerceRow(rows[0], metaMap, { timezone: SHANGHAI });
      expect(errors).toEqual([]);
      expect(data.scanned_at).toBe(CROSS_MONTH_UTC);
    }
  });
});

// ---------------------------------------------------------------------------
// Route level — the REAL export route feeding the REAL import route over a REAL
// engine, sqlite `:memory:` and the real metadata accessor. The only stub is
// `resolveExecCtx`, standing in for the identity + localization cascade
// (`resolveLocalizationContext` → `ExecutionContext.timezone`), exactly as
// `export-business-timezone.test.ts` does.
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

function makeStreamRes() {
  const chunks: string[] = [];
  const res: any = {
    write: (s: string) => { chunks.push(typeof s === 'string' ? s : String(s)); return true; },
    end: () => {},
    header: () => res,
    status: () => res,
    json: () => res,
  };
  return { res, text: () => chunks.join('') };
}

function makeJsonRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

async function boot(timezone?: string) {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerObject(SHIFT as any);
  await engine.syncSchemas();
  await engine.insert('shift', { id: '1', scanned_at: CROSS_MONTH_UTC, due: '2026-08-01' });

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({
    userId: 'test-user',
    ...(timezone ? { timezone } : {}),
  });
  rest.registerRoutes();
  const routes = rest.getRoutes();
  return {
    engine,
    exportRoute: routes.find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export') as any,
    importRoute: routes.find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/import') as any,
  };
}

/**
 * The stored instant, refusing to guess. A storage layer that handed back an
 * offset-free string would make `new Date()` read the HOST clock here — the
 * very confusion under test — so that shape fails loudly instead.
 */
function storedInstant(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const s = String(value);
  expect(s).toMatch(/(Z|[+-]\d{2}:?\d{2})$/);
  return new Date(s).toISOString();
}

describe('POST /data/:object/import — the round trip a customer actually runs', () => {
  beforeEach(() => {
    // A host that is neither the business timezone nor UTC: the configuration
    // where today's import is wrong, and the only one where this can fail.
    process.env.TZ = 'America/Los_Angeles';
  });

  it('export → edit the id → re-import stores the SAME instant', async () => {
    const { engine, exportRoute, importRoute } = await boot(SHANGHAI);

    const { res, text } = makeStreamRes();
    await exportRoute.handler({ params: { object: 'shift' }, query: { format: 'csv' } } as any, res);
    const lines = text().split('\r\n').filter((l) => l.length > 0);
    const header = lines[0].split(',');
    const cells = lines[1].split(',');
    // What the customer opens in Excel: business-timezone wall clock, no offset.
    expect(cells[1]).toBe(IN_SHANGHAI);

    // The one edit a customer makes before re-importing: a new key.
    const csv = [lines[0], ['2', cells[1], cells[2]].join(',')].join('\n');
    const mapping: Record<string, string> = {};
    header.forEach((h, i) => { mapping[h] = ['id', 'scanned_at', 'due'][i]; });

    const jsonRes = makeJsonRes();
    await importRoute.handler(
      { params: { object: 'shift' }, body: { format: 'csv', csv, mapping, writeMode: 'insert' } } as any,
      jsonRes,
    );
    expect(jsonRes._json).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });

    const original = await engine.findOne('shift', { where: { id: '1' } });
    const reimported = await engine.findOne('shift', { where: { id: '2' } });
    expect(storedInstant(reimported.scanned_at)).toBe(storedInstant(original.scanned_at));
    expect(storedInstant(reimported.scanned_at)).toBe(CROSS_MONTH_UTC);
    // Stated as the report does: the row is still in the month it was exported
    // from. Under the process clock it stored 2026-08-01T13:00Z on this host.
    expect(storedInstant(reimported.scanned_at)).not.toBe('2026-08-01T13:00:00.000Z');
    expect(String(reimported.due)).toContain('2026-08-01');
  });

  it('the same file imported by a UTC tenant is a different instant — the zone decides, not the host', async () => {
    const { engine, importRoute } = await boot(); // no business timezone resolved
    const csv = ['ID,扫码时间', `2,${IN_SHANGHAI}`].join('\n');
    const jsonRes = makeJsonRes();
    await importRoute.handler(
      {
        params: { object: 'shift' },
        body: { format: 'csv', csv, mapping: { ID: 'id', 扫码时间: 'scanned_at' }, writeMode: 'insert' },
      } as any,
      jsonRes,
    );
    expect(jsonRes._json).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
    const stored = await engine.findOne('shift', { where: { id: '2' } });
    expect(storedInstant(stored.scanned_at)).toBe('2026-08-01T06:00:00.000Z');
  });
});
