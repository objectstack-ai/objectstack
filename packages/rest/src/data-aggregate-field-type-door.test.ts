// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20914] At the public door — `POST /api/v1/data/:object/query` over a real
 * `SqlDriver` — an aggregation whose (function, declared field type) pair the
 * aggregate × field-type table refuses answers `400 INVALID_FIELD` in the
 * engine's words, naming the position, the function, the field, its
 * declaration and the types the function accepts, before any read; and the
 * pairs the table accepts are served by the driver unchanged.
 *
 * Measured on the base (`origin/main` `dfe5a0863`) through `engine.aggregate`:
 *
 * | query | InMemoryDriver | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `max` / `min` over a `json` field | 200, a document | 200, a string | 500 `DATABASE_ERROR` (`function max(json) does not exist`) |
 * | `max` / `min` over a `tags` field, a `select` or `lookup` with `multiple: true` | 200, an array | 200, a serialized array | 500 `DATABASE_ERROR` |
 * | `avg` over a `datetime` field | 200, `null` | 200, `2026` | 500 `DATABASE_ERROR` |
 * | `max` over a `number`, `min` over a `datetime`, `avg` over a `percent`, `max` over a `boolean` (the controls) | one answer | the same | the same |
 *
 * …and the `sum` row, which one landing held back for triage's census answer
 * and the next released, measured on `origin/main` `2821e9f15`:
 *
 * | query | InMemoryDriver | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `sum` over a `json`, `text`, `select` or `tags` field | 200, `0` | 200, `0` | 500 `DATABASE_ERROR` (`function sum(json) does not exist`, `sum(text)`, `sum(character varying)`) |
 * | `sum` over a `formula` field | 200, `0` | 400 `INVALID_FIELD`, the driver's words (no column) | the same |
 * | `sum` over a `number`, `currency` or `boolean` (the controls) | one answer | the same | the same |
 *
 * The refusals sit in the engine, in front of every driver, so one verdict
 * holds on each cell. InMemoryDriver's row is `@objectstack/objectql`'s
 * `engine-aggregate-field-type-door.test.ts` by construction (the door answers
 * before a driver is resolved); this package does not depend on the in-memory
 * driver, and that driver's test consumers are a ruled, closed census
 * (`check:driver-memory-census`).
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL and MySQL cells run where
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set and are a named skip
 * otherwise. ⚠️ No CI job provisions those variables for this package, so the
 * live cells are red-capable and un-run in CI; the PR that landed this file
 * carries their local PostgreSQL run. Each live cell owns its tables, dropped
 * before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_aggregate_type_20914';
const TARGET = 'rest_aggregate_type_target_20914';

const OPTIONS = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }];

