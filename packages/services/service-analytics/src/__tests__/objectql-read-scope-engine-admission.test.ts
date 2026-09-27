// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19995, ruling C] Every engine-bound read-scope merge asks the ENGINE's own
 * `where` admission (`IObjectQLEngine.judgeFilter`, #20157) about the scope
 * alone, before composing it, and refuses in the withheld
 * `READ_SCOPE_COMPILE_FAILED` / 500. A scope the engine serves is still served,
 * and the caller's own `where` keeps the engine's answer.
 *
 * ## The ruling this holds
 *
 * #5367 (re-affirmed as #7598 Q2 = A), recorded in `read-scope-sql.ts`'s
 * header: a read-scope refusal is a SERVER fault, and its message goes to the
 * operator's log, never into a response. Four scope classes still reached the
 * engine unjudged on the ObjectQL face: their doors read the object's declared
 * field map (a text operator over a non-text field, an uninterpretable temporal
 * comparand, a virtual field, a dotted path through a lookup). Each came back as
 * the engine's 400, whose message the analytics HTTP doors relay. Ruling C gave
 * the engine a judge-only admission member, and this package asks it.
 *
 * ## The composition is the plugin's, over a real engine
 *
 * `AnalyticsServicePlugin` is initialised with a real `ObjectQL` (over
 * `SqliteWasmDriver`) as its `'data'` service. It auto-bridges
 * `executeAggregate` to that engine and wires the judge to the same engine,
 * which is the composition every shipped host boots (`os serve`, the verify
 * harness). Only `queryCapabilities` is fixed, to the ObjectQL face; the
 * NativeSQL face compiles the scope itself and never reaches these merges.
 *
 * ## The four merges
 *
 * - `withReadScope`, on the direct path and the cross-object base aggregate;
 * - `resolveFkAttr`, the referenced object's scope on the cross-object path;
 * - the plugin's record-label fetch, reached by the dataset door's sort-key
 *   label pass (an `order` on a lookup dimension), which propagates a refusal
 *   to the caller.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { declaredRefusalMessage, resolveThrownHttpError, serverFaultProvenance } from '@objectstack/types';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema } from '@objectstack/spec/ui';

import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin, type AnalyticsServicePluginOptions } from '../plugin.js';

const BASE = 'deal';
const REF = 'account';

const BASE_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  region: { type: 'text', name: 'region' },
  owner: { type: 'text', name: 'owner' },
  amount: { type: 'number', name: 'amount' },
  closed_on: { type: 'date', name: 'closed_on' },
  score: { type: 'formula', name: 'score', expression: 'amount * 2', returnType: 'number' },
  account: { type: 'lookup', name: 'account', reference: REF },
};
const REF_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  name: { type: 'text', name: 'name' },
  rank: { type: 'number', name: 'rank' },
};

const BASE_ROWS = [
  { id: 'd1', region: 'emea', owner: 'u_me', amount: 10, closed_on: '2026-01-10', account: 'acc_gold' },
  { id: 'd2', region: 'apac', owner: 'u_other', amount: 20, closed_on: '2026-02-10', account: 'acc_silver' },
  { id: 'd3', region: 'amer', owner: 'u_me', amount: 30, closed_on: '2026-03-10', account: 'acc_gold' },
];
const REF_ROWS = [
  { id: 'acc_gold', name: 'Gold Corp', rank: 1 },
  { id: 'acc_silver', name: 'Silver Ltd', rank: 2 },
];

const dataset = DatasetSchema.parse({
  name: 'deal_admission',
  label: 'Deal admission',
  object: BASE,
  include: ['account'],
  dimensions: [
    { name: 'region', field: 'region', type: 'string' },
    { name: 'account_name', field: 'account.name', type: 'string' },
    { name: 'account', field: 'account', type: 'string' },
  ],
  measures: [{ name: 'deal_count', aggregate: 'count' }],
});

/** A base-only query: `execute()`'s direct path, one `withReadScope` merge. */
const DIRECT: AnalyticsQuery = { cube: 'deal_admission', dimensions: ['region'], measures: ['deal_count'] };
/** A cross-object dimension: `executeCrossObject` + `resolveFkAttr`, two merges. */
const CROSS: AnalyticsQuery = { cube: 'deal_admission', dimensions: ['account_name'], measures: ['deal_count'] };
/** The dataset door's sort-key label pass: an `order` on a lookup dimension. */
const LABEL_SORT = { dimensions: ['account'], measures: ['deal_count'], order: { account: 'asc' as const } };

const MEMBER: ExecutionContext = { userId: 'u_me' } as ExecutionContext;
const ALL_REGIONS = { region: { $in: ['emea', 'apac', 'amer'] } };

