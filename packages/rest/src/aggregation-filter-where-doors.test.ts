// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20148] A per-aggregation `filter` meets the doors `where` meets, through
 * the door a caller actually uses: `POST /api/v1/data/:object/query` →
 * `RestServer` → `ObjectStackProtocolImplementation.findData` →
 * `ObjectQL.aggregate` → a real sqlite `SqlDriver` (the harness
 * `list-view-grouping-query-door.test.ts` boots).
 *
 * Measured on the base through this door, on driver-sql and driver-memory
 * alike: each shape below answered `200` with the filtered count `0` on a
 * populated table (every row under a negation, a `$not`, or a `$or` branch
 * that held), while the same condition as the call's `where` — the TWIN every
 * row runs beside it — was refused `400`. Now both refuse, on an empty table
 * as on a populated one, and the per-aggregation refusal is raised before the
 * driver is asked for a row.
 *
 * | row | per-aggregation `filter` | the `where` twin |
 * |:--|:--|:--|
 * | 1 | a date no temporal field can read | `INVALID_FILTER` (the engine's temporal door) |
 * | 2 | `addDays` between two numeric fields | `INVALID_FILTER` (driver-sql's cross-field compiler) |
 * | 3 | a `{ $field }` naming no declared field | `INVALID_FILTER` (driver-sql's cross-field compiler) |
 * | 4 | a key naming no field | `INVALID_FIELD` (the read door's field gate) |
 *
 * Row 5 — a `Date` bound — has no reach through this door: JSON carries it as
 * its ISO text, which answered correctly before. The last block pins that
 * spelling against its twin, as the control the engine-level `Date` pins
 * (`packages/objectql`, `engine-aggregate-filter.test.ts`) are measured to.
 *
 * [#21255] A plain `{ $field }` across two comparison classes — `closed_at`
 * (datetime) against `due_on` (date) — is refused at both of this verb's
 * engine-evaluated positions, the per-aggregation `filter` and `having`, beside
 * the `where` twin `driver-sql` refuses, and the class reason each prints is
 * pinned against the twin's own diagnostic rather than retyped (the last
 * block).
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver, withheldFilterDiagnosticOf } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'ledger_order';

const LEDGER_ORDER = {
  name: OBJECT,
  label: 'Ledger Order',
  fields: {
    customer_id: { name: 'customer_id', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    cap: { name: 'cap', type: 'number' as const },
    placed_on: { name: 'placed_on', type: 'date' as const },
    due_on: { name: 'due_on', type: 'date' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
    // [#21255] A second datetime, so a plain reference has a cross-class pair
    // (`closed_at` / `due_on`) and a same-class one (`closed_at` / `opened_at`).
    closed_at: { name: 'closed_at', type: 'datetime' as const },
  },
};

const ROWS = [
  { id: 'o1', customer_id: 'c1', amount: 100, cap: 50, placed_on: '2026-01-10', due_on: '2026-01-05', opened_at: '2026-01-01T10:00:00.000Z', closed_at: '2026-01-03T10:00:00.000Z' },
  { id: 'o2', customer_id: 'c1', amount: 400, cap: 10, placed_on: '2026-01-02', due_on: '2026-01-20', opened_at: '2026-01-02T10:00:00.000Z', closed_at: '2026-01-20T12:00:00.000Z' },
  { id: 'o3', customer_id: 'c2', amount: 900, cap: 5000, placed_on: '2026-03-01', due_on: '2026-01-01', opened_at: '2026-02-01T10:00:00.000Z', closed_at: '2026-02-10T10:00:00.000Z' },
  { id: 'o4', customer_id: 'c2', amount: 300, cap: 1, placed_on: '2026-02-01', due_on: '2026-02-01', opened_at: '2026-02-05T10:00:00.000Z', closed_at: '2026-02-05T11:00:00.000Z' },
  { id: 'o5', customer_id: 'c2', amount: 50, cap: 2, placed_on: '2026-01-15', due_on: '2026-03-01', opened_at: '2026-02-06T10:00:00.000Z', closed_at: '2026-02-06T10:00:00.000Z' },
  { id: 'o6', customer_id: 'c3', amount: 20, cap: 20, placed_on: '2026-02-01', due_on: '2026-01-31', opened_at: '2026-03-01T10:00:00.000Z', closed_at: '2026-03-01T10:00:00.000Z' },
];

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

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

/** A booted door over a real sqlite table — populated or empty — with its driver reads counted. */
async function boot(populated: boolean) {
  const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(LEDGER_ORDER as any);
  await engine.syncSchemas();
  if (populated) await engine.insert(OBJECT, ROWS as any);

  const calls = { aggregate: 0, find: 0 };
  const find = driver.find.bind(driver);
  const aggregate = driver.aggregate.bind(driver);
  driver.find = (o: string, ...rest: unknown[]) => { if (o === OBJECT) calls.find += 1; return find(o, ...rest); };
  driver.aggregate = (o: string, ...rest: unknown[]) => { if (o === OBJECT) calls.aggregate += 1; return aggregate(o, ...rest); };

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
  expect(route).toBeDefined();
  const post = async (body: Record<string, unknown>) => {
    const res = makeRes();
    // What the wire carries: JSON, so a `Date` would arrive as its ISO text.
    await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)) } as any, res);
    return res;
  };
  return { post, calls, engine };
}

const perAggregation = (filter: unknown) => ({
  groupBy: ['customer_id'],
  aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter }],
});
const whereTwin = (filter: unknown) => ({ where: filter, aggregations: [{ function: 'count', alias: 'n' }] });

