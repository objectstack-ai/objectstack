// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19995] The ObjectQL execute face refuses a read scope carrying a filter
 * placeholder the engine cannot resolve in the withheld
 * `READ_SCOPE_COMPILE_FAILED` / 500 envelope — never as the engine's
 * `FILTER_TOKEN_UNKNOWN` / `FILTER_TOKEN_UNRESOLVED` / 400.
 *
 * ## The ruling this holds
 *
 * #5367 (re-affirmed as #7598 Q2 = A), recorded in `read-scope-sql.ts`'s
 * header: a read-scope refusal is a SERVER fault, and its message goes to the
 * operator's log, never into a response. `objectql-read-scope-refusal-envelope.test.ts`
 * pins that for the comparand classes; this file pins it for the placeholder
 * class, the one engine door on this path whose walk this package can reach
 * today (`resolveFilterTokens`, `@objectstack/core` — the function the
 * engine's `resolveWhereTokens` calls).
 *
 * ## What was measured before the fix
 *
 * The engine resolves placeholders on the COMPOSED `where` — after
 * `withReadScope` has `$and`-ed the scope into it — so a scope carrying
 * `{some_token}` came back as the engine's 400, and the HTTP doors relay a
 * 4xx's message: the policy's placeholder, and with it what the policy
 * compares against. The branch's first commit carries the table.
 *
 * ## The judgement is the engine's, so the accept set does not move
 *
 * The scope is judged ALONE at the merge boundary with the same resolver and
 * the same token context the engine builds (`filterTokenContextFrom` over the
 * context `executeAggregate` forwards). A placeholder the engine resolves is
 * resolved here too, so the scope is served — the control below pins that,
 * and it is the pin that goes red if the judgement ever reads a context the
 * engine does not.
 *
 * ⛔ Not a catch around `executeAggregate`: the caller's own `where` keeps its
 * placeholder refusal, answered by the analytics `where` door with its
 * message. The controls pin that, and the caller's own text-operator and
 * temporal refusals, which are the engine's and stay the caller's to read.
 *
 * ## The engine is real, because the refusal under test is the engine's
 *
 * A real `ObjectQL` over `SqliteWasmDriver` (a `SqlDriver`) stands behind
 * `executeAggregate`, bridged the way `AnalyticsServicePlugin`'s auto-bridge
 * bridges it. Every read scope is the `getReadScope` contract filled by hand.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { declaredRefusalMessage, resolveThrownHttpError, serverFaultProvenance } from '@objectstack/types';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { FilterCondition } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
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
  closed_on: { type: 'date', name: 'closed_on' },
  stage: { type: 'text', name: 'stage' },
};
const REF_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  tier: { type: 'text', name: 'tier' },
};

