// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14329] The FOURTH read-scope door — `AnalyticsServicePlugin`'s
 * `fetchRecordLabels` hook — answers the same verdict as the other three.
 *
 * #13640 guarded the ObjectQL ENGINE merge and #13926 the `/analytics/sql`
 * ECHO merge plus `NativeSQLStrategy.applyReadScope`; the three-faces file
 * next door pins those. This hook is a FOURTH consumer of the very same
 * `readScopeProvider` output, reached by a different route entirely
 * (`AnalyticsService.queryDataset` → `resolveScope` → `dimension-labels.ts` →
 * `DimensionLabelDeps.fetchRecordLabels`, the closure `plugin.ts` builds), and
 * it met NEITHER `compileScopedFilterToSql` nor `assertReadScopeCannotVacate`:
 * it `$and`s the REFERENCED object's scope with `id $in [...]` and hands that
 * straight to `executeAggregate`.
 *
 * So a vacating scope spelling from an out-of-repo `getReadScope` producer
 * (`StrategyContext.getReadScope` is a spec contract — that population is
 * exactly who this contract exists for, and the one with no producer-side
 * #13570 guard) let this per-record read run effectively unscoped for the ids
 * in hand, surfacing the display names the referenced object's RLS exists to
 * hide. The leak is row-granular by construction: `group by (id, name)` is a
 * record read dressed as an aggregate.
 *
 * ## What is measured here, and what is NOT
 *
 * These cases drive the REAL plugin wiring — `new AnalyticsServicePlugin(...).init(ctx)`
 * — so the closure under test is the one `plugin.ts` actually ships, not a
 * stub standing in for it. What they do NOT re-measure is the ENGINE's
 * lowering of a vacating scope: that table (which spellings come back with the
 * whole table, driven against a real `SqliteWasmDriver`) is
 * `read-scope-vacancy-three-faces.test.ts`'s, and re-deriving it here would be
 * a second copy of one ruling. The fixture engine below therefore honours the
 * filter it is handed by a small, deliberately obvious evaluator — which is
 * the right authority for THIS seam's question: *does the hook forward a scope
 * that a scope-honouring engine can narrow by, and does it refuse the
 * spellings that cannot narrow anything at all?*
 *
 * ## Two label passes, two DIFFERENT dispositions — both fail closed
 *
 * A refusal from this hook surfaces differently depending on which of
 * `queryDataset`'s two label passes raised it, and both are asserted below
 * because a reader who checks only one will conclude the other is unguarded:
 *
 *   - **sort-key pass** (`order` on a lookup dimension, #3680) runs inside
 *     `DatasetExecutor.execute`, whose catch in `queryDataset` re-throws a
 *     DECLARED ADR-0112 envelope untouched (`hasDeclaredErrorEnvelope`). The
 *     refusal reaches the caller as itself — `READ_SCOPE_COMPILE_FAILED` / 500.
 *   - **display pass** (#3602) is wrapped in its own try/catch that degrades to
 *     a `warn` and leaves raw ids rendering. That is not this card weakening:
 *     it is the disposition #3602 already chose for this surface one frame up
 *     (`dimension-labels.ts` skips a dimension's labels rather than fetch
 *     unscoped when the scope cannot be resolved), and it is fail-CLOSED — no
 *     name is fetched, so none can leak.
 *
 * The security property is therefore identical on both passes and is asserted
 * as such: **the referenced object is never read at all**. A bare "it threw"
 * would not distinguish that from a read that happened and then threw.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { FilterCondition } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const CTX = { tenantId: 'org_A', userId: 'u_me' } as ExecutionContext;

/** Tasks grouped by a lookup dimension whose target is `crm_account`. */
const DATASET = DatasetSchema.parse({
  name: 'tasks_by_account',
  label: 'Tasks by account',
  object: 'task',
  dimensions: [{ name: 'account', field: 'account', type: 'lookup', label: 'Account' }],
  measures: [{ name: 'cnt', aggregate: 'count' }],
});

/**
 * Referenced-object fixture rows. `organization_id` is what an ordinary
 * tenant scope narrows by; `owner` is what the emptied-membership spellings
 * address. `acc2` is the row an ordinary `org_A` scope must NOT surface.
 */
const ACCOUNTS = [
  { id: 'acc1', name: 'Acme Corp', organization_id: 'org_A', owner: 'u_me' },
  { id: 'acc2', name: 'Umbrella Ltd', organization_id: 'org_B', owner: 'u_other' },
];

/** The grouped base aggregate: both FK ids reach the label pass. */
const TASK_ROWS = [
  { account: 'acc1', cnt: 3 },
  { account: 'acc2', cnt: 1 },
];

/**
 * A deliberately small filter evaluator for the FIXTURE rows — equality,
 * `$in`, `$and`, `$or`. It exists so "an ordinary scope still narrows" and
 * "`$in: []` still reduces to zero rows" are read off real returned rows
 * rather than off the filter object, which would only echo the assertion.
 *
 * ⛔ Not an engine-lowering model, and not where a vacating spelling's row
 * consequence is established: an unrecognised operator throws rather than
 * quietly matching, so a spelling this cannot judge fails loudly instead of
 * manufacturing a comfortable answer. The measured lowering table lives in
 * `read-scope-vacancy-three-faces.test.ts`, against a real driver.
 */
function matches(row: Record<string, unknown>, filter: unknown): boolean {
  if (filter == null) return true;
  if (typeof filter !== 'object' || Array.isArray(filter)) {
    throw new Error(`[fixture] not a filter node: ${JSON.stringify(filter)}`);
  }
  return Object.entries(filter as Record<string, unknown>).every(([key, value]) => {
    if (key === '$and') return (value as unknown[]).every((n) => matches(row, n));
    if (key === '$or') return (value as unknown[]).some((n) => matches(row, n));
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const ops = Object.entries(value as Record<string, unknown>);
      return ops.every(([op, comparand]) => {
        if (op === '$in') return (comparand as unknown[]).includes(row[key]);
        throw new Error(`[fixture] unsupported operator ${op} — this evaluator judges no spelling it was not written for`);
      });
    }
    return row[key] === value;
  });
}

type EngineCall = { object: string; where?: Record<string, unknown> };

function fakePluginContext(services: Record<string, unknown>) {
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

const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });

/**
 * Drive the label path through the real plugin wiring.
 *
 * `order` selects WHICH label pass runs: with it, the sort-key pass (#3680)
 * resolves labels inside `DatasetExecutor.execute`; without it, only the
 * display pass (#3602) does. The two have different refusal dispositions, so
 * every case below states which one it is exercising.
 */
async function runLabels(opts: { scope: FilterCondition | undefined; order?: boolean }) {
  const seen: EngineCall[] = [];
  const engine = {
    aggregate: async (object: string, options: Record<string, unknown>) => {
      seen.push({ object, where: options.where as Record<string, unknown> | undefined });
      if (object === 'task') return TASK_ROWS;
      return ACCOUNTS.filter((r) => matches(r, options.where)).map((r) => ({ id: r.id, name: r.name, _c: 1 }));
    },
    getObject: (name: string) =>
      name === 'task'
        ? { fields: { account: { type: 'lookup', reference: 'crm_account' } } }
        : name === 'crm_account'
          ? { fields: { name: { type: 'text' } } }
          : undefined,
  };
  const { ctx, registered, warn } = fakePluginContext({ data: engine });

  await new AnalyticsServicePlugin({
    queryCapabilities: objectqlOnly,
    getReadScope: (object: string) => (object === 'crm_account' ? opts.scope : undefined),
  }).init(ctx as never);

  const run = () =>
    (registered.analytics as AnalyticsService).queryDataset(
      DATASET as never,
      {
        dimensions: ['account'],
        measures: ['cnt'],
        ...(opts.order ? { order: { account: 'asc' } } : {}),
      } as never,
      CTX,
    );

  return { run, seen, warn };
}

/** Did anything read the REFERENCED object? The security question, directly. */
const readReferenced = (seen: EngineCall[]) => seen.filter((c) => c.object === 'crm_account');

/**
 * The vacating family, as measured in `read-scope-sql.ts`'s #13640 section:
 * every one of these came back with the whole table from a real engine.
 * `$nin: []` is refused at any polarity (matching `compileOperator`'s own
 * `$nin` arm); the rest are emptied POSITIVE memberships under an odd number
 * of negations, which is what makes them vacate.
 */
const VACATING: Array<[string, FilterCondition]> = [
  ['empty $nin', { owner: { $nin: [] } } as FilterCondition],
  ['$not over empty $in', { $not: { owner: { $in: [] } } } as FilterCondition],
  ['$not over a bare empty array', { $not: { owner: [] } } as FilterCondition],
  ['$not over a multi-key operator object holding an empty $in', { $not: { owner: { $in: [], $ne: 'u_other' } } } as FilterCondition],
  ['a vacating arm inside an $or', { $or: [{ $not: { owner: { $in: [] } } }, { owner: 'u_me' }] } as FilterCondition],
];

describe('#14329 — a vacating referenced-object scope is refused before the label lookup runs', () => {
  it.each(VACATING)('sort-key pass: %s refuses in the sibling envelope', async (_name, scope) => {
    const { run, seen } = await runLabels({ scope, order: true });

    // ADR-0112 envelope, `code` AND `status` — the same two the three sibling
    // faces answer with. A bare `toThrow` would stay green against a driver
    // throwing a naked `Error`, which is the failure this assertion exists to
    // exclude.
    const err = await run().then(
      () => { throw new Error('expected a refusal, got a result'); },
      (e: unknown) => e as { code?: unknown; status?: unknown; message?: string },
    );
    expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err.status).toBe(500);
    expect(String(err.message)).toContain('read scope for "crm_account"');

    // The other half of a refusal pin: the referenced object was NEVER read.
    // "It threw" alone does not distinguish a guard from a leak followed by a
    // throw — and the leak is precisely a read that happened.
    expect(readReferenced(seen)).toEqual([]);
    // The base aggregate still ran: the refusal is scoped to the label door.
    expect(seen.map((c) => c.object)).toEqual(['task']);
  });

  it.each(VACATING)('display pass: %s fails closed to raw ids without reading the target', async (_name, scope) => {
    const { run, seen, warn } = await runLabels({ scope });

    // The display pass has its own catch (analytics-service.ts) that degrades
    // to a warn — the #3602 disposition for this surface. So the CALLER sees
    // rows, and what matters is that no name was fetched to put in them.
    const result = await run() as unknown as { rows: Record<string, unknown>[] };
    expect(readReferenced(seen)).toEqual([]);
    expect(result.rows.map((r) => r.account)).toEqual(['acc1', 'acc2']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dimension label resolution failed'));
  });
});

describe('#14329 over-denial controls — the guard refuses ONLY the vacating shapes', () => {
  it('an ordinary referenced-object scope still narrows the label lookup', async () => {
    const { run, seen } = await runLabels({ scope: { organization_id: 'org_A' } as FilterCondition });

    const result = await run() as unknown as { rows: Record<string, unknown>[] };

    // Preservation pin — the scope reached the engine `$and`-composed with the
    // id filter, never key-merged, so it cannot be displaced by the ids.
    const labelCall = readReferenced(seen);
    expect(labelCall).toHaveLength(1);
    expect(labelCall[0].where).toEqual({
      $and: [{ id: { $in: ['acc1', 'acc2'] } }, { organization_id: 'org_A' }],
    });

    // ...and the NARROWED RESULT SET, not merely "no throw": `acc1` is in the
    // tenant and renders its name; `acc2` is out and keeps its raw id, which is
    // the whole point of scoping this read.
    expect(result.rows.map((r) => r.account)).toEqual(['Acme Corp', 'acc2']);
  });

  it('the `$in: []` zero-rows reduction still yields no labels and no refusal', async () => {
    // Positive polarity: the ruled #5322/#5243 reduction to constant FALSE.
    // Narrowing at its own arm — the SAFE direction on a read scope — and
    // deliberately NOT refused, here or at any sibling door.
    const { run, seen } = await runLabels({ scope: { owner: { $in: [] } } as FilterCondition });

    const result = await run() as unknown as { rows: Record<string, unknown>[] };

    expect(readReferenced(seen)).toHaveLength(1);
    expect(readReferenced(seen)[0].where).toEqual({
      $and: [{ id: { $in: ['acc1', 'acc2'] } }, { owner: { $in: [] } }],
    });
    // Zero rows came back, so no label overwrites a raw id — and no refusal.
    expect(result.rows.map((r) => r.account)).toEqual(['acc1', 'acc2']);
  });

  it('the live #13570 RLS composite keeps own rows flowing', async () => {
    // `{ $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] }` — an emptied
    // membership beside an own-rows grant, which the RLS compiler really emits
    // when a membership set resolves empty. Refusing it would 500 every
    // analytics query for such a user, the outcome #13571's verdict rejected.
    const { run, seen } = await runLabels({
      scope: { $or: [{ owner: { $in: [] } }, { owner: 'u_me' }] } as FilterCondition,
    });

    const result = await run() as unknown as { rows: Record<string, unknown>[] };

    expect(readReferenced(seen)).toHaveLength(1);
    expect(result.rows.map((r) => r.account)).toEqual(['Acme Corp', 'acc2']);
  });

  it('no scope at all still reads the target, unchanged', async () => {
    // The `undefined` arm — "no scope for this object" is a legitimate answer
    // from the provider contract, and the guard must not turn it into a
    // refusal. Without this case a guard that refused everything would pass
    // every refusal assertion above.
    const { run, seen } = await runLabels({ scope: undefined });

    const result = await run() as unknown as { rows: Record<string, unknown>[] };

    expect(readReferenced(seen)).toHaveLength(1);
    expect(readReferenced(seen)[0].where).toEqual({ id: { $in: ['acc1', 'acc2'] } });
    expect(result.rows.map((r) => r.account)).toEqual(['Acme Corp', 'Umbrella Ltd']);
  });
});