describe('[#20148] POST /data/:object/query — a per-aggregation filter meets where\'s doors', () => {
  const ROWS_REFUSED: ReadonlyArray<readonly [string, Record<string, unknown>, 'INVALID_FILTER' | 'INVALID_FIELD']> = [
    ['row 1 — a date no date field can read', { placed_on: { $gt: 'not-a-date' } }, 'INVALID_FILTER'],
    ['row 1 — behind a $or branch that holds', { $or: [{ amount: { $gt: 0 } }, { placed_on: { $gt: 'not-a-date' } }] }, 'INVALID_FILTER'],
    ['row 2 — addDays between two numeric fields', { amount: { $gt: { $field: 'cap', addDays: 1 } } }, 'INVALID_FILTER'],
    ['row 2 — addDays between a date and a datetime', { placed_on: { $lte: { $field: 'opened_at', addDays: 1 } } }, 'INVALID_FILTER'],
    ['row 3 — a { $field } naming no declared field', { amount: { $gt: { $field: 'nope' } } }, 'INVALID_FILTER'],
    ['row 3 — the same, under $not', { $not: { amount: { $gt: { $field: 'nope' } } } }, 'INVALID_FILTER'],
    ['row 4 — a key naming no field', { nope: 1 }, 'INVALID_FIELD'],
    ['row 4 — the same, under $ne', { nope: { $ne: 1 } }, 'INVALID_FIELD'],
  ];

  for (const [name, filter, code] of ROWS_REFUSED) {
    it(`${name}: 400 ${code} on an empty and a populated table, before any read — as its where twin`, async () => {
      let message: string | undefined;
      for (const populated of [false, true]) {
        const { post, calls } = await boot(populated);
        const res = await post(perAggregation(filter));
        expect(res._status, `populated=${populated}`).toBe(400);
        expect(res._json.code, `populated=${populated}`).toBe(code);
        expect(calls, `populated=${populated}`).toEqual({ aggregate: 0, find: 0 });
        message ??= res._json.error;
        expect(res._json.error, 'one filter, one answer, whatever the rows').toBe(message);

        const twin = await post(whereTwin(filter));
        expect(twin._status, `twin, populated=${populated}`).toBe(400);
        expect(twin._json.code, `twin, populated=${populated}`).toBe(code);
      }
    });
  }

  it('rows 2 and 3 withhold the names the where twin withholds — the fields and the operator stay off the wire', async () => {
    const { post } = await boot(true);
    for (const filter of [{ amount: { $gt: { $field: 'cap', addDays: 1 } } }, { amount: { $gt: { $field: 'nope' } } }]) {
      const res = await post(perAggregation(filter));
      expect(res._json.code).toBe('INVALID_FILTER');
      expect(res._json.error).toContain('`aggregations[1].filter`');
      expect(res._json.error).toContain('the full diagnostic is in the server log');
      for (const name of ['"amount"', '"cap"', '"nope"', '$gt']) expect(res._json.error).not.toContain(name);
    }
  });

  it('row 4 names the key and the position, as where\'s gate names its own parameter', async () => {
    const { post } = await boot(true);
    const res = await post(perAggregation({ nope: 1 }));
    expect(res._json).toMatchObject({ code: 'INVALID_FIELD', field: 'nope', object: OBJECT });
    expect(res._json.error).toContain("'aggregations[1].filter'");
  });

  const COUNTED: ReadonlyArray<readonly [string, Record<string, unknown>, Record<string, number>]> = [
    ['a declared-field filter', { amount: { $gt: 100 } }, { c1: 1, c2: 2, c3: 0 }],
    ['a { $field } between two declared numeric fields', { amount: { $gt: { $field: 'cap' } } }, { c1: 2, c2: 2, c3: 0 }],
    ['addDays between two date fields', { placed_on: { $lte: { $field: 'due_on', addDays: 7 } } }, { c1: 2, c2: 2, c3: 1 }],
    ['a { $field } to a column every row carries', { opened_at: { $lte: { $field: 'created_at' } } }, { c1: 2, c2: 3, c3: 1 }],
    ['row 5\'s spelling on the wire — a datetime bound as ISO text', { opened_at: { $gt: '2026-02-01T00:00:00.000Z' } }, { c1: 0, c2: 3, c3: 1 }],
  ];

  for (const [name, filter, perGroup] of COUNTED) {
    it(`${name}: counted, and the counts are the where twin's`, async () => {
      const { post } = await boot(true);
      const res = await post(perAggregation(filter));
      expect(res._status ?? 200).toBe(200);
      const counts = Object.fromEntries((res._json.records as any[]).map((r) => [r.customer_id, r.m]));
      expect(counts).toEqual(perGroup);
      const twin = await post(whereTwin(filter));
      expect(twin._status ?? 200).toBe(200);
      expect(twin._json.records).toEqual([{ n: Object.values(perGroup).reduce((a, b) => a + b, 0) }]);
    });
  }
});

