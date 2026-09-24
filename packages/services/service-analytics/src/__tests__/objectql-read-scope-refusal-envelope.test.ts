// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19995] The ObjectQL execute face refuses a read scope the engine cannot run
 * in the SAME withheld envelope as the other two analytics faces —
 * `READ_SCOPE_COMPILE_FAILED` / 500 — and never as the engine's
 * `INVALID_FILTER` / 400.
 *
 * ## The ruling this holds on the third face
 *
 * #5367 (re-affirmed as #7598 Q2 = A), recorded in `read-scope-sql.ts`'s
 * header: a read-scope refusal is a SERVER fault, and its message — which names
 * the policy's fields and comparands — goes to the operator's log, never into a
 * response. The NativeSQL execute face and the `/analytics/sql` echo compile
 * the scope with `compileScopedFilterToSql` and hold that. The ObjectQL execute
 * face never meets that compiler: `withReadScope` ANDs the scope into the
 * `where` handed to `engine.aggregate`, and a scope carrying a comparand the
 * engine's shared comparand faces refuse came back as the engine's own
 * `INVALID_FILTER` / 400 — a 4xx whose prose the HTTP doors relay verbatim.
 * One scope, two envelopes, and the 400 one is the disclosure #5367 closed.
 *
 * ## Why the verdict is taken at the merge boundary, on the scope ALONE
 *
 * The engine's comparand-shape refusal does not read the `'policy'` provenance
 * mark `withReadScope` stamps (#8220) — measured: the scope's refusal text came
 * back whole. And one line after the boundary the scope is `$and`-composed with
 * the caller's own filter, after which no consumer can tell whose clause a
 * refusal came from. So the scope is judged by the two shared faces the engine
 * itself runs on the object-form `where` (`@objectstack/spec/data`'s
 * `assertListComparandShapes` and `normalizeFilterComparandTypes`) BEFORE the
 * composition — same functions, so the same verdicts, and nothing the engine
 * serves is refused here.
 *
 * ⛔ Not a catch around `executeAggregate`. The caller's own `where` still
 * reaches the engine through the object-form door for some shapes, and those
 * refusals are the caller's to read: `INVALID_FILTER` / 400 with the message
 * kept. The controls below pin exactly that.
 *
 * ## What "withheld" is asserted as here
 *
 * Every HTTP door that answers an analytics query decides whether to relay a
 * thrown message through the same two reads in `@objectstack/types` —
 * `serverFaultProvenance(resolveThrownHttpError(err, 500))` and
 * `declaredRefusalMessage(err)` — and relays the prose only for a 4xx or a
 * declared refusal. So a refusal that declares `status: 500` with no refusal
 * flag is withheld at every door by construction, and a 4xx is relayed. That is
 * what each case asserts; the thrown message itself keeps the full detail on
 * purpose, because the operator's log is now its only destination (the
 * inventory in `read-scope-refusal-envelope.test.ts` pins the same split).
 *
 * ## The engine is real, because the claim is about the engine's refusal
 *
 * A real `ObjectQL` over `SqliteWasmDriver` (a `SqlDriver`) stands behind
 * `executeAggregate`, bridged the way `AnalyticsServicePlugin`'s auto-bridge
 * bridges it. A stub bridge would have made every expectation below a
 * statement about the stub. Every read scope is the `getReadScope` contract
 * filled by hand, never by the RLS compiler: the contract is what a host
 * provider fills, and the CEL lowering is only one producer of it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { declaredRefusalMessage, resolveThrownHttpError, serverFaultProvenance } from '@objectstack/types';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { FilterCondition } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';

import { AnalyticsService, type AnalyticsServiceConfig } from '../analytics-service.js';
import { compileDataset } from '../dataset-compiler.js';

const BASE = 'deal';
const REF = 'account';

const BASE_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  region: { type: 'text', name: 'region' },
  owner: { type: 'text', name: 'owner' },
  account: { type: 'text', name: 'account' },
  amount: { type: 'number', name: 'amount' },
  budget: { type: 'number', name: 'budget' },
};
const REF_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  tier: { type: 'text', name: 'tier' },
};

const BASE_ROWS = [
  { id: 'd1', region: 'emea', owner: 'u_me', account: 'acc_gold', amount: 10, budget: 5 },
  { id: 'd2', region: 'apac', owner: 'u_other', account: 'acc_silver', amount: 20, budget: 50 },
  { id: 'd3', region: 'amer', owner: 'u_me', account: 'acc_gold', amount: 30, budget: 25 },
];
const REF_ROWS = [
  { id: 'acc_gold', tier: 'gold' },
  { id: 'acc_silver', tier: 'silver' },
];

