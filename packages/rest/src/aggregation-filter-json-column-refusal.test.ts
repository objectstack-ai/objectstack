// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21007] A per-aggregation `filter` REFUSES a scalar comparison on a declared
 * JSON-stored field the way its `where` twin does — same status, same code, same
 * WORDS — through the door a caller uses: `POST /api/v1/data/:object/query` →
 * `RestServer` → `ObjectStackProtocolImplementation.findData` →
 * `ObjectQL.aggregate` → a real `SqlDriver`. Each row runs beside its live
 * `where` twin, and the two response bodies' `error` must be the SAME string:
 * the twin's is `driver-sql`'s refusal, the per-aggregation one the engine's,
 * and both read `@objectstack/core`'s `jsonColumnOperatorRefusalText`. A change
 * to either face that is not a change to the shared text breaks the equality
 * here.
 *
 * Measured before this change (`origin/main` `d1f8ce865`), on SQLite and a live
 * PostgreSQL 16.14, on the six rows below: every `where` twin was 400
 * `INVALID_FILTER`, while the per-aggregation `filter` answered 200 — `owners
 * $in ['u1','u9']` m = 0, `owners $nin ['u1','u9']` m = 6 (the rows holding
 * `u1` counted), `owners $gt 'u1'` m = 4, `tags $eq 'red'` m = 1, `meta $eq 'a'`
 * m = 0 — identically on both dialects.
 *
 * The engine-level cell (the in-memory lowering over the read shape `find()`
 * presents) is `@objectstack/objectql`'s
 * `engine-aggregate-filter-json-column-refusal.test.ts`.
 *
 * [#21009] The text operators other than the membership pair joined the shared
 * set. Measured before (`origin/main` `7a606a9a3`) on the same table: `owners`
 * / `tags` `$startsWith` / `$endsWith` / `$icontains` — `where` answered the
 * serialization on SQLite (`$startsWith: '['` matched every row with a value)
 * and `500` `DATABASE_ERROR` on PostgreSQL 16.14; the per-aggregation `filter`
 * counted `m = 0` for each. Both faces now answer the `400` above.
 *
 * [#21067] And the body carries the WHOLE refusal. The withheld message was
 * 748 characters, so this door cut it to 499 plus an ellipsis, on SQLite and
 * PostgreSQL alike: the wire ended mid-reason, before the sentence saying the
 * field and the operator were withheld. It is now one text under the bound, and
 * each row asserts the body equals it, not merely that the two faces agree.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL and MySQL cells run where
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set and are a named skip
 * otherwise. ⚠️ No CI job provisions those variables for this package, so the
 * live cells are red-capable and un-run in CI; the PR that landed this file
 * carries their local PostgreSQL run. Each live cell owns its table, dropped
 * before and after.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { jsonColumnOperatorRefusalText } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_agg_filter_json_col_21007';

const DOC = {
  name: OBJECT,
  label: 'Doc 21007',
  fields: {
    title: { name: 'title', type: 'text' as const },
    owners: { name: 'owners', type: 'lookup' as const, reference: 'rest_agg_filter_user_21007', multiple: true },
    tags: { name: 'tags', type: 'tags' as const },
    meta: { name: 'meta', type: 'json' as const },
  },
};

const ROWS = [
  { id: 'd1', title: 'u1 memo', owners: ['u1', 'u2'], tags: ['red', 'blue'] },
  { id: 'd2', title: 'none', owners: ['u2'], tags: ['blue'] },
  { id: 'd3', title: 'about u10', owners: ['u3', 'u1'], tags: ['redwood'] },
  { id: 'd4', title: 'x', owners: [], tags: [] },
  { id: 'd5', title: 'u1', owners: ['u10'], tags: ['red'] },
  { id: 'd6', title: null, owners: null, tags: null },
];

const VALUES: Record<string, readonly [string, string]> = {
  owners: ['u1', 'u9'],
  tags: ['red', 'green'],
  meta: ['a', 'b'],
};

/**
 * [#21067] The withheld message every refusal below answers with: one constant
 * text (it names neither the field nor the operator), so any call reads it.
 * Read from the builder rather than copied, so a rewording moves it here too.
 */
const WITHHELD_MESSAGE = jsonColumnOperatorRefusalText('owners', '$in', false).message;

/** Every member of the family `where` refuses on a JSON column, as a filter on `field`. */
function family(field: string): Array<readonly [string, Record<string, unknown>]> {
  const [a, b] = VALUES[field];
  return [
    ['implicit equality', { [field]: a }],
    ['implicit equality with null', { [field]: null }],
    ['$eq', { [field]: { $eq: a } }],
    ['$eq null', { [field]: { $eq: null } }],
    ['$ne', { [field]: { $ne: a } }],
    ['$gt', { [field]: { $gt: a } }],
    ['$gte', { [field]: { $gte: a } }],
    ['$lt', { [field]: { $lt: a } }],
    ['$lte', { [field]: { $lte: a } }],
    ['$between', { [field]: { $between: [a, b] } }],
    ['$in (the card)', { [field]: { $in: [a, b] } }],
    ['$nin (the card)', { [field]: { $nin: [a, b] } }],
    ['$in []', { [field]: { $in: [] } }],
    ['$nin []', { [field]: { $nin: [] } }],
    ['$in under $not', { $not: { [field]: { $in: [a] } } }],
  ];
}

/**
 * [#21009] The text operators other than the membership pair, on a multi-valued
 * field. Before, `where` answered the SERIALIZATION on SQLite (`$startsWith: '['`
 * matched every row with a value) and a 500 `DATABASE_ERROR` on PostgreSQL, while
 * the per-aggregation `filter` counted `m = 0` for each — three answers to one
 * filter, none of them the caller's.
 */
function textFamily(field: 'owners' | 'tags'): Array<readonly [string, Record<string, unknown>]> {
  const [a] = VALUES[field];
  return [
    ['$startsWith', { [field]: { $startsWith: a } }],
    ['$startsWith on the serialization', { [field]: { $startsWith: '[' } }],
    ['$endsWith', { [field]: { $endsWith: ']' } }],
    ['$icontains', { [field]: { $icontains: a.toUpperCase() } }],
  ];
}

/** [#21009] The same text operators on the scalar `title` column: unaffected. */
const TEXT_CONTROLS: ReadonlyArray<readonly [string, Record<string, unknown>, number]> = [
  ['title $startsWith', { title: { $startsWith: 'u1' } }, 2],
  ['title $endsWith', { title: { $endsWith: 'u10' } }, 1],
  ['title $icontains', { title: { $icontains: 'U1' } }, 3],
];

/** Controls on the scalar `title` column: the per-aggregation count equals the where twin's. */
const CONTROLS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['title $in', { title: { $in: ['u1', 'x'] } }],
  ['title $nin', { title: { $nin: ['u1', 'x'] } }],
  ['title $eq', { title: { $eq: 'x' } }],
  ['title implicit equality', { title: 'x' }],
  ['owners $contains — the prescribed spelling', { owners: { $contains: 'u1' } }],
  ['owners an $or of $contains — the any-of spelling', { $or: [{ owners: { $contains: 'u1' } }, { owners: { $contains: 'u3' } }] }],
  // [#21067] The presence spellings the refusal prescribes for a `null` comparand answer too.
  ['owners $null — the no-value spelling', { owners: { $null: true } }],
  ['owners $empty — the no-value spelling that counts an empty list', { owners: { $empty: true } }],
  ['owners $null: false — the has-a-value spelling', { owners: { $null: false } }],
];

interface Cell {
  id: 'sqlite' | 'pg' | 'mysql';
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
  {
    id: 'mysql',
    label: 'live mysql',
    env: 'OS_TEST_MYSQL_URL',
    config: () => (process.env.OS_TEST_MYSQL_URL ? { client: 'mysql2', connection: process.env.OS_TEST_MYSQL_URL } : null),
  },
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

const perAggregation = (filter: unknown) => ({
  aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter }],
});
const whereTwin = (filter: unknown) => ({ where: filter, aggregations: [{ function: 'count', alias: 'n' }] });

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21007] POST /data/:object/query — a per-aggregation filter refuses a scalar comparison on a JSON-stored field as its where twin does — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      let warn: ReturnType<typeof vi.spyOn>;
      let post: (body: Record<string, unknown>) => Promise<{ status: number; json: any }>;

      const dropTables = async () => {
        if (cell.id === 'sqlite') return;
        await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      const boot = async (populated: boolean) => {
        if (engine) await engine.destroy().catch(() => {});
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(DOC as any);
        await engine.syncSchemas();
        if (populated) for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);
        warn = vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
        expect(route).toBeDefined();
        post = async (body) => {
          const res = makeRes();
          await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)) } as any, res);
          return { status: res._status ?? 200, json: res._json };
        };
      };

      beforeAll(async () => { await boot(true); }, 60_000);
      afterAll(async () => {
        await dropTables();
        await engine?.destroy().catch(() => {});
      }, 60_000);

      for (const field of ['owners', 'tags', 'meta']) {
        for (const [name, filter] of family(field)) {
          it(`${field} ${name}: 400 INVALID_FILTER, the where twin's very body`, async () => {
            const twin = await post(whereTwin(filter));
            expect(twin.status, 'where twin').toBe(400);
            expect(twin.json.code).toBe('INVALID_FILTER');
            warn.mockClear();
            const agg = await post(perAggregation(filter));
            expect(agg.status, JSON.stringify(agg.json)).toBe(400);
            expect(agg.json.code).toBe('INVALID_FILTER');
            // The same words — byte for byte.
            expect(agg.json.error).toBe(twin.json.error);
            // [#21067] …and every one of them: the envelope cuts a 4xx message at
            // its bound, so equal to what the refusal wrote means nothing was cut,
            // the any-of remedy and the "withheld" sentence included.
            expect(twin.json.error).toBe(WITHHELD_MESSAGE);
            expect(agg.json.error).toContain('{ "FIELD": { "$contains": "a" } }');
            expect(agg.json.error).toContain('{ "$or": [{ "FIELD": { "$contains": "a" } }, { "FIELD": { "$contains": "b" } }] }');
            // The no-value spelling a null comparand needs, in two pieces: this file
            // is in `check:live-db-isolation`'s scan, which reads a MySQL USE
            // statement in the verb followed by a quoted operand.
            expect(agg.json.error).toContain('For no value,');
            expect(agg.json.error).toContain('"$null" or "$empty".');
            expect(agg.json.error).toContain('withheld from the message; the full diagnostic is in the server log.');
            expect(agg.json.error).not.toContain(`"${field}"`);
            // The field and the operator are in the server log, not the response.
            const logged = warn.mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
            expect(logged).toContain('INVALID_FILTER — refusal detail withheld from the response');
            expect(logged).toMatch(new RegExp(`(Operator "\\$[a-z]+" on field "${field}"|The bare equality spelling \\{ "${field}": value \\}) WAS NOT APPLIED`));
          }, 60_000);
        }
      }

      for (const [name, filter] of CONTROLS) {
        it(`control — ${name}: the per-aggregation count is the where twin's`, async () => {
          const twin = await post(whereTwin(filter));
          expect(twin.status, JSON.stringify(twin.json)).toBe(200);
          const agg = await post(perAggregation(filter));
          expect(agg.status, JSON.stringify(agg.json)).toBe(200);
          expect(agg.json.records).toEqual([{ n: 6, m: twin.json.records[0].n }]);
        }, 60_000);
      }

      for (const field of ['owners', 'tags'] as const) {
        for (const [name, filter] of textFamily(field)) {
          it(`[#21009] ${field} ${name}: 400 INVALID_FILTER on both faces, the where twin's very body`, async () => {
            const twin = await post(whereTwin(filter));
            expect(twin.status, JSON.stringify(twin.json)).toBe(400);
            expect(twin.json.code).toBe('INVALID_FILTER');
            warn.mockClear();
            const agg = await post(perAggregation(filter));
            expect(agg.status, JSON.stringify(agg.json)).toBe(400);
            expect(agg.json.code).toBe('INVALID_FILTER');
            expect(agg.json.error).toBe(twin.json.error);
            expect(twin.json.error).toBe(WITHHELD_MESSAGE);
            expect(agg.json.error).toContain('{ "FIELD": { "$contains": "a" } }');
            expect(agg.json.error).not.toContain(`"${field}"`);
            const logged = warn.mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
            expect(logged).toMatch(new RegExp(`Operator "\\$[A-Za-z]+" on field "${field}" WAS NOT APPLIED`));
          }, 60_000);
        }

        it(`[#21009] ${field} $like: where refuses it as a JSON column, the per-aggregation filter as an operator it does not evaluate`, async () => {
          const filter = { [field]: { $like: '%u1%' } };
          const twin = await post(whereTwin(filter));
          expect(twin.status, JSON.stringify(twin.json)).toBe(400);
          expect(twin.json.code).toBe('INVALID_FILTER');
          expect(twin.json.error).toContain('WAS NOT APPLIED');
          const agg = await post(perAggregation(filter));
          expect(agg.status, JSON.stringify(agg.json)).toBe(400);
          expect(agg.json.code).toBe('INVALID_FILTER');
          expect(agg.json.error).toContain("Unsupported operator '$like'");
        }, 60_000);
      }

      for (const [name, filter, m] of TEXT_CONTROLS) {
        it(`[#21009] control — ${name}: answered on both faces, m = ${m}`, async () => {
          const twin = await post(whereTwin(filter));
          expect(twin.status, JSON.stringify(twin.json)).toBe(200);
          expect(twin.json.records).toEqual([{ n: m }]);
          const agg = await post(perAggregation(filter));
          expect(agg.status, JSON.stringify(agg.json)).toBe(200);
          expect(agg.json.records).toEqual([{ n: 6, m }]);
        }, 60_000);
      }

      it('an empty table refuses the card too — the verdict is the filter\'s', async () => {
        await boot(false);
        for (const filter of [{ owners: { $in: ['u1', 'u9'] } }, { owners: { $nin: ['u1', 'u9'] } }]) {
          const twin = await post(whereTwin(filter));
          const agg = await post(perAggregation(filter));
          expect(twin.status).toBe(400);
          expect(agg.status).toBe(400);
          expect(agg.json.code).toBe('INVALID_FILTER');
          expect(agg.json.error).toBe(twin.json.error);
        }
      }, 60_000);
    },
  );
}
