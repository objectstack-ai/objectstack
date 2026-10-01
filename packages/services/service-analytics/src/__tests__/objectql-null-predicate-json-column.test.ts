// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20918] A null predicate the `where` door produces reaches the engine in the
 * spelling the engine's own lowering writes, so the ObjectQL face answers the
 * engine's rows over a multi-valued (JSON-stored) column too.
 *
 * ## The mechanism
 *
 * The `where` door turns `$null` / `$exists`, a null `$eq` / `$ne`, and the
 * NULL-safe guards of the `$not` rewrite (#5146) and of the negative-polarity
 * operators (#5298) into `set` / `notSet` leaves. `ObjectQLStrategy` hands those
 * leaves to the engine. It used to spell `set` as `{ $ne: null }` and `notSet`
 * as the bare `{ field: null }`, and `driver-sql` refuses both over a JSON
 * column: they are a scalar comparison and the bare equality spelling, which
 * that driver's #7398 gate refuses whatever the comparand. So
 * `{ $not: { owners: { $contains: 'u1' } } }` answered `400 INVALID_FILTER`
 * where `engine.find` answers its rows: the guard the door adds under `$not`
 * reached the driver as `$ne: null`.
 *
 * The engine's own spellings are `{ $null: false }` and `{ $null: true }`: the
 * shared lowering (`lowerFilterCondition`, run at the engine's `where` seam)
 * emits exactly those for the same guards, and `driver-sql` applies them over a
 * JSON column (`IS NOT NULL` / `IS NULL` ask about the column's presence). The
 * strategy now speaks them.
 *
 * ## Measured on the base, this fixture, the ObjectQL face
 *
 * | `where` | `engine.find` | ObjectQL face, base |
 * |:--|:--|:--|
 * | `{ $not: { owners: { $contains: 'u1' } } }` | b, d, e | 400 `INVALID_FILTER` (`$ne`) |
 * | `{ owners: { $null: false } }` | a, b, c, d | 400 (`$ne`) |
 * | `{ $not: { owners: { $notContains: 'u1' } } }` | a, c | 400 (bare equality) |
 * | `{ owners: { $notContains: 'u1' } }` | b, d, e | 400 (bare equality) |
 * | `{ owners: { $null: true } }` | e | 400 (bare equality) |
 * | the single-valued controls | the engine's rows | the engine's rows |
 *
 * The engine (`engine.find`) is the reference, computed in the same test over
 * the same rows.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const OWNER = 'nullpred_owner';
const LEDGER = 'nullpred_ledger';

const OWNER_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  region: { type: 'text', name: 'region' },
};
const LEDGER_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  title: { type: 'text', name: 'title' },
  owner: { type: 'lookup', name: 'owner', reference: OWNER },
  owners: { type: 'lookup', name: 'owners', reference: OWNER, multiple: true },
};

const OWNER_ROWS = [
  { id: 'u1', region: 'NA' },
  { id: 'u2', region: 'EU' },
  { id: 'u3', region: 'AP' },
];
/** `e` holds no value in either relation: the row every NULL guard is about. */
const LEDGER_ROWS = [
  { id: 'd1', title: 'a', owner: 'u1', owners: ['u1'] },
  { id: 'd2', title: 'b', owner: 'u2', owners: ['u2'] },
  { id: 'd3', title: 'c', owner: 'u1', owners: ['u2', 'u1'] },
  { id: 'd4', title: 'd', owner: 'u3', owners: ['u3'] },
  { id: 'd5', title: 'e', owner: null, owners: null },
];
const TITLE_OF = new Map(LEDGER_ROWS.map((r) => [r.id, r.title]));

const CALLER = { userId: 'u_caller' } as ExecutionContext;
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

/**
 * The engine serves every one of these. Each names the arm of the strategy's
 * null-predicate spelling it reaches, and the rows `engine.find` answers on this
 * fixture (asserted too, so a moved reference cannot pass silently).
 */
const SERVED: ReadonlyArray<{ name: string; where: Record<string, unknown>; rows: string[] }> = [
  { name: '$not over $contains, multi-valued (the guard is a `set` leaf)', where: { $not: { owners: { $contains: 'u1' } } }, rows: ['b', 'd', 'e'] },
  { name: 'has a value, multi-valued (`set`)', where: { owners: { $null: false } }, rows: ['a', 'b', 'c', 'd'] },
  { name: '$not over $notContains, multi-valued (the guard is a `notSet` leaf)', where: { $not: { owners: { $notContains: 'u1' } } }, rows: ['a', 'c'] },
  { name: '$notContains, multi-valued (its NULL escape is a `notSet` leaf)', where: { owners: { $notContains: 'u1' } }, rows: ['b', 'd', 'e'] },
  { name: 'has no value, multi-valued (`notSet`)', where: { owners: { $null: true } }, rows: ['e'] },
  { name: 'CONTROL $not over $contains, single-valued', where: { $not: { owner: { $contains: 'u1' } } }, rows: ['b', 'd', 'e'] },
  { name: 'CONTROL has a value, single-valued', where: { owner: { $null: false } }, rows: ['a', 'b', 'c', 'd'] },
  { name: 'CONTROL has no value, single-valued', where: { owner: { $null: true } }, rows: ['e'] },
];

describe('[#20918] the ObjectQL face hands a null predicate to the engine in the engine\'s own spelling', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  let service: AnalyticsService;
  /** The `where` the engine's `aggregate` last received from the strategy. */
  let received: unknown;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    (driver as unknown as { logger: unknown }).logger = quiet;
    await driver.initObjects([
      { name: OWNER, fields: OWNER_FIELDS },
      { name: LEDGER, fields: LEDGER_FIELDS },
    ] as never);
    for (const row of OWNER_ROWS) await driver.create(OWNER, { ...row });
    for (const row of LEDGER_ROWS) await driver.create(LEDGER, { ...row });

    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registerObject({ name: OWNER, label: 'Owner', fields: OWNER_FIELDS } as never);
    engine.registerObject({ name: LEDGER, label: 'Ledger', fields: LEDGER_FIELDS } as never);

    const aggregate = engine.aggregate.bind(engine);
    vi.spyOn(engine, 'aggregate').mockImplementation(async (object: string, options: any) => {
      if (object === LEDGER) received = options?.where;
      return aggregate(object, options);
    });

    const registered: Record<string, unknown> = {};
    const services: Record<string, unknown> = { data: engine };
    await new AnalyticsServicePlugin({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    }).init({
      getService: (name: string) => services[name] ?? registered[name],
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      logger: quiet,
      hook: () => {},
    } as never);
    service = registered.analytics as AnalyticsService;
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  const query = (where: Record<string, unknown>): AnalyticsQuery =>
    ({ cube: LEDGER, measures: ['count'], dimensions: ['title'], where }) as AnalyticsQuery;

  const engineRows = async (where: Record<string, unknown>) =>
    engine.find(LEDGER, { where, context: CALLER } as never).then(
      (rows: Array<{ id: string }>) => ({ rows: rows.map((r) => TITLE_OF.get(r.id) as string).sort() }),
      (e: { code?: string; status?: number }) => ({ refused: { code: e?.code, status: e?.status } }),
    );

  const faceRows = async (where: Record<string, unknown>) =>
    service.query(query(where), CALLER).then(
      (r) => ({ rows: r.rows.map((row) => String(row.title)).sort() }),
      (e: { code?: string; status?: number; message?: string }) => ({ refused: { code: e?.code, status: e?.status }, message: e?.message }),
    );

  for (const c of SERVED) {
    it(`${c.name}: the engine's rows`, async () => {
      expect(await engineRows(c.where), 'the reference: engine.find').toEqual({ rows: c.rows });
      expect(await faceRows(c.where), 'the ObjectQL face').toEqual({ rows: c.rows });
    });
  }

  it('a `set` leaf reaches the engine as `{ $null: false }` and a `notSet` leaf as `{ $null: true }` — never `$ne: null` or the bare `null`', async () => {
    received = undefined;
    await faceRows({ owners: { $null: false } });
    expect(received).toEqual({ owners: { $null: false } });

    received = undefined;
    await faceRows({ owners: { $null: true } });
    expect(received).toEqual({ owners: { $null: true } });
  });
});