const dataset = DatasetSchema.parse({
  name: 'deal_pipeline',
  label: 'Deal pipeline',
  object: BASE,
  include: [REF],
  dimensions: [
    { name: 'region', field: 'region', type: 'string' },
    { name: 'account_tier', field: 'account.tier', type: 'string' },
  ],
  measures: [{ name: 'deal_count', aggregate: 'count' }],
});

/** A base-only query: `execute()`'s direct path, one `withReadScope` merge. */
const DIRECT: AnalyticsQuery = { cube: 'deal_pipeline', dimensions: ['region'], measures: ['deal_count'] };
/** A cross-object dimension: `executeCrossObject` + `resolveFkAttr`, two merges. */
const CROSS: AnalyticsQuery = { cube: 'deal_pipeline', dimensions: ['account_tier'], measures: ['deal_count'] };

interface WireBearingError extends Error {
  code?: unknown;
  status?: unknown;
}

const quiet = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return quiet;
  },
};

/**
 * Each row: a scope shape one of the two shared comparand faces refuses, and
 * the policy content its refusal text names. `face` records which of the two
 * the row exercises, so a later edit dropping one face's call shows up as a
 * block of red rows rather than a single one.
 */
const REFUSED_SCOPES: Array<{ name: string; face: 'shape' | 'type'; scope: unknown; secrets: string[] }> = [
  {
    name: 'a list in the implicit equality slot',
    face: 'shape',
    scope: { region: ['emea', 'restricted_apac'] },
    secrets: ['region', 'restricted_apac'],
  },
  {
    name: 'a list under $eq',
    face: 'shape',
    scope: { region: { $eq: ['emea', 'restricted_apac'] } },
    secrets: ['region', 'restricted_apac'],
  },
  {
    name: 'a scalar under $in',
    face: 'shape',
    scope: { region: { $in: 'restricted_emea' } },
    secrets: ['region', 'restricted_emea'],
  },
  {
    name: 'a scalar under $nin',
    face: 'shape',
    scope: { region: { $nin: 'restricted_emea' } },
    secrets: ['region', 'restricted_emea'],
  },
  {
    name: 'a one-bound $between',
    face: 'shape',
    scope: { amount: { $between: [424242] } },
    secrets: ['amount', '424242'],
  },
  {
    name: 'a null member in $in',
    face: 'shape',
    scope: { region: { $in: [null, 'restricted_emea'] } },
    secrets: ['region'],
  },
  {
    name: 'a list shape nested in an $or beside a well-formed arm',
    face: 'shape',
    scope: { $or: [{ owner: 'u_me' }, { region: ['emea', 'restricted_apac'] }] },
    secrets: ['region', 'restricted_apac'],
  },
  {
    name: 'a plain-object member in $in',
    face: 'type',
    scope: { region: { $in: [{ restricted_key: 1 }] } },
    secrets: ['region', 'restricted_key'],
  },
  {
    name: 'a plain-object comparand under $eq',
    face: 'type',
    scope: { region: { $eq: { restricted_key: 1 } } },
    secrets: ['region', 'restricted_key'],
  },
  {
    name: 'an undefined comparand',
    face: 'type',
    scope: { region: { $eq: undefined } },
    secrets: ['region'],
  },
];

function assertWithheldServerFault(err: WireBearingError | undefined, secrets: string[]): void {
  expect(err, 'the scope must be refused').toBeInstanceOf(Error);
  expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
  expect(err?.status).toBe(500);
  // The reads every analytics HTTP door takes before relaying prose: a
  // producer-declared 5xx that is not a declared refusal ⇒ withheld.
  expect(serverFaultProvenance(resolveThrownHttpError(err, 500))).toBe('declared');
  expect(declaredRefusalMessage(err)).toBeUndefined();
  // …and the detail is RELOCATED, not deleted: the operator's log still has it.
  for (const secret of secrets) expect(String(err?.message)).toContain(secret);
}

