// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20981] A per-aggregation `filter` and a `having` evaluated by
 * `ObjectQL.aggregate` over a real `SqlDriver` on SQLite REFUSE a non-boolean
 * `$exists` / `$null` the way their `where` twin does — `INVALID_FILTER` / 400,
 * in `driver-sql`'s words — and `true` / `false` select what the twin selects.
 *
 * Measured before this change (`origin/main` `7a606a9a3`) through
 * `engine.aggregate` on driver-sql (better-sqlite3) and driver-memory, over the
 * three rows below: every `where` twin was refused, while the per-aggregation
 * `filter` summed the VALUED row for `$exists` `"yes"` / `1` / `"false"`, the
 * no-value rows for `0` / `null`, and EVERY row for any non-boolean `$null`;
 * `having` kept the matching groups the same way (both groups under `$null`).
 * The engine evaluates both clauses itself, so the driver did not enter into
 * it. The engine-level cell — both `having` paths, every position, the
 * published row evaluators — is `@objectstack/objectql`'s
 * `engine-aggregate-flag-comparand-refusal.test.ts`.
 *
 * ## Why the refusal cases call the engine, not the route
 *
 * `POST /api/v1/data/:object/query` never reached the defect: the route parses
 * the request against the spec's query schema first, and that parse already
 * refuses a non-boolean flag in `where`, in `aggregations[i].filter` and in
 * `having` (400 `VALIDATION_FAILED`, measured on the same base, before and
 * after this change). The engine's refusal is the floor for every caller that
 * reaches `engine.aggregate` without that parse — server-side code, and the
 * analytics bridge that lowers a measure's `filter` into an aggregation filter.
 * So the refusal cases run on `engine.aggregate`; the route is asked only to
 * show where its own parse stands and to carry the `true` / `false` control end
 * to end.
 *
 * ## The words
 *
 * The engine's refusal is `driver-sql`'s own diagnostic for the same flag, with
 * its "this driver" clause re-aimed at the backend it names and its location
 * re-rooted at the clause — one condition, one wording, copied rather than
 * imported because the engine cannot depend on a driver. This file is where the
 * copy is held to its source: each case reads the `where` twin's withheld
 * diagnostic off the thrown error (`withheldFilterDiagnosticOf`) and requires
 * the engine's message to equal it under exactly those two edits. `driver-sql`
 * withholds that diagnostic from a `where` response because a `where` can carry
 * a merged read scope; a per-aggregation `filter` and a `having` never do, so
 * the engine's message names the field and the value, as its `$empty` and
 * `$icontains` refusals do.
 *
 * SQLite only, deliberately: the refusal precedes every driver read, so no
 * dialect can answer it differently, and the `where` twin's wording is
 * `driver-sql`'s on every dialect.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { EngineAggregateOptions, EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver, withheldFilterDiagnosticOf } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_agg_flag_comparand_20981';