interface WireBearingError extends Error {
  code?: unknown;
  status?: unknown;
}

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

/**
 * The four classes, each a scope the engine refuses through a door that reads
 * the object's field map, with the field its refusal names (the policy content
 * the relayed 400 used to carry).
 */
const RESIDUE: Array<{ name: string; scope: Record<string, unknown>; names: string }> = [
  { name: 'a text operator over a number field', scope: { amount: { $contains: 'RESTRICTED_TX' } }, names: 'amount' },
  { name: 'a temporal comparand the date field cannot read', scope: { closed_on: { $gte: 'RESTRICTED-NOT-A-DATE' } }, names: 'RESTRICTED-NOT-A-DATE' },
  { name: 'a filter on a virtual (formula) field', scope: { score: 42 }, names: 'score' },
  { name: 'a dotted path through a lookup', scope: { 'account.name': 'RESTRICTED_DP' }, names: 'account.name' },
];

function assertWithheldServerFault(err: WireBearingError | undefined, names: string): void {
  expect(err, 'the scope must be refused').toBeInstanceOf(Error);
  expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
  expect(err?.status).toBe(500);
  // The reads every analytics HTTP door takes before relaying prose: a
  // producer-declared 5xx that is not a declared refusal ⇒ withheld.
  expect(serverFaultProvenance(resolveThrownHttpError(err, 500))).toBe('declared');
  expect(declaredRefusalMessage(err)).toBeUndefined();
  // …and the detail is RELOCATED, not deleted: the operator's log keeps it.
  expect(String(err?.message)).toContain(names);
}

function assertCallersOwn(err: WireBearingError | undefined, code: string, names: string): void {
  expect(err, "the caller's own where must be refused").toBeInstanceOf(Error);
  expect(err?.code).toBe(code);
  expect(err?.status).toBe(400);
  expect(String(err?.message)).toContain(names);
  expect(serverFaultProvenance(resolveThrownHttpError(err, 500))).toBeUndefined();
}

function pluginContext(services: Record<string, unknown>) {
  const registered: Record<string, unknown> = {};
  const warn = vi.fn();
  return {
    registered,
    warn,
    ctx: {
      getService: (name: string) => services[name] ?? registered[name],
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      logger: { info() {}, warn, error() {}, debug() {} },
    },
  };
}

