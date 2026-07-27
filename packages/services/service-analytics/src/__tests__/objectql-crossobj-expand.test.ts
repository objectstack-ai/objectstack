// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3654 capability — the ObjectQL path serves an in-envelope cross-object
 * grouping (`account.region`) by FK-expand: group the base aggregate on the
 * lookup FK, resolve the FK to the related attribute with a SCOPED read, and
 * re-bucket in memory. A referenced record the caller cannot read buckets under
 * `(restricted)` — its attribute never leaks, and the grand total is preserved.
 *
 * Out-of-envelope shapes (cross-object measure/filter, multi-hop,
 * non-recombinable measure) stay REJECTED — see objectql-read-scope.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { FilterCondition } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';
import { compileDataset } from '../dataset-compiler.js';

const dataset = DatasetSchema.parse({
  name: 'sales_by_account',
  label: 'Sales by account',
  object: 'opportunity',
  include: ['account'],
  dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

const ctxA = { tenantId: 'org_A', userId: 'u_a' } as ExecutionContext;
const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });

type AggCall = { object: string; groupBy?: unknown; filter?: unknown };

/**
 * Two-call aggregate stub: the base FK grouping on `opportunity`, then the
 * FK→region resolution on the referenced object. `acc_hidden` is deliberately
 * absent from the referenced result (as if RLS hid it) so the row must bucket
 * under `(restricted)`.
 */
function makeService(calls: AggCall[], refObjectName: string) {
  const compiled = compileDataset(dataset);
  const svc = new AnalyticsService({
    cubes: [compiled.cube],
    queryCapabilities: objectqlOnly,
    getReadScope: (o: string): FilterCondition | undefined =>
      o === 'opportunity' ? { organization_id: 'org_A' } : { is_public: true },
    getAllowedRelationships: () => compiled.allowedRelationships,
    executeAggregate: async (object, opts) => {
      calls.push({ object, groupBy: opts.groupBy, filter: opts.filter });
      if (object === 'opportunity') {
        // Base aggregate grouped by the FK column `account`.
        return [
          { account: 'acc_w', revenue: 100 },
          { account: 'acc_e', revenue: 20 },
          { account: 'acc_hidden', revenue: 5 },
        ];
      }
      // Referenced-object resolution: id → region (acc_hidden withheld by scope).
      return [
        { id: 'acc_w', region: 'West' },
        { id: 'acc_e', region: 'East' },
      ];
    },
  });
  return { svc, compiled, refObjectName };
}

describe('ObjectQLStrategy — cross-object FK-expand (#3654)', () => {
  it('groups by the related attribute, bucketing an unreadable ref as (restricted)', async () => {
    const calls: AggCall[] = [];
    const { svc } = makeService(calls, 'account');

    const result = await svc.query(
      { cube: 'sales_by_account', dimensions: ['region'], measures: ['revenue'] },
      ctxA,
    );

    // West=100, East=20, and acc_hidden (unreadable ref) → (restricted)=5.
    const byRegion = Object.fromEntries(result.rows.map((r) => [r.region, r.revenue]));
    expect(byRegion).toEqual({ West: 100, East: 20, '(restricted)': 5 });
    // Grand total conserved — no base row silently dropped.
    expect(result.rows.reduce((s, r) => s + Number(r.revenue), 0)).toBe(125);
  });

  it('scopes BOTH the base aggregate and the FK→attribute resolution', async () => {
    const calls: AggCall[] = [];
    const { svc } = makeService(calls, 'account');
    await svc.query(
      { cube: 'sales_by_account', dimensions: ['region'], measures: ['revenue'] },
      ctxA,
    );

    // Call 1: base grouped by the FK `account`, scoped to opportunity's tenant.
    const base = calls.find((c) => c.object === 'opportunity');
    expect(base?.groupBy).toEqual(['account']);
    expect(JSON.stringify(base?.filter)).toContain('organization_id');

    // Call 2: the referenced object, grouped by (id, region), carrying ITS scope
    // ANDed with the id filter — so a hidden account never yields its region.
    const ref = calls.find((c) => c.object !== 'opportunity');
    expect(ref?.groupBy).toEqual(['id', 'region']);
    expect(JSON.stringify(ref?.filter)).toContain('is_public'); // referenced object's own scope
    expect(JSON.stringify(ref?.filter)).toContain('$in'); // restricted to the FK id set
  });

  it('renders a LEFT JOIN in the previewed SQL for the cross-object dimension', async () => {
    const calls: AggCall[] = [];
    const { svc } = makeService(calls, 'account');
    const { sql } = await svc.generateSql(
      { cube: 'sales_by_account', dimensions: ['region'], measures: ['revenue'] },
      ctxA,
    );
    expect(sql).toMatch(/LEFT JOIN "account" ON "opportunity"\."account" = "account"\."id"/);
    expect(sql).toContain('"account"."region" AS "region"');
  });
});