const DOC = {
  name: OBJECT,
  label: 'Deal 20981',
  fields: {
    name: { name: 'name', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};

// `a` holds a value; `b` and `c` hold none.
const ROWS = [
  { id: 'a', name: 'won', amount: 10 },
  { id: 'b', name: null, amount: 1 },
  { id: 'c', amount: 100 },
];

const OPS = ['$exists', '$null'] as const;

const NON_BOOLEANS: ReadonlyArray<readonly [string, unknown]> = [
  ['"yes"', 'yes'],
  ['1', 1],
  ['"false"', 'false'],
  ['0', 0],
  ['null', null],
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
  aggregations: [{ function: 'count', alias: 'n' }, { function: 'sum', field: 'amount', alias: 's', filter }],
});
const grouped = (having: unknown) => ({ groupBy: ['name'], aggregations: [{ function: 'count', alias: 'n' }], having });
const whereSum = (where: unknown) => ({ where, aggregations: [{ function: 'count', alias: 'n' }, { function: 'sum', field: 'amount', alias: 's' }] });
const whereGrouped = (where: unknown) => ({ where, groupBy: ['name'], aggregations: [{ function: 'count', alias: 'n' }] });

describe('[#20981] a non-boolean $exists / $null in a per-aggregation filter or a having is refused as its where twin is — SqlDriver on sqlite', () => {
  let engine: ObjectQL;
  let post: (body: Record<string, unknown>) => Promise<{ status: number; json: any }>;

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL();
    engine.registerDriver(driver as any, true);
    await engine.init();
    engine.registry.registerObject(DOC as any);
    await engine.syncSchemas();
    for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);
    vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

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
  }, 60_000);

  afterAll(async () => {
    await engine?.destroy().catch(() => {});
  }, 60_000);

  /** The `where` twin's refusal, thrown by `driver-sql`, and the diagnostic it keeps server-side. */
  async function whereTwinDiagnostic(op: string, comparand: unknown): Promise<string> {
    try {
      // Deliberately off-contract: the flag is not a boolean.
      await engine.find(OBJECT, { where: { name: { [op]: comparand } } } as unknown as EngineQueryOptions);
    } catch (err) {
      expect((err as { code?: string }).code).toBe('INVALID_FILTER');
      const diagnostic = withheldFilterDiagnosticOf(err);
      expect(diagnostic, 'driver-sql keeps the full diagnostic on the thrown error').toEqual(expect.any(String));
      return diagnostic!;
    }
    throw new Error(`expected the where twin of ${op} to be refused`);
  }

  /** The engine's full message, thrown before any row is read. */
  async function engineRefusal(body: Record<string, unknown>): Promise<Error & { code?: string; status?: number }> {
    try {
      // Deliberately off-contract: the flag is not a boolean.
      await engine.aggregate(OBJECT, body as unknown as EngineAggregateOptions);
    } catch (err) {
      return err as Error & { code?: string; status?: number };
    }
    throw new Error('expected engine.aggregate to refuse this clause');
  }

  for (const op of OPS) {
    for (const [label, comparand] of NON_BOOLEANS) {
      it(`${op}: ${label} — engine.aggregate refuses it in the filter and in having, in the where twin's words`, async () => {
        const diagnostic = await whereTwinDiagnostic(op, comparand);
        const twinAt = diagnostic.match(/ at (\S+)\. @objectstack/)?.[1];
        expect(twinAt, diagnostic).toBe(`filter.name.${op}`);

        for (const [body, at] of [
          [perAggregation({ name: { [op]: comparand } }), `aggregations[1].filter.name.${op}`],
          [grouped({ name: { [op]: comparand } }), `having.name.${op}`],
        ] as const) {
          // The copy, held to its source: driver-sql's diagnostic, re-rooted at
          // the clause and with "this driver" re-aimed at driver-sql.
          const err = await engineRefusal(body);
          expect(err.code).toBe('INVALID_FILTER');
          expect(err.status).toBe(400);
          expect(err.message).toBe(
            diagnostic.trim().replace(` at ${twinAt}. `, ` at ${at}. `).replaceAll('this driver', 'driver-sql'),
          );
          expect(err.message).toContain(`Operator "${op}" on field "name" requires a boolean comparand (true or false).`);
        }
      }, 60_000);
    }
  }

  it('the route refuses all three positions in its own schema parse first — 400 VALIDATION_FAILED, unchanged here', async () => {
    for (const [body, field] of [
      [whereSum({ name: { $exists: 'yes' } }), 'query.where.name.$exists'],
      [perAggregation({ name: { $exists: 'yes' } }), 'query.aggregations.1.filter.name.$exists'],
      [grouped({ name: { $null: 1 } }), 'query.having.name.$null'],
    ] as const) {
      const res = await post(body);
      expect(res.status, JSON.stringify(res.json)).toBe(400);
      expect(res.json.code).toBe('VALIDATION_FAILED');
      expect(res.json.fields.map((f: { field: string }) => f.field)).toEqual([field]);
    }
  }, 60_000);

  // The control: a boolean flag answers, and the filter and having select the
  // rows and groups their where twin does.
  for (const op of OPS) {
    for (const flag of [true, false]) {
      it(`control — ${op}: ${flag} sums and groups as its where twin does`, async () => {
        const twin = await post(whereSum({ name: { [op]: flag } }));
        expect(twin.status, JSON.stringify(twin.json)).toBe(200);
        const agg = await post(perAggregation({ name: { [op]: flag } }));
        expect(agg.status, JSON.stringify(agg.json)).toBe(200);
        expect(agg.json.records).toEqual([{ n: 3, s: twin.json.records[0].s }]);

        const twinGroups = await post(whereGrouped({ name: { [op]: flag } }));
        const having = await post(grouped({ name: { [op]: flag } }));
        expect(having.status, JSON.stringify(having.json)).toBe(200);
        expect(having.json.records).toEqual(twinGroups.json.records);
        expect(having.json.records).toHaveLength(1);
      }, 60_000);
    }
  }
});
