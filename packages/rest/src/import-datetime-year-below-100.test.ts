// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20599] `POST /api/v1/data/:object/import` stores a zone-naive `datetime`
 * cell in 0001..0099 in its own year.
 *
 * The cell is a wall clock, read in the business timezone by core's
 * `zonedWallClockToUtcMs`. That built the wall clock, and read the zone's
 * offset, with `Date.UTC(year, …)`, which reads a year from 0 to 99 as
 * 1900 + year: the cell `0050-01-01 10:00` was stored as
 * `1950-01-01T10:00:00.000Z`, `ok` and with no error. Core builds through
 * `wallClockToUtcMs` now; this reader is unchanged.
 *
 * Three layers, each with 0001, 0050 and 0099, 0100 (the first year `Date.UTC`
 * reads as written) and a 2026 control:
 *
 * - **the cell reader** (`parseDateCell`), with no zone, in UTC and in
 *   Asia/Shanghai, on a UTC host and an Asia/Shanghai host;
 * - **the import door**: a CSV imported over a real engine (SqlDriver on
 *   SQLite) stores the instant the cell names;
 * - **export → import**: rows written through the create door, exported as CSV
 *   and JSON and re-imported into a fresh stack, store the same instant, under
 *   no business timezone, Asia/Shanghai and America/New_York.
 *
 * The export writes a year below 1000 unpadded (`50-01-01 10:00:00`), which the
 * import refuses: that is #20602's half of the round trip, not this card's. So
 * the round trip below pads the exported year to four digits, as #20602's
 * export will write it, before re-importing; once the export pads, that step
 * changes nothing. Before 1901 the tz database gives Asia/Shanghai its local
 * mean time, +08:05:43, and America/New_York −04:56:02, which is the offset
 * both directions read those years at.
 *
 * ## [#20280] A `datetime` begins at year 1000
 *
 * MySQL documents its `DATETIME` from year 1000 only, and reads one stored in
 * 0001..0099 back a century late, so the write door behind the import refuses
 * a `datetime` in 0001..0999 now. The reader layer is unchanged: it still reads
 * each cell in its own year, which is what #20599 fixed. The import door
 * refuses each such row as `invalid_date` and stores nothing for it, beside the
 * floor's first day (`1000-01-01 10:00`, still before 1901, so the tz
 * database's local mean time still reads it) and the 2026 control, which it
 * stores. The round trip runs at 1000 and 2026: the create door refuses the
 * earlier years, so they have no row to export.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';
import { parseDateCell } from './import-coerce.js';

const SHANGHAI = 'Asia/Shanghai';
const NEW_YORK = 'America/New_York';

/** Each cell, and the instant it names with no zone and in Asia/Shanghai. */
const CELLS = [
  { id: 'c0001', cell: '0001-01-01 10:00', utc: '0001-01-01T10:00:00.000Z', shanghai: '0001-01-01T01:54:17.000Z' },
  { id: 'c0050', cell: '0050-01-01 10:00', utc: '0050-01-01T10:00:00.000Z', shanghai: '0050-01-01T01:54:17.000Z' },
  { id: 'c0050s', cell: '0050/1/1 10:00', utc: '0050-01-01T10:00:00.000Z', shanghai: '0050-01-01T01:54:17.000Z' },
  { id: 'c0099', cell: '0099-12-31 23:59:59', utc: '0099-12-31T23:59:59.000Z', shanghai: '0099-12-31T15:54:16.000Z' },
  { id: 'c0100', cell: '0100-01-01 10:00', utc: '0100-01-01T10:00:00.000Z', shanghai: '0100-01-01T01:54:17.000Z' },
  // [#20280] The `datetime` floor's first day.
  { id: 'c1000', cell: '1000-01-01 10:00', utc: '1000-01-01T10:00:00.000Z', shanghai: '1000-01-01T01:54:17.000Z' },
  { id: 'c2026', cell: '2026-07-15 10:00', utc: '2026-07-15T10:00:00.000Z', shanghai: '2026-07-15T02:00:00.000Z' },
  // A bare day is midnight UTC in every zone (#20534 already read it so).
  { id: 'd0050', cell: '0050-01-01', utc: '0050-01-01T00:00:00.000Z', shanghai: '0050-01-01T00:00:00.000Z' },
] as const;

// ---------------------------------------------------------------------------
// The cell reader, on two hosts.
// ---------------------------------------------------------------------------

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe.each(['UTC', SHANGHAI])('[#20599] parseDateCell on a %s host', (host) => {
  it.each(CELLS)('reads $cell in its own year', ({ cell, utc, shanghai }) => {
    process.env.TZ = host;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(host);
    expect(parseDateCell(cell, 'datetime')).toBe(utc);
    expect(parseDateCell(cell, 'datetime', 'UTC')).toBe(utc);
    expect(parseDateCell(cell, 'datetime', SHANGHAI)).toBe(shanghai);
  });
});

// ---------------------------------------------------------------------------
// The routes, over a real engine.
// ---------------------------------------------------------------------------

/** [#20280] The cells the import door stores: a `datetime` from year 1000 on. */
const STORED: ReadonlyArray<(typeof CELLS)[number]> = CELLS.filter((c) => c.utc >= '1000');

const OBJECT = 'import_year_below_100_20599';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20599',
  systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    dt: { name: 'dt', type: 'datetime' as const, label: 'At' },
  },
};