const BASE_ROWS = [
  { id: 'd1', region: 'emea', owner: 'u_me', account: 'acc_gold', amount: 10, closed_on: '2026-01-10', stage: 'open' },
  { id: 'd2', region: 'apac', owner: 'u_other', account: 'acc_silver', amount: 20, closed_on: '2026-02-10', stage: 'won' },
  { id: 'd3', region: 'amer', owner: 'u_me', account: 'acc_gold', amount: 30, closed_on: '2026-03-10', stage: 'lost' },
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

/** A caller with a user and no active organization. */
const MEMBER: ExecutionContext = { userId: 'u_me' } as ExecutionContext;

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
 * Each row: a scope carrying a placeholder the engine's resolver refuses, and
 * the policy content its refusal text names.
 */
const REFUSED_SCOPES: Array<{ name: string; scope: unknown; secrets: string[] }> = [
  {
    name: 'an unknown placeholder in the equality slot',
    scope: { owner: '{restricted_token}' },
    secrets: ['restricted_token'],
  },
  {
    name: 'a near-miss spelling (the resolver suggests the real token)',
    scope: { owner: '{current_user}' },
    secrets: ['current_user'],
  },
  {
    name: 'a brace-wrapped value that is not a token name',
    scope: { stage: { $ne: '{TODAY()}' } },
    secrets: ['TODAY()'],
  },
  {
    name: 'an unknown placeholder as a list member, nested in an $or beside a well-formed arm',
    scope: { $or: [{ owner: 'u_me' }, { region: { $in: ['emea', '{restricted_region}'] } }] },
    secrets: ['restricted_region'],
  },
  {
    name: 'a known placeholder the request context cannot resolve',
    scope: { account: '{current_org_id}' },
    secrets: ['current_org_id'],
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

describe('[#19995] ObjectQL execute face — a read scope carrying a placeholder the engine refuses is a withheld server fault', () => {
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
      // `method` → `function`, and the request context forwarded — the context
      // the engine's own placeholder resolver reads.
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
    context: ExecutionContext = MEMBER,
  ): Promise<{ refusal?: WireBearingError; rows?: Record<string, unknown>[] }> {
    scopes = scopeFor;
    try {
      const result = await service.query(query, context);
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
      it(`${c.name} → READ_SCOPE_COMPILE_FAILED / 500, prose withheld`, async () => {
        const { refusal, rows } = await outcome(DIRECT, { [BASE]: c.scope });
        expect(rows, 'a scope the engine cannot resolve must not be served').toBeUndefined();
        assertWithheldServerFault(refusal, c.secrets);
      });
    }

    it('a well-formed caller `where` beside a refused scope → still the scope’s withheld 500', async () => {
      const { refusal } = await outcome(
        { ...DIRECT, where: { region: 'emea' } } as AnalyticsQuery,
        { [BASE]: { owner: '{restricted_token}' } },
      );
      assertWithheldServerFault(refusal, ['restricted_token']);
    });
  });

  describe('the cross-object path', () => {
    it('a refused BASE scope (`executeCrossObject` → `withReadScope`) → withheld 500', async () => {
      const { refusal, rows } = await outcome(CROSS, { [BASE]: { owner: '{restricted_token}' } });
      expect(rows).toBeUndefined();
      assertWithheldServerFault(refusal, ['restricted_token']);
    });

    it('a refused REFERENCED-object scope (`resolveFkAttr`) → withheld 500', async () => {
      const { refusal, rows } = await outcome(CROSS, { [REF]: { tier: '{restricted_tier}' } });
      expect(rows).toBeUndefined();
      assertWithheldServerFault(refusal, ['restricted_tier']);
    });

    it('CONTROL: a referenced-object scope with a placeholder the context resolves is served', async () => {
      const { refusal, rows } = await outcome(CROSS, { [REF]: { id: { $ne: '{current_user_id}' } } });
      expect(refusal).toBeUndefined();
      expect(counts(rows, 'account_tier')).toEqual({ gold: 2, silver: 1 });
    });
  });

  describe('controls — what must NOT move', () => {
    it('a placeholder the request context resolves is served with exactly its rows', async () => {
      // The engine resolves `{current_user_id}` to `u_me` from the forwarded
      // context. A judgement that read another context — or none — would
      // refuse this scope, which the engine serves.
      const { refusal, rows } = await outcome(DIRECT, { [BASE]: { owner: '{current_user_id}' } });
      expect(refusal).toBeUndefined();
      expect(counts(rows, 'region')).toEqual({ emea: 1, amer: 1 });
    });

    it('a well-formed scope with no placeholder is served with exactly its rows', async () => {
      const { refusal, rows } = await outcome(DIRECT, { [BASE]: { stage: { $in: ['open', 'won'] } } });
      expect(refusal).toBeUndefined();
      expect(counts(rows, 'region')).toEqual({ emea: 1, apac: 1 });
    });

    it('the caller’s own `where` with an unknown placeholder stays FILTER_TOKEN_UNKNOWN / 400 with its message', async () => {
      const { refusal } = await outcome(
        { ...DIRECT, where: { owner: '{caller_token}' } } as AnalyticsQuery,
        { [BASE]: { stage: { $in: ['open', 'won', 'lost'] } } },
      );
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal?.code).toBe('FILTER_TOKEN_UNKNOWN');
      expect(refusal?.status).toBe(400);
      expect(String(refusal?.message)).toContain('caller_token');
      expect(serverFaultProvenance(resolveThrownHttpError(refusal, 500))).toBeUndefined();
    });

    it('the caller’s own `where` with a text operator on a number field stays INVALID_FILTER / 400 with its message', async () => {
      const { refusal } = await outcome(
        { ...DIRECT, where: { amount: { $contains: '7' } } } as AnalyticsQuery,
        { [BASE]: { stage: { $in: ['open', 'won', 'lost'] } } },
      );
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal?.code).toBe('INVALID_FILTER');
      expect(refusal?.status).toBe(400);
      expect(String(refusal?.message)).toContain('amount');
    });

    it('the caller’s own `where` with a temporal comparand the platform cannot read stays INVALID_FILTER / 400 with its message', async () => {
      const { refusal } = await outcome(
        { ...DIRECT, where: { closed_on: { $gte: 'caller-not-a-date' } } } as AnalyticsQuery,
        { [BASE]: { stage: { $in: ['open', 'won', 'lost'] } } },
      );
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal?.code).toBe('INVALID_FILTER');
      expect(refusal?.status).toBe(400);
      expect(String(refusal?.message)).toContain('closed_on');
      expect(String(refusal?.message)).toContain('caller-not-a-date');
    });

    /**
     * The four `driver-sql` refusal doors that read the provenance mark: a
     * scope refused there keeps `INVALID_FILTER` / 400 with no policy content
     * in the message. This card does not move them.
     */
    const DRIVER_WITHHELD: Array<{ name: string; scope: unknown; secrets: string[] }> = [
      { name: 'a column the object does not have', scope: { restricted_col: 'x' }, secrets: ['restricted_col'] },
      { name: 'a retired operator', scope: { stage: { $regex: 'RESTRICTED_RX' } }, secrets: ['RESTRICTED_RX'] },
      { name: 'a combinator with a non-array operand', scope: { $or: { stage: 'RESTRICTED_CB' } }, secrets: ['RESTRICTED_CB'] },
      { name: 'a non-boolean $null', scope: { stage: { $null: 'RESTRICTED_NL' } }, secrets: ['RESTRICTED_NL'] },
    ];
    for (const c of DRIVER_WITHHELD) {
      it(`driver-sql door, ${c.name} → still INVALID_FILTER / 400 with the policy withheld`, async () => {
        const { refusal } = await outcome(DIRECT, { [BASE]: c.scope });
        expect(refusal).toBeInstanceOf(Error);
        expect(refusal?.code).toBe('INVALID_FILTER');
        expect(refusal?.status).toBe(400);
        for (const secret of c.secrets) expect(String(refusal?.message)).not.toContain(secret);
      });
    }
  });
});
