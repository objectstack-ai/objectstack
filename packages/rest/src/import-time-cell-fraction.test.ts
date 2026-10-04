// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20722] `POST /api/v1/data/:object/import` reads a `time` cell by
 * `@objectstack/core`'s one `time` rule, the rule the write door asks since
 * #20671. So the cell `/export` writes for a `time` with milliseconds
 * (`10:00:00.250`) re-imports as itself, and the two doors agree cell for cell:
 * a fraction is admitted on both, and a `Z` / offset suffix on a time of day is
 * refused on both with the same field code, `invalid_time`.
 *
 * Measured through the routes at the base (`96e72447`) and after, the process
 * in America/New_York, on InMemoryDriver, SqlDriver over SQLite and SqlDriver
 * over PostgreSQL 16.13 at `Asia/Shanghai` — the three answered alike on every
 * row. The write door's column is unchanged by this fix.
 *
 * | `time` value | write door | `/import`, base | `/import`, now |
 * |:--|:--|:--|:--|
 * | `10:00:00.250`, `23:59:59.999` | 201, as written | row failed, `invalid_date` | as written |
 * | `10:00:00.5`, `10:00:00.000` | `10:00:00.500`, `10:00:00` | row failed, `invalid_date` | the write door's value |
 * | `2026-07-15T10:00:00.250Z`, `2026-07-15 10:00:00.250` | `10:00:00.250` | `10:00:00`, the fraction dropped | `10:00:00.250` |
 * | `9999-12-31T23:00:00-02:00` | 400 `invalid_time` | `01:00:00` | row failed, `invalid_time` |
 * | `10:00Z`, `10:00+08:00`, `10:00:00.250Z`, `+010000-01-01T10:00:00Z`, `25:00`, `9:00`, `07/15/2026 10:00` | 400 `invalid_time` | row failed, `invalid_date` | row failed, `invalid_time` |
 * | `10:00:00`, `10:00`, `2026-07-15T18:00:00+08:00` | `10:00:00` | `10:00:00` | unchanged |
 * | export → import of `10:00:00.250`, `23:59:59.999` (CSV, JSON) | — | both rows failed | as exported |
 * | export → import of the `10:00:00` control | — | as exported | unchanged |
 *
 * The InMemoryDriver column came from a copy of this file with that driver in
 * place of `SqlDriver`, not committed (see the dialect axis below).
 *
 * ## What is pinned here
 *
 * - **the reader** (`parseDateCell(cell, 'time')`) on two host zones twelve
 *   hours apart;
 * - **the two doors, cell for cell**: each cell is written through
 *   `POST /api/v1/data/:object` and imported through
 *   `POST /api/v1/data/:object/import`, and both answer the same, a stored
 *   value read back through the engine or a refusal with field code
 *   `invalid_time`. The year-first date-time (`2026/7/15 9:00`) is the one
 *   reading the import has that the write door has not (the maintainer ruling
 *   on #20534), and it is pinned as that;
 * - **export → import**: rows written through the create door with
 *   `10:00:00.250`, `23:59:59.999` and the `10:00:00` control, exported as CSV
 *   and JSON, and re-imported, store what they were exported from.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise. It owns one
 * table, dropped before and after. An in-memory cell is not here:
 * `@objectstack/driver-memory` has no binding in this package, and a new one
 * is a census decision (`scripts/driver-memory-census.ledger.json`), not a
 * test's. The import's verdict is formed by its own reader before any driver
 * is reached, and the memory driver's write half is pinned in
 * `packages/drivers/driver-memory/src/memory-20671-time-write-zone-less.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server.js';
import { parseDateCell } from '@objectstack/core';

const OBJECT = 'import_time_fraction_20722';
const HOST_ZONE = 'America/New_York';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20722',
  systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    t: { name: 't', type: 'time' as const, label: 'Clock' },
  },
};

const MAPPING = { ID: 'id', Clock: 't' };

/** A cell both doors admit, and the wall clock both store. */
const ADMITTED: ReadonlyArray<readonly [cell: string, stored: string]> = [
  // The card: what `/export` writes for a `time` with milliseconds.
  ['10:00:00.250', '10:00:00.250'],
  ['23:59:59.999', '23:59:59.999'],
  ['10:00:00.5', '10:00:00.500'],
  // The controls, which already round-tripped.
  ['10:00:00', '10:00:00'],
  ['10:00', '10:00:00'],
  // A zero fraction is the form without one.
  ['10:00:00.000', '10:00:00'],
  // An ISO instant keeps its UTC time of day, fraction included (ADR-0053 D-C1).
  ['2026-07-15T10:00:00.250Z', '10:00:00.250'],
  ['2026-07-15T18:00:00+08:00', '10:00:00'],
  ['2026-07-15 10:00:00.250', '10:00:00.250'],
];

/** A cell both doors refuse, with field code `invalid_time`. */
const REFUSED: readonly string[] = [
  // A time of day carries no zone (#20671).
  '10:00Z',
  '10:00+08:00',
  '10:00:00.250Z',
  // An instant whose UTC year has no four-digit spelling.
  '9999-12-31T23:00:00-02:00',
  '+010000-01-01T10:00:00Z',
  // Out of range, a one-digit hour, a month-first date-time.
  '25:00',
  '9:00',
  '07/15/2026 10:00',
];

// ---------------------------------------------------------------------------
// The reader, on two hosts.
// ---------------------------------------------------------------------------

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe.each([HOST_ZONE, 'Asia/Shanghai'])('[#20722] parseDateCell(cell, "time") on a %s host', (host) => {
  it.each(ADMITTED)('reads %j as %j', (cell, stored) => {
    process.env.TZ = host;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(host);
    expect(parseDateCell(cell, 'time')).toBe(stored);
  });

  it.each(REFUSED)('refuses %j', (cell) => {
    process.env.TZ = host;
    expect(parseDateCell(cell, 'time')).toBeUndefined();
  });

  it('reads the year-first date-time, the import\'s own reading (#20534), as its wall clock', () => {
    process.env.TZ = host;
    expect(parseDateCell('2026/7/15 9:00', 'time')).toBe('09:00:00');
  });
});

// ---------------------------------------------------------------------------
// The routes, over a real engine.
// ---------------------------------------------------------------------------

interface Cell {
  id: 'sqlite' | 'pg';
  label: string;
  env: string | null;
  config: () => Record<string, unknown> | null;
}

const CELLS: readonly Cell[] = [
  { id: 'sqlite', label: 'sqlite', env: null, config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
  {
    id: 'pg',
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
  },
];

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const chunks: string[] = [];
  const res: any = {
    write: (c: unknown) => { chunks.push(Buffer.isBuffer(c) ? c.toString('utf8') : String(c)); return true; },
    end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  res._text = () => chunks.join('');
  return res;
}

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20722] /import reads a time cell as the write door does — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      let send: (method: string, path: string, req: Record<string, unknown>) => Promise<any>;
      const stored = async (id: string) => (await engine.findOne(OBJECT, { where: { id } }))?.t;
      const create = (row: Record<string, unknown>) => send('POST', '/api/v1/data/:object', { body: row });
      const importBody = async (body: Record<string, unknown>) =>
        (await send('POST', '/api/v1/data/:object/import', { body: { writeMode: 'insert', ...body } }))._json;

      beforeAll(async () => {
        // A host whose zone is not UTC, so a host-zone reading would show.
        process.env.TZ = HOST_ZONE;
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone, 'the host zone really changed').toBe(HOST_ZONE);

        driver = new SqlDriver(config as any);
        if (cell.id !== 'sqlite') await driver.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(LEDGER as any);
        await engine.syncSchemas();

        // [#21516] The protocol reads the stored-metadata family; the engine refuses a
        // name its registry does not hold, so the harness registers the family as a boot
        // does — after the DDL, so an unprovisioned store still answers "no such table".
        for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
          if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
        }
        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        send = async (method, path, req) => {
          const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path) as any;
          expect(route, `${method} ${path}`).toBeDefined();
          const res = makeRes();
          await route.handler({ params: { object: OBJECT }, query: {}, headers: {}, ...req } as any, res);
          return res;
        };
      });

      afterAll(async () => {
        if (cell.id !== 'sqlite') await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        try { await engine?.destroy(); } catch { /* noop */ }
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
      });

      it.each(ADMITTED.map(([c, s], i) => [c, s, i] as const))('stores %j as %j through both doors', async (value, want, i) => {
        const created = await create({ id: `w${i}`, t: value });
        expect(created._status ?? 201, `create ${value}: ${JSON.stringify(created._json)}`).toBe(201);
        const summary = await importBody({ format: 'json', rows: [{ id: `i${i}`, t: value }] });
        expect(summary, `import ${value}`).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
        expect(await stored(`w${i}`), `write door ${value}`).toBe(want);
        expect(await stored(`i${i}`), `import ${value}`).toBe(want);
      });

      it.each(REFUSED.map((c, i) => [c, i] as const))('refuses %j with invalid_time through both doors, and writes nothing', async (value, i) => {
        const created = await create({ id: `rw${i}`, t: value });
        expect(created._status, `create ${value}`).toBe(400);
        expect(created._json).toMatchObject({ code: 'VALIDATION_FAILED' });
        const doorCodes = created._json.fields.map((f: any) => [f.field, f.code]);
        expect(doorCodes, `create ${value}`).toEqual([['t', 'invalid_time']]);

        const summary = await importBody({ format: 'json', rows: [{ id: `ri${i}`, t: value }, { id: `rg${i}`, t: '10:00' }] });
        expect(summary, `import ${value}`).toMatchObject({ total: 2, ok: 1, errors: 1, created: 1 });
        expect(summary.results[0]).toMatchObject({ row: 1, ok: false, action: 'failed', field: 't' });
        // The code the write door gave for the same cell.
        expect([[summary.results[0].field, summary.results[0].code]], `import ${value}`).toEqual(doorCodes);
        expect(await engine.findOne(OBJECT, { where: { id: `rw${i}` } })).toBeNull();
        expect(await engine.findOne(OBJECT, { where: { id: `ri${i}` } })).toBeNull();
        expect(await stored(`rg${i}`), 'the sibling row is written').toBe('10:00:00');
      });

      it('dry run predicts the same verdicts and persists nothing', async () => {
        const rows = [
          ...ADMITTED.map(([value], i) => ({ id: `dA${i}`, t: value })),
          ...REFUSED.map((value, i) => ({ id: `dR${i}`, t: value })),
        ];
        const summary = await importBody({ format: 'json', dryRun: true, rows });
        expect(summary).toMatchObject({ dryRun: true, total: rows.length, ok: ADMITTED.length, errors: REFUSED.length });
        expect(summary.results.slice(ADMITTED.length).map((r: any) => [r.field, r.code])).toEqual(REFUSED.map(() => ['t', 'invalid_time']));
        for (const row of rows) expect(await engine.findOne(OBJECT, { where: { id: row.id } })).toBeNull();
      });

      it('reads the year-first date-time (#20534) as its wall clock, which the write door refuses', async () => {
        const created = await create({ id: 'yw', t: '2026/7/15 9:00' });
        expect(created._status).toBe(400);
        expect(created._json.fields.map((f: any) => [f.field, f.code])).toEqual([['t', 'invalid_time']]);
        const summary = await importBody({ format: 'json', rows: [{ id: 'yi', t: '2026/7/15 9:00' }] });
        expect(summary).toMatchObject({ total: 1, ok: 1, errors: 0 });
        expect(await stored('yi')).toBe('09:00:00');
      });

      describe.each(['csv', 'json'] as const)('GET /export then POST /import, format %s', (format) => {
        const SOURCE = [
          { id: `x-${format}-ms`, t: '10:00:00.250' },
          { id: `x-${format}-max`, t: '23:59:59.999' },
          { id: `x-${format}-control`, t: '10:00:00' },
        ];

        it('re-imports every exported row as the wall clock it was exported from', async () => {
          for (const row of SOURCE) {
            const created = await create(row);
            expect(created._status ?? 201, `create ${row.id}`).toBe(201);
          }
          const exported = await send('GET', '/api/v1/data/:object/export', { query: { format } });
          expect(exported._status ?? 200).toBe(200);

          const ids = new Set(SOURCE.map((r) => r.id));
          const back = (id: string) => id.replace(/^x-/, 'back-');
          let body: Record<string, unknown>;
          if (format === 'json') {
            const rows = (JSON.parse(exported._text()) as Array<Record<string, unknown>>).filter((r) => ids.has(String(r.id)));
            // The export writes each wall clock as stored, fraction included.
            expect(Object.fromEntries(rows.map((r) => [r.id, r.t]))).toEqual(Object.fromEntries(SOURCE.map((r) => [r.id, r.t])));
            body = { format, rows: rows.map((r) => ({ ...r, id: back(String(r.id)) })) };
          } else {
            const [header, ...lines] = exported._text().split('\r\n').filter((l: string) => l.length > 0);
            expect(header).toBe('ID,Clock');
            const mine = lines.filter((l: string) => ids.has(l.split(',')[0]));
            expect([...mine].sort()).toEqual(SOURCE.map((r) => `${r.id},${r.t}`).sort());
            body = { format, csv: [header, ...mine.map((l: string) => l.replace(/^x-/, 'back-'))].join('\r\n'), mapping: MAPPING };
          }

          const summary = await importBody(body);
          expect(summary, JSON.stringify(summary?.results)).toMatchObject({ total: SOURCE.length, ok: SOURCE.length, errors: 0 });
          for (const row of SOURCE) {
            expect(await stored(row.id), `source ${row.id}`).toBe(row.t);
            expect(await stored(back(row.id)), `re-imported ${row.id}`).toBe(row.t);
          }
        });
      });
    },
  );
}