const LEDGER = {
  name: OBJECT,
  label: 'Ledger 20914',
  fields: {
    title: { name: 'title', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    price: { name: 'price', type: 'currency' as const },
    pct: { name: 'pct', type: 'percent' as const },
    due: { name: 'due', type: 'datetime' as const },
    flag: { name: 'flag', type: 'boolean' as const },
    status: { name: 'status', type: 'select' as const, options: OPTIONS },
    meta: { name: 'meta', type: 'json' as const },
    labels: { name: 'labels', type: 'tags' as const },
    picks: { name: 'picks', type: 'select' as const, multiple: true, options: OPTIONS },
    owners: { name: 'owners', type: 'lookup' as const, multiple: true, reference: TARGET },
    expected: { name: 'expected', type: 'formula' as const, expression: 'record.amount * 2' },
  },
};

const TARGET_OBJECT = { name: TARGET, label: 'Target 20914', fields: { name: { name: 'name', type: 'text' as const } } };

const ROWS = [
  { id: 'd1', title: 'x', amount: 1, price: 10, pct: 10, due: '2026-01-01T00:00:00.000Z', flag: true, status: 'a', meta: { a: 1 }, labels: ['p', 'q'], picks: ['a'], owners: ['t1'] },
  { id: 'd2', title: 'x', amount: 2, price: 20, pct: 20, due: '2026-02-01T00:00:00.000Z', flag: false, status: 'b', meta: { b: 1 }, labels: ['p'], picks: ['a', 'b'], owners: ['t1', 't2'] },
  { id: 'd3', title: 'y', amount: 3, price: 30, pct: 30, due: '2026-03-01T00:00:00.000Z', flag: true, status: 'a', meta: { a: 2 }, labels: ['q'], picks: ['b'], owners: ['t2'] },
];

const agg = (fn: string, field: string, alias = 'v'): EngineAggregateOptions['aggregations'] =>
  [{ function: fn, field, alias }] as EngineAggregateOptions['aggregations'];

/** The route the refusal names for min / max — asserted on the REST body, so it must land inside the door's 500-character bound. */
const MIN_MAX_ROUTE = 'accepts a field of type number, currency, percent, rating, slider, progress, summary, '
  + 'date, datetime, time, boolean or toggle: aggregate a field of one of those types, or count the rows with count.';

/** The route the refusal names for sum, read off the table's `sum` row — inside the same 500-character bound. */
const SUM_ROUTE = 'sum accepts a field of type number, currency, rating, slider, progress, summary, boolean or toggle: '
  + 'aggregate a field of one of those types, or count the rows with count.';

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

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#20914] an aggregation the aggregate × field-type table refuses, at the public door — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      const reads = { n: 0 };
      let query: (body: Record<string, unknown>) => Promise<{ status: number; body: any }>;

      const dropTables = async () => {
        if (cell.id === 'sqlite') return;
        for (const t of [OBJECT, TARGET]) await driver?.execute(`drop table if exists ${t}`).catch(() => {});
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(TARGET_OBJECT as any);
        engine.registry.registerObject(LEDGER as any);
        await engine.syncSchemas();
        for (const id of ['t1', 't2']) await engine.insert(TARGET, { id, name: id } as any);
        for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

        // Reads of THIS object — the protocol's own metadata traffic is not the question.
        for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
          const real = driver[verb].bind(driver);
          driver[verb] = (o: string, ...rest: unknown[]) => { if (o === OBJECT) reads.n += 1; return real(o, ...rest); };
        }

        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
        expect(route).toBeDefined();
        query = async (body) => {
          const res = makeRes();
          // What the wire carries: JSON.
          await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)), query: {}, headers: {} } as any, res);
          return { status: res._status ?? 200, body: res._json };
        };
      });

      afterAll(async () => {
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('max / min over a json field, a tags field and a select or lookup with multiple: true answer 400 INVALID_FIELD in the engine\'s words, naming the function, the field, its declaration and the accepted types — no read', async () => {
        const before = reads.n;
        const cases: ReadonlyArray<readonly ['min' | 'max', string, string]> = [
          ['max', 'meta', 'json field — a structured-JSON value'],
          ['min', 'meta', 'json field — a structured-JSON value'],
          ['max', 'labels', 'tags field — a multi-value field'],
          ['min', 'labels', 'tags field — a multi-value field'],
          ['max', 'picks', 'select field with multiple: true — a multi-value field'],
          ['max', 'owners', 'lookup field with multiple: true — a multi-value field'],
        ];
        for (const [fn, field, declared] of cases) {
          const label = `${fn}(${field})`;
          const res = await query({ aggregations: agg(fn, field) });
          expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
          expect(res.body.code, label).toBe('INVALID_FIELD');
          expect(res.body.error, label).toContain(
            `aggregations[0].field takes the ${fn} of '${field}', a declared ${declared}, which the engine does not take the ${fn} of. The query was NOT run.`,
          );
          expect(res.body.error, label).toContain(`${fn} ${MIN_MAX_ROUTE}`);
          const err = await engine.aggregate(OBJECT, { aggregations: agg(fn, field) }).then(() => null, (e: any) => e);
          expect({ code: err?.code, status: err?.status }, `engine.aggregate, ${label}`).toEqual({ code: 'INVALID_FIELD', status: 400 });
        }
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('max over a multi-valued lookup under groupBy title, and avg over a datetime, answer 400 INVALID_FIELD at aggregations[0].field — no read', async () => {
        const before = reads.n;
        const grouped = await query({ groupBy: ['title'], aggregations: agg('max', 'owners', 'm') });
        expect(grouped.status, JSON.stringify(grouped.body)).toBe(400);
        expect(grouped.body.code).toBe('INVALID_FIELD');
        expect(grouped.body.error).toContain("aggregations[0].field takes the max of 'owners', a declared lookup field with multiple: true — a multi-value field");
        const averaged = await query({ aggregations: agg('avg', 'due') });
        expect(averaged.status, JSON.stringify(averaged.body)).toBe(400);
        expect(averaged.body.code).toBe('INVALID_FIELD');
        expect(averaged.body.error).toContain("aggregations[0].field averages 'due', a declared datetime field, which the engine does not average. The query was NOT run.");
        expect(averaged.body.error).toContain('avg accepts a field of type number, currency, percent, rating, slider, progress, summary, boolean or toggle');
        expect(reads.n - before, 'no read of the object').toBe(0);
      });

      it('sum over a json, text, select, tags and formula field answers 400 INVALID_FIELD in the engine\'s words, naming the types sum accepts — no read', async () => {
        // The row one landing held for the census, released: these pairs
        // reached the driver then (0 on SQLite, a 500 on PostgreSQL; a formula
        // the driver's own "no column" 400).
        const before = reads.n;
        const cases: ReadonlyArray<readonly [string, string]> = [
          ['meta', 'json field — a structured-JSON value'],
          ['title', 'text field'],
          ['status', 'select field'],
          ['labels', 'tags field — a multi-value field'],
          ['expected', 'formula field'],
        ];
        for (const [field, declared] of cases) {
          const label = `sum(${field})`;
          const res = await query({ aggregations: agg('sum', field) });
          expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
          expect(res.body.code, label).toBe('INVALID_FIELD');
          expect(res.body.error, label).toContain(
            `aggregations[0].field sums '${field}', a declared ${declared}, which the engine does not sum. The query was NOT run.`,
          );
          expect(res.body.error, label).toContain(SUM_ROUTE);
          const err = await engine.aggregate(OBJECT, { aggregations: agg('sum', field) }).then(() => null, (e: any) => e);
          expect({ code: err?.code, status: err?.status }, `engine.aggregate, ${label}`).toEqual({ code: 'INVALID_FIELD', status: 400 });
        }
        expect(reads.n - before, 'no read of the object — every refusal precedes the driver').toBe(0);
      });

      it('CONTROL a pair the table accepts is served unchanged, from the driver', async () => {
        const before = reads.n;
        const answers: Record<string, unknown> = {};
        const shapes: ReadonlyArray<readonly [string, string, string]> = [
          ['max', 'amount', 'max amount'],
          ['avg', 'pct', 'avg pct'],
          ['sum', 'amount', 'sum amount'],
          ['sum', 'price', 'sum price'],
          ['sum', 'flag', 'sum flag'],
          ['max', 'flag', 'max flag'],
          ['min', 'due', 'min due'],
        ];
        for (const [fn, field, label] of shapes) {
          const res = await query({ aggregations: agg(fn, field) });
          expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(200);
          answers[label] = res.body.records[0].v;
        }
        expect({
          'max amount': Number(answers['max amount']),
          'avg pct': Number(answers['avg pct']),
          'sum amount': Number(answers['sum amount']),
          'sum price': Number(answers['sum price']),
          'sum flag': Number(answers['sum flag']),
          'max flag': Number(answers['max flag']),
        }).toEqual({ 'max amount': 3, 'avg pct': 20, 'sum amount': 6, 'sum price': 60, 'sum flag': 2, 'max flag': 1 });
        expect(new Date(answers['min due'] as string).toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect(reads.n - before, 'the driver was asked, once per query').toBe(shapes.length);
      });
    },
  );
}