const MAPPING = { ID: 'id', At: 'dt' };

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
  res._text = () => Buffer.concat(chunks).toString('utf8');
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
    exportAs: (format: 'csv' | 'json') => send(exportRoute, { query: { format } }),
    importBody: (body: Record<string, unknown>) => send(importRoute, { body }),
  };
}

/** The stored instant, as ISO. An offset-free string would be read in the host zone, so it fails instead. */
function storedInstant(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const s = String(value);
  expect(s).toMatch(/(Z|[+-]\d{2}:?\d{2})$/);
  return new Date(s).toISOString();
}

describe.each([
  ['no business timezone', undefined, 'utc'],
  ['UTC', 'UTC', 'utc'],
  ['Asia/Shanghai', SHANGHAI, 'shanghai'],
] as const)('[#20599] POST /import, %s', (_label, zone, column) => {
  const engines: ObjectQL[] = [];
  let stack: Awaited<ReturnType<typeof boot>>;
  let summary: any;

  beforeAll(async () => {
    stack = await boot(zone, engines);
    const csv = ['ID,At', ...CELLS.map((c) => `${c.id},${c.cell}`)].join('\r\n');
    summary = (await stack.importBody({ format: 'csv', csv, mapping: MAPPING, writeMode: 'insert' }))._json;
  });

  afterAll(async () => {
    while (engines.length) {
      try { await engines.pop()?.destroy(); } catch { /* noop */ }
    }
  });

  it('[#20280] imports the rows from year 1000 on, and refuses each row below it as invalid_date', () => {
    expect(summary).toMatchObject({ total: CELLS.length, ok: STORED.length, errors: CELLS.length - STORED.length });
    for (const [i, c] of CELLS.entries()) {
      if (STORED.includes(c)) continue;
      expect(summary.results[i], c.cell).toMatchObject({ ok: false, action: 'failed', field: 'dt', code: 'invalid_date' });
    }
  });

  it.each(STORED)('stores $cell as the instant it names', async (c) => {
    const back = await stack.engine.findOne(OBJECT, { where: { id: c.id } });
    expect(storedInstant(back?.dt)).toBe(c[column]);
  });

  it('[#20280] stores nothing for a row below year 1000', async () => {
    for (const c of CELLS.filter((x) => !STORED.includes(x))) {
      expect(await stack.engine.findOne(OBJECT, { where: { id: c.id } }), c.cell).toBeNull();
    }
  });
});

/**
 * The export spells a year below 1000 unpadded, and the import refuses that
 * cell: #20602's half of the round trip. Pad it as #20602's export will, so
 * this measures the import half. A four-digit year is left alone.
 */
const padExportYear = (cell: string) => cell.replace(/^(\d{1,3})-/, (_m, y: string) => `${y.padStart(4, '0')}-`);

// [#20280] From the `datetime` floor on: the create door refuses the earlier years.
const ROUND_TRIP_YEARS = ['1000', '2026'] as const;
const ROWS = ROUND_TRIP_YEARS.map((year) => ({ id: `y${year}`, dt: `${year}-01-01T10:00:00.000Z` }));

describe.each([undefined, SHANGHAI, NEW_YORK] as const)('[#20599] GET /export then POST /import, business timezone %s', (zone) => {
  describe.each(['csv', 'json'] as const)('format %s', (format) => {
    const engines: ObjectQL[] = [];
    let source: Awaited<ReturnType<typeof boot>>;
    let target: Awaited<ReturnType<typeof boot>>;
    let summary: any;

    beforeAll(async () => {
      source = await boot(zone, engines);
      for (const row of ROWS) {
        const created = await source.create(row);
        expect(created._status ?? 201, `create ${row.id}`).toBe(201);
      }
      const exported = await source.exportAs(format);
      expect(exported._status ?? 200).toBe(200);

      let body: Record<string, unknown>;
      if (format === 'json') {
        const rows = JSON.parse(exported._text()).map((r: any) => ({ ...r, dt: padExportYear(String(r.dt)) }));
        expect(rows).toHaveLength(ROWS.length);
        body = { format, rows, writeMode: 'insert' };
      } else {
        const [header, ...lines] = exported._text().split('\r\n').filter((l: string) => l.length > 0);
        expect(header).toBe('ID,At');
        expect(lines).toHaveLength(ROWS.length);
        const csv = [header, ...lines.map((l: string) => {
          const [id, dt] = l.split(',');
          return `${id},${padExportYear(dt)}`;
        })].join('\r\n');
        body = { format, csv, mapping: MAPPING, writeMode: 'insert' };
      }

      target = await boot(zone, engines);
      summary = (await target.importBody(body))._json;
    });

    afterAll(async () => {
      while (engines.length) {
        try { await engines.pop()?.destroy(); } catch { /* noop */ }
      }
    });

    it('re-imports every row', () => {
      expect(summary).toMatchObject({ total: ROWS.length, ok: ROWS.length, errors: 0 });
    });

    it.each(ROWS)('stores $dt back as itself', async (row) => {
      const back = await target.engine.findOne(OBJECT, { where: { id: row.id } });
      const src = await source.engine.findOne(OBJECT, { where: { id: row.id } });
      expect(storedInstant(src?.dt)).toBe(row.dt);
      expect(storedInstant(back?.dt)).toBe(row.dt);
    });
  });
});