describe('[#19995, ruling C] a read scope the engine refuses is refused by the analytics ObjectQL face as a withheld server fault', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  /** Swapped per case; the `getReadScope` contract filled by hand. */
  let scopes: Record<string, unknown> = {};

  const getReadScope = (object: string) => (scopes[object] ?? undefined) as never;

  /** The plugin's own composition over the real engine, ObjectQL face only. */
  async function pluginService(
    data: unknown,
    options: Partial<AnalyticsServicePluginOptions> = {},
  ): Promise<{ service: AnalyticsService; warn: ReturnType<typeof vi.fn> }> {
    const { ctx, registered, warn } = pluginContext({ data });
    await new AnalyticsServicePlugin({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      getReadScope,
      ...options,
    }).init(ctx as never);
    const service = registered.analytics as AnalyticsService;
    service.registerDataset(dataset);
    return { service, warn };
  }

  let wired: AnalyticsService;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    (driver as unknown as { logger: unknown }).logger = quiet;
    await driver.initObjects([
      { name: BASE, fields: BASE_FIELDS },
      { name: REF, fields: REF_FIELDS },
    ] as never);
    for (const row of BASE_ROWS) await driver.create(BASE, { ...row });
    for (const row of REF_ROWS) await driver.create(REF, { ...row });

    engine = new ObjectQL({ logger: quiet });
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registerObject({ name: BASE, label: 'Deal', fields: BASE_FIELDS } as never);
    engine.registerObject({ name: REF, label: 'Account', fields: REF_FIELDS } as never);

    wired = (await pluginService(engine)).service;
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  async function outcome(
    run: () => Promise<{ rows: Record<string, unknown>[] }>,
    scopeFor: Record<string, unknown>,
  ): Promise<{ refusal?: WireBearingError; rows?: Record<string, unknown>[] }> {
    scopes = scopeFor;
    try {
      return { rows: (await run()).rows };
    } catch (e) {
      return { refusal: e as WireBearingError };
    } finally {
      scopes = {};
    }
  }

  /** `{ dimensionValue: count }`, order-free. */
  function counts(rows: Record<string, unknown>[] | undefined, dim: string): Record<string, number> {
    return Object.fromEntries((rows ?? []).map((r) => [String(r[dim]), Number(r.deal_count)]));
  }

  describe('refused: the direct path (`execute()` → `withReadScope`)', () => {
    for (const c of RESIDUE) {
      it(`${c.name} → READ_SCOPE_COMPILE_FAILED / 500, prose withheld`, async () => {
        const { refusal, rows } = await outcome(() => wired.query(DIRECT, MEMBER), { [BASE]: c.scope });
        expect(rows, 'a scope the engine refuses must not be served').toBeUndefined();
        assertWithheldServerFault(refusal, c.names);
      });
    }

    it('a well-formed caller `where` beside a refused scope → still the scope’s withheld 500', async () => {
      const { refusal } = await outcome(
        () => wired.query({ ...DIRECT, where: { region: 'emea' } } as AnalyticsQuery, MEMBER),
        { [BASE]: { amount: { $contains: 'RESTRICTED_TX' } } },
      );
      assertWithheldServerFault(refusal, 'amount');
    });
  });

  describe('refused: the cross-object path', () => {
    it('a refused BASE scope (`executeCrossObject` → `withReadScope`) → withheld 500', async () => {
      const { refusal, rows } = await outcome(() => wired.query(CROSS, MEMBER), {
        [BASE]: { closed_on: { $gte: 'RESTRICTED-NOT-A-DATE' } },
      });
      expect(rows).toBeUndefined();
      assertWithheldServerFault(refusal, 'RESTRICTED-NOT-A-DATE');
    });

    it('a refused REFERENCED-object scope (`resolveFkAttr`) → withheld 500', async () => {
      const { refusal, rows } = await outcome(() => wired.query(CROSS, MEMBER), {
        [REF]: { rank: { $contains: 'RESTRICTED_RANK' } },
      });
      expect(rows).toBeUndefined();
      assertWithheldServerFault(refusal, 'rank');
    });
  });

  describe('refused: the plugin’s record-label fetch (the dataset door’s sort-key label pass)', () => {
    it('a referenced-object scope the engine refuses → withheld 500, not the engine’s 400', async () => {
      const { refusal, rows } = await outcome(() => wired.queryDataset(dataset, LABEL_SORT, MEMBER), {
        [REF]: { rank: { $contains: 'RESTRICTED_RANK' } },
      });
      expect(rows).toBeUndefined();
      assertWithheldServerFault(refusal, 'rank');
    });
  });

  describe('served: what must NOT move', () => {
    it('a well-formed scope is served with exactly its rows', async () => {
      const { refusal, rows } = await outcome(() => wired.query(DIRECT, MEMBER), {
        [BASE]: { region: { $in: ['emea', 'apac'] } },
      });
      expect(refusal).toBeUndefined();
      expect(counts(rows, 'region')).toEqual({ emea: 1, apac: 1 });
    });

    it('a scope with a placeholder the forwarded context resolves is served with exactly its rows', async () => {
      // The judge resolves `{current_user_id}` from the context the strategy
      // forwards, as the engine does when it executes. A judgement that read
      // another context, or none, would refuse this scope.
      const { refusal, rows } = await outcome(() => wired.query(DIRECT, MEMBER), {
        [BASE]: { owner: '{current_user_id}' },
      });
      expect(refusal).toBeUndefined();
      expect(counts(rows, 'region')).toEqual({ emea: 1, amer: 1 });
    });

    it('a well-formed referenced-object scope buckets what it hides as `(restricted)`', async () => {
      const { refusal, rows } = await outcome(() => wired.query(CROSS, MEMBER), {
        [REF]: { rank: { $lte: 1 } },
      });
      expect(refusal).toBeUndefined();
      expect(counts(rows, 'account_name')).toEqual({ 'Gold Corp': 2, '(restricted)': 1 });
    });

    it('a well-formed referenced-object scope on the label pass is served, sorted by label', async () => {
      const { refusal, rows } = await outcome(() => wired.queryDataset(dataset, LABEL_SORT, MEMBER), {
        [REF]: { rank: { $gte: 1 } },
      });
      expect(refusal).toBeUndefined();
      expect(rows?.map((r) => r.account)).toEqual(['Gold Corp', 'Silver Ltd']);
    });
  });

  describe("the caller's own `where` keeps the engine's answer (no blanket catch)", () => {
    it('a text operator over a number field → INVALID_FILTER / 400 with its message', async () => {
      const { refusal } = await outcome(
        () => wired.query({ ...DIRECT, where: { amount: { $contains: '7' } } } as AnalyticsQuery, MEMBER),
        { [BASE]: ALL_REGIONS },
      );
      assertCallersOwn(refusal, 'INVALID_FILTER', 'amount');
    });

    it('a temporal comparand the date field cannot read → INVALID_FILTER / 400 with its message', async () => {
      const { refusal } = await outcome(
        () => wired.query({ ...DIRECT, where: { closed_on: { $gte: 'caller-not-a-date' } } } as AnalyticsQuery, MEMBER),
        { [BASE]: ALL_REGIONS },
      );
      assertCallersOwn(refusal, 'INVALID_FILTER', 'caller-not-a-date');
    });

    it('a filter on a virtual (formula) field → INVALID_FIELD / 400 with its message', async () => {
      const { refusal } = await outcome(
        () => wired.query({ ...DIRECT, where: { score: 7 } } as AnalyticsQuery, MEMBER),
        { [BASE]: ALL_REGIONS },
      );
      assertCallersOwn(refusal, 'INVALID_FIELD', 'score');
    });
  });

  describe('a host that cannot answer keeps today’s behaviour and says so once', () => {
    it('AnalyticsService given no judgeFilter: the engine’s 400 as before, one warn across queries', async () => {
      const warn = vi.fn();
      const service = new AnalyticsService({
        logger: { ...quiet, warn },
        queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
        getReadScope,
        executeAggregate: async (objectName, options) =>
          (await engine.aggregate(objectName, {
            where: options.filter,
            groupBy: options.groupBy,
            aggregations: options.aggregations?.map((a) => ({ function: a.method, field: a.field, alias: a.alias })),
            context: options.context,
          } as never)) as Record<string, unknown>[],
      });
      service.registerDataset(dataset);

      const first = await outcome(() => service.query(DIRECT, MEMBER), { [BASE]: { amount: { $contains: 'RESTRICTED_TX' } } });
      expect(first.refusal?.code).toBe('INVALID_FILTER');
      expect(first.refusal?.status).toBe(400);
      // This package's own guards still refuse, withheld, what they can judge.
      const guarded = await outcome(() => service.query(DIRECT, MEMBER), { [BASE]: { region: ['emea', 'apac'] } });
      assertWithheldServerFault(guarded.refusal, 'region');
      const served = await outcome(() => service.query(DIRECT, MEMBER), { [BASE]: { region: { $in: ['emea'] } } });
      expect(counts(served.rows, 'region')).toEqual({ emea: 1 });

      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('judgeFilter'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`"${BASE}"`);
    });

    it('a plugin host with its own executeAggregate is not wired to a guessed engine', async () => {
      const { service } = await pluginService(engine, {
        executeAggregate: async (objectName, options) =>
          (await engine.aggregate(objectName, {
            where: options.filter,
            groupBy: options.groupBy,
            aggregations: options.aggregations?.map((a) => ({ function: a.method, field: a.field, alias: a.alias })),
            context: options.context,
          } as never)) as Record<string, unknown>[],
      });
      const residue = await outcome(() => service.query(DIRECT, MEMBER), { [BASE]: { amount: { $contains: 'RESTRICTED_TX' } } });
      expect(residue.refusal?.code).toBe('INVALID_FILTER');
      expect(residue.refusal?.status).toBe(400);
      // The label fetch keeps this package's own guards on that host too.
      const labelGuarded = await outcome(() => service.queryDataset(dataset, LABEL_SORT, MEMBER), {
        [REF]: { name: ['Gold Corp', 'Silver Ltd'] },
      });
      assertWithheldServerFault(labelGuarded.refusal, 'name');
      const labelPlaceholder = await outcome(() => service.queryDataset(dataset, LABEL_SORT, MEMBER), {
        [REF]: { name: '{restricted_label_token}' },
      });
      assertWithheldServerFault(labelPlaceholder.refusal, 'restricted_label_token');
    });

    it('a "data" engine without judgeFilter: the engine’s 400 as before, and the plugin warns once', async () => {
      // A 'data' service that is not ObjectQL: the members the bridges read, and
      // no judge.
      const bare = {
        aggregate: engine.aggregate.bind(engine),
        getObject: engine.getObject.bind(engine),
      };
      const { service, warn } = await pluginService(bare);
      for (let i = 0; i < 2; i++) {
        const { refusal } = await outcome(() => service.query(DIRECT, MEMBER), { [BASE]: { amount: { $contains: 'RESTRICTED_TX' } } });
        expect(refusal?.code).toBe('INVALID_FILTER');
        expect(refusal?.status).toBe(400);
      }
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('judgeFilter'));
      expect(lines).toHaveLength(1);
    });
  });

  it('a judge that throws (a fault, not a verdict) → the withheld 500, never its text on the wire', async () => {
    const service = new AnalyticsService({
      logger: quiet,
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      getReadScope,
      executeAggregate: async () => [],
      judgeFilter: () => {
        throw new Error('judge fault naming RESTRICTED_FAULT');
      },
    });
    service.registerDataset(dataset);
    const { refusal } = await outcome(() => service.query(DIRECT, MEMBER), { [BASE]: { region: 'emea' } });
    assertWithheldServerFault(refusal, 'RESTRICTED_FAULT');
  });
});