describe('[#21255] POST /data/:object/query — a plain { $field } across two comparison classes is refused at every position, as its where twin is', () => {
  // `closed_at` is a datetime, `due_on` a date. Before (2791138cbf), measured
  // on these rows with the rule reverted, through `engine.aggregate` on this
  // `SqlDriver`: the per-aggregation filter counted 3 rows (c1 2, c2 1) and
  // `having` kept 3 of the 6 day buckets — `@objectstack/formula`'s whole-day
  // reading of the bare day (o2 closes on its due day at 12:00) — while the
  // `where` twin below was refused 400 by `driver-sql`'s compiler.
  const CROSS_CLASS = { closed_at: { $lte: { $field: 'due_on' } } };
  const HAVING_CROSS_CLASS = {
    groupBy: [{ field: 'due_on', dateGranularity: 'day', alias: 'due_day' }],
    aggregations: [{ function: 'max', field: 'closed_at', alias: 'last_closed' }],
    having: { last_closed: { $lte: { $field: 'due_day' } } },
  };

  /**
   * The `where` twin's class reason, read from the diagnostic `driver-sql`
   * withholds from the wire — through the engine door, where the thrown error
   * still carries it — split into the two class names and the sentence that
   * follows them, so a refusal here is compared against what `where` actually
   * printed, never against a copy typed into this file.
   */
  async function whereTwinReason(engine: ObjectQL): Promise<{ classes: [string, string]; tail: string }> {
    let diagnostic: string | null = null;
    try {
      const twin: EngineAggregateOptions = { where: CROSS_CLASS, aggregations: [{ function: 'count', alias: 'n' }] };
      await engine.aggregate(OBJECT, twin);
    } catch (e) {
      expect((e as { code?: unknown }).code).toBe('INVALID_FILTER');
      diagnostic = withheldFilterDiagnosticOf(e);
    }
    expect(diagnostic, 'the where twin is refused with a withheld diagnostic').toBeTypeOf('string');
    const named = /"closed_at" is stored as (\w+) but "due_on" as (\w+)(, .*)$/.exec(diagnostic!);
    expect(named, diagnostic!).not.toBeNull();
    return { classes: [named![1], named![2]], tail: named![3] };
  }

  it('the per-aggregation filter: 400 INVALID_FILTER on an empty and a populated table, before any read — as its where twin, in its words', async () => {
    let message: string | undefined;
    for (const populated of [false, true]) {
      const { post, calls, engine } = await boot(populated);
      const logged: string[] = [];
      (engine as any).logger.warn = (line: unknown) => { logged.push(String(line)); };
      const res = await post(perAggregation(CROSS_CLASS));
      const refusalLog = logged.splice(0);
      expect(res._status, `populated=${populated}`).toBe(400);
      expect(res._json.code, `populated=${populated}`).toBe('INVALID_FILTER');
      expect(calls, `populated=${populated}`).toEqual({ aggregate: 0, find: 0 });
      message ??= res._json.error;
      expect(res._json.error, 'one filter, one answer, whatever the rows').toBe(message);
      // Withheld as the twin withholds: no field this filter names reaches the wire.
      for (const name of ['"closed_at"', '"due_on"', '$lte']) expect(res._json.error).not.toContain(name);

      const twin = await post(whereTwin(CROSS_CLASS));
      expect(twin._status, `twin, populated=${populated}`).toBe(400);
      expect(twin._json.code, `twin, populated=${populated}`).toBe('INVALID_FILTER');

      // The withheld half: the twin's classes and the twin's sentence.
      const { classes: [target, referent], tail } = await whereTwinReason(engine);
      expect([target, referent]).toEqual(['datetime', 'date']);
      expect(refusalLog).toHaveLength(1);
      expect(refusalLog[0]).toContain(`"closed_at" is ${target} but "due_on" is ${referent}${tail}`);
    }
  });

  it('having: 400 INVALID_FILTER on an empty and a populated table — as the where twin of the same pair, in its words', async () => {
    for (const populated of [false, true]) {
      const { post, calls, engine } = await boot(populated);
      const res = await post(HAVING_CROSS_CLASS);
      expect(res._status, `populated=${populated}`).toBe(400);
      expect(res._json.code, `populated=${populated}`).toBe('INVALID_FILTER');
      expect(calls, `populated=${populated}`).toEqual({ aggregate: 0, find: 0 });

      const twin = await post(whereTwin(CROSS_CLASS));
      expect(twin._status, `twin, populated=${populated}`).toBe(400);
      expect(twin._json.code, `twin, populated=${populated}`).toBe('INVALID_FILTER');

      // `having` names its own projection's columns (they are the author's), so
      // its reason is on the wire: the twin's classes, and the twin's sentence.
      const { classes: [target, referent], tail } = await whereTwinReason(engine);
      expect(res._json.error).toContain(`"last_closed" is ${target} but "due_day" is ${referent}${tail}`);
    }
  });

  // One class on both sides: counted exactly as before, and as the where twin
  // counts. The numeric pair is the #20148 block's `COUNTED` row above.
  const SAME_CLASS: ReadonlyArray<readonly [string, Record<string, unknown>, Record<string, number>]> = [
    ['a date against a date', { placed_on: { $lte: { $field: 'due_on' } } }, { c1: 1, c2: 2, c3: 0 }],
    ['a datetime against a datetime', { closed_at: { $gt: { $field: 'opened_at' } } }, { c1: 2, c2: 2, c3: 0 }],
  ];

  for (const [name, filter, perGroup] of SAME_CLASS) {
    it(`${name}: counted, and the counts are the where twin's`, async () => {
      const { post } = await boot(true);
      const res = await post(perAggregation(filter));
      expect(res._status ?? 200).toBe(200);
      const counts = Object.fromEntries((res._json.records as any[]).map((r) => [r.customer_id, r.m]));
      expect(counts).toEqual(perGroup);
      const twin = await post(whereTwin(filter));
      expect(twin._status ?? 200).toBe(200);
      expect(twin._json.records).toEqual([{ n: Object.values(perGroup).reduce((a, b) => a + b, 0) }]);
    });
  }

  it('having over one class — a day bucket against a date — keeps the groups it kept', async () => {
    const { post } = await boot(true);
    const res = await post({
      groupBy: [{ field: 'placed_on', dateGranularity: 'day', alias: 'placed' }],
      aggregations: [{ function: 'min', field: 'due_on', alias: 'first_due' }],
      having: { placed: { $lte: { $field: 'first_due' } } },
    });
    expect(res._status ?? 200).toBe(200);
    expect((res._json.records as any[]).map((r) => r.placed).sort()).toEqual(['2026-01-02', '2026-01-15']);
  });
});
