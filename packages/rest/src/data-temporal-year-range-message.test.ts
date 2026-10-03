// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20846] A `date` or `datetime` value refused for its YEAR is refused in
 * words that name the kind's years, at the public write doors — not with
 * "must be a valid datetime (ISO-8601)", which is false for a readable ISO 8601
 * value such as `0500-07-15T10:00:00Z` and sent its author to rewrite a
 * spelling when no spelling of that year is admitted.
 *
 * Two doors, over a real `SqlDriver` on SQLite:
 *
 * - `POST /api/v1/data/:object` — `400 VALIDATION_FAILED`, the field's code
 *   `invalid_date` and its `constraint` `{ type }` exactly as before; only the
 *   sentence moves;
 * - `POST /api/v1/data/:object/import` — each refused row carries the same
 *   code and the same sentence, whichever reader refused it: the import's cell
 *   reader for a cell with more than four year digits (`+010000-01-01`, no
 *   shape it takes), the write door behind it for a cell it takes
 *   (`0500-07-15T10:00:00Z`, `0000-06-15`).
 *
 * The CONTROL is a malformed value, which keeps its sentence at each door —
 * "must be a valid datetime (ISO-8601)" at the write door, the import's own
 * `"…" is not a valid datetime` for a cell — beside the years' edges, which
 * are written.
 *
 * Measured with this change's two selections ablated, which leaves the
 * sentence keys of the base (`bee75cebe`) and their unchanged templates: every
 * refused value below answered with its ISO sentence ("Opened must be a valid
 * datetime (ISO-8601)", "Placed must be a valid date (ISO-8601)"), at the write
 * door and on an import row it refused, and the import's reader refused the
 * cell `+010000-01-01` as `"+010000-01-01" is not a valid date`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';

const OBJECT = 'rest_year_message_20846';

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20846',
  systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    placed_on: { name: 'placed_on', type: 'date' as const, label: 'Placed' },
    opened_at: { name: 'opened_at', type: 'datetime' as const, label: 'Opened' },
  },
};

const DATE_RANGE = 'Placed must be a date in the years 0001 to 9999';
const DATETIME_RANGE = 'Opened must be a datetime whose UTC year falls in the years 1000 to 9999';

/** field · written value · the refusal's sentence */
const WRITE_REFUSED: ReadonlyArray<readonly [string, string, string]> = [
  ['opened_at', '0500-07-15T10:00:00Z', DATETIME_RANGE],
  ['opened_at', '0999-12-31T23:59:59.999Z', DATETIME_RANGE],
  ['opened_at', '9999-12-31T23:59:59-01:00', DATETIME_RANGE],
  ['opened_at', '+010000-01-01T00:00:00.000Z', DATETIME_RANGE],
  ['placed_on', '+010000-01-01', DATE_RANGE],
  ['placed_on', '+010000-01-01T00:00:00.000Z', DATE_RANGE],
  ['placed_on', '0000-06-15', DATE_RANGE],
  // CONTROL: malformed — the ISO sentence stays.
  ['opened_at', 'not-a-date', 'Opened must be a valid datetime (ISO-8601)'],
  ['opened_at', '2026-02-30T10:00:00Z', 'Opened must be a valid datetime (ISO-8601)'],
  ['placed_on', 'not-a-date', 'Placed must be a valid date (ISO-8601)'],
];

/** One import row per cell: id · placed_on · opened_at · the row's sentence, or null when it is stored. */
const IMPORT_ROWS: ReadonlyArray<readonly [string, string, string, string | null]> = [
  ['r1', '', '0500-07-15T10:00:00Z', DATETIME_RANGE],
  ['r2', '+010000-01-01', '', DATE_RANGE],
  ['r3', '0000-06-15', '', DATE_RANGE],
  // CONTROL: malformed — the import's own sentence stays.
  ['r4', '', 'not-a-date', 'Opened: "not-a-date" is not a valid datetime'],
  ['r5', 'not-a-date', '', 'Placed: "not-a-date" is not a valid date'],
  // CONTROL: the years' edges are stored.
  ['r6', '0001-01-01', '1000-01-01T00:00:00Z', null],
  ['r7', '9999-12-31', '9999-12-31T23:59:59Z', null],
];

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

describe('[#20846] a date / datetime refused for its year names the years — POST /data/:object and an import row', () => {
  let engine: ObjectQL;
  let call: (method: string, path: string, body: unknown) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any), true);
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
    call = async (method, path, body) => {
      const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
      expect(route, `${method} ${path}`).toBeDefined();
      const res = makeRes();
      await route!.handler({ params: { object: OBJECT }, body, query: {}, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it.each(WRITE_REFUSED)('POST %s = %j → 400 VALIDATION_FAILED, invalid_date, { type }, and the sentence', async (field, value, sentence) => {
    const res = await call('POST', '/api/v1/data/:object', { id: `w-${field}`, [field]: value });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.body.fields).toHaveLength(1);
    const [finding] = res.body.fields;
    expect(finding).toMatchObject({ field, code: 'invalid_date' });
    expect(finding.constraint).toEqual({ type: LEDGER.fields[field as keyof typeof LEDGER.fields].type });
    expect(finding.message).toBe(sentence);
    // The envelope's human `error` — what a toast or the CLI shows — leads with the field's sentence.
    expect(String(res.body.error).split('; ')[0]).toBe(sentence);
    expect(await engine.findOne(OBJECT, { where: { id: `w-${field}` } })).toBeNull();
  });

  it('an import row gets the same code and sentence, whichever reader refused it — and the edges are stored', async () => {
    const csv = ['ID,Placed,Opened', ...IMPORT_ROWS.map(([id, day, at]) => `${id},${day},${at}`)].join('\r\n');
    const res = await call('POST', '/api/v1/data/:object/import', {
      format: 'csv', csv, mapping: { ID: 'id', Placed: 'placed_on', Opened: 'opened_at' }, writeMode: 'insert',
    });
    expect(res.status ?? 200, JSON.stringify(res.body)).toBe(200);
    const refused = IMPORT_ROWS.filter((r) => r[3] !== null);
    expect(res.body).toMatchObject({ total: IMPORT_ROWS.length, ok: IMPORT_ROWS.length - refused.length, errors: refused.length });
    for (const [i, [id, day, , sentence]] of IMPORT_ROWS.entries()) {
      const row = res.body.results[i];
      if (sentence === null) {
        expect(row, id).toMatchObject({ ok: true });
        expect(await engine.findOne(OBJECT, { where: { id } }), id).not.toBeNull();
        continue;
      }
      expect(row, id).toMatchObject({ ok: false, action: 'failed', code: 'invalid_date', field: day ? 'placed_on' : 'opened_at' });
      expect(row.error, id).toBe(sentence);
      expect(await engine.findOne(OBJECT, { where: { id } }), id).toBeNull();
    }
  });
});