describe('[#19995] ObjectQL execute face — a read scope the engine refuses is a withheld server fault', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  let service: AnalyticsService;
  /** Swapped per case; the `getReadScope` contract filled by hand. */
  let scopes: Record<string, unknown> = {};

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

    const compiled = compileDataset(dataset);
    const config: AnalyticsServiceConfig = {
      cubes: [compiled.cube],
      logger: quiet,
      // ObjectQL only — the face `compileScopedFilterToSql` never sees.
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      getAllowedRelationships: () => compiled.allowedRelationships,
      getReadScope: (object: string) => (scopes[object] ?? undefined) as FilterCondition | undefined,
      // The auto-bridge's own mapping (`plugin.ts`): `filter` → `where`,
      // `method` → `function`. The filter travels verbatim, so what answers is
      // the engine's lowering of it.
      executeAggregate: async (objectName, options) =>
        (await engine.aggregate(objectName, {
          where: options.filter,
          groupBy: options.groupBy,
          aggregations: options.aggregations?.map((a) => ({
            function: a.method,
            field: a.field,
            alias: a.alias,
            ...(a.filter ? { filter: a.filter } : {}),
          })),
          timezone: options.timezone,
          context: options.context,
        } as never)) as Record<string, unknown>[],
    };
    service = new AnalyticsService(config);
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  async function outcome(
    query: AnalyticsQuery,
    scopeFor: Record<string, unknown>,
  ): Promise<{ refusal?: WireBearingError; rows?: Record<string, unknown>[] }> {
    scopes = scopeFor;
    try {
      const result = await service.query(query);
      return { rows: result.rows };
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

  describe('the direct path (`execute()` → `withReadScope`)', () => {
    for (const c of REFUSED_SCOPES) {
      it(`${c.name} (${c.face} face) → READ_SCOPE_COMPILE_FAILED / 500, prose withheld`, async () => {
        const { refusal, rows } = await outcome(DIRECT, { [BASE]: c.scope });
        expect(rows, 'a scope the engine cannot run must not be served').toBeUndefined();
        assertWithheldServerFault(refusal, c.secrets);
      });
    }

    it('a well-formed caller `where` beside a refused scope → still the scope’s withheld 500', async () => {
      const { refusal } = await outcome(
        { ...DIRECT, where: { owner: 'u_me' } } as AnalyticsQuery,
        { [BASE]: { region: ['emea', 'restricted_apac'] } },
      );
      assertWithheldServerFault(refusal, ['region', 'restricted_apac']);
    });
  });

  describe('the cross-object path', () => {
    it('a refused BASE scope (`executeCrossObject` → `withReadScope`) → withheld 500', async () => {
      const { refusal, rows } = await outcome(CROSS, { [BASE]: { region: ['emea', 'restricted_apac'] } });
      expect(rows).toBeUndefined();
      assertWithheldServerFault(refusal, ['region', 'restricted_apac']);
    });

    it('a refused REFERENCED-object scope (`resolveFkAttr`) → withheld 500', async () => {
      const { refusal, rows } = await outcome(CROSS, { [REF]: { tier: { $eq: ['gold', 'restricted_tier'] } } });
      expect(rows).toBeUndefined();
      assertWithheldServerFault(refusal, ['tier', 'restricted_tier']);
    });

    it('CONTROL: a well-formed referenced-object scope buckets what it hides as restricted', async () => {
      const { refusal, rows } = await outcome(CROSS, { [REF]: { tier: 'gold' } });
      expect(refusal).toBeUndefined();
      expect(counts(rows, 'account_tier')).toEqual({ gold: 2, '(restricted)': 1 });
    });
  });

  describe('controls — what must NOT move', () => {
    it('a well-formed scope is served with exactly its rows', async () => {
      const { refusal, rows } = await outcome(DIRECT, { [BASE]: { region: { $in: ['emea', 'amer'] } } });
      expect(refusal).toBeUndefined();
      expect(counts(rows, 'region')).toEqual({ emea: 1, amer: 1 });
    });

    it('a cross-field scope (#7598 Q1 = B) is still served on this face — the faces step around `{ $field }`', async () => {
      const { refusal, rows } = await outcome(DIRECT, { [BASE]: { amount: { $gt: { $field: 'budget' } } } });
      expect(refusal).toBeUndefined();
      expect(counts(rows, 'region')).toEqual({ emea: 1, amer: 1 });
    });

    it('an emptied `$in` at even polarity beside an own-rows grant (#13570) is still served', async () => {
      const { refusal, rows } = await outcome(DIRECT, {
        [BASE]: { $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] },
      });
      expect(refusal).toBeUndefined();
      expect(counts(rows, 'region')).toEqual({ emea: 1, amer: 1 });
    });

    it('the caller’s own `where`, refused by the ENGINE, stays INVALID_FILTER / 400 with its message', async () => {
      // This shape passes the analytics `where` door and is refused by the
      // engine's shape face — the same face the scope guard calls. A blanket
      // catch around `executeAggregate` would turn this 400 into a 500.
      const { refusal } = await outcome(
        { ...DIRECT, where: { region: { $in: [null, 'emea'] } } } as AnalyticsQuery,
        { [BASE]: { owner: 'u_me' } },
      );
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal?.code).toBe('INVALID_FILTER');
      expect(refusal?.status).toBe(400);
      expect(String(refusal?.message)).toContain('region');
      expect(serverFaultProvenance(resolveThrownHttpError(refusal, 500))).toBeUndefined();
    });

    it('the caller’s own `where` with the scope’s refused shape stays INVALID_FILTER / 400 with its message', async () => {
      const { refusal } = await outcome(
        { ...DIRECT, where: { region: ['emea', 'apac'] } } as AnalyticsQuery,
        { [BASE]: { owner: 'u_me' } },
      );
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal?.code).toBe('INVALID_FILTER');
      expect(refusal?.status).toBe(400);
      expect(String(refusal?.message)).toContain('region');
    });
  });
});
