// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { FilterCondition } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';
import { compileDataset } from '../dataset-compiler.js';
import { DatasetExecutor } from '../dataset-executor.js';

/**
 * R1 integration gate (ADR-0021 D-C).
 *
 * Wires the FULL dataset pipeline — compileDataset → AnalyticsService (with a
 * CONTEXT-AWARE read-scope provider, like the runtime's sharing middleware) →
 * NativeSQLStrategy → read-scope SQL compilation — and proves the cross-object
 * "revenue by account.region" query is tenant-scoped on BOTH the base object
 * (`opportunity`) AND the joined object (`account`), driven by the per-request
 * ExecutionContext threaded through `execute(..., context)`.
 */

const dataset = DatasetSchema.parse({
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  include: ['account'],
  dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount', certified: true }],
});

/**
 * A context-aware read-scope provider that mimics the runtime wiring:
 * RLSCompiler-style output (a FilterCondition) derived from the request's tenant.
 */
function readScope(_object: string, context?: ExecutionContext): FilterCondition | undefined {
  return context?.tenantId ? { organization_id: context.tenantId } : undefined;
}

function makeExecutor(captured: { sql: string; params: unknown[] }[], withScope = true) {
  const compiled = compileDataset(dataset);
  const service = new AnalyticsService({
    cubes: [compiled.cube],
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_obj, sql, params) => { captured.push({ sql, params }); return []; },
    getReadScope: withScope ? readScope : undefined,
    getAllowedRelationships: () => compiled.allowedRelationships,
  });
  return { compiled, executor: new DatasetExecutor(service) };
}

const ctx = (tenantId: string): ExecutionContext => ({ tenantId } as ExecutionContext);

describe('Dataset RLS integration (R1 gate)', () => {
  it('threads the request context and scopes BOTH opportunity and account by tenant', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const { compiled, executor } = makeExecutor(captured);

    await executor.execute(compiled, { dimensions: ['region'], measures: ['revenue'] }, ctx('org_A'));

    expect(captured).toHaveLength(1);
    const { sql, params } = captured[0];
    expect(sql).toMatch(/"opportunity"\."organization_id" = \$\d+/);
    expect(sql).toMatch(/"account"\."organization_id" = \$\d+/);
    expect(params.filter((p) => p === 'org_A')).toHaveLength(2);
  });

  it('the SAME service instance isolates two tenants by context (singleton-safe)', async () => {
    const capA: { sql: string; params: unknown[] }[] = [];
    const { compiled, executor } = makeExecutor(capA);

    await executor.execute(compiled, { dimensions: ['region'], measures: ['revenue'] }, ctx('org_A'));
    await executor.execute(compiled, { dimensions: ['region'], measures: ['revenue'] }, ctx('org_B'));

    expect(capA[0].params).toContain('org_A');
    expect(capA[0].params).not.toContain('org_B');
    expect(capA[1].params).toContain('org_B');
    expect(capA[1].params).not.toContain('org_A');
  });

  it('DEMONSTRATES the leak the hook closes: no context/provider → no tenant predicate', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const { compiled, executor } = makeExecutor(captured, /* withScope */ false);
    await executor.execute(compiled, { dimensions: ['region'], measures: ['revenue'] }, ctx('org_A'));
    expect(captured[0].sql).not.toContain('organization_id');
  });

  it('a provider that returns the RLS deny sentinel scopes to zero rows', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const compiled = compileDataset(dataset);
    const service = new AnalyticsService({
      cubes: [compiled.cube],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async (_o, sql, params) => { captured.push({ sql, params }); return []; },
      getReadScope: () => ({ id: '__rls_deny__:00000000-0000-0000-0000-000000000000' }),
      getAllowedRelationships: () => compiled.allowedRelationships,
    });
    await new DatasetExecutor(service).execute(compiled, { dimensions: ['region'], measures: ['revenue'] });
    // Deny sentinel applied to base + joined object.
    expect(captured[0].sql.match(/__rls_deny__/g) ?? []).toHaveLength(0); // value is parameterized, not inlined
    expect(captured[0].params.filter((p) => String(p).startsWith('__rls_deny__'))).toHaveLength(2);
  });

  it('supports an ASYNC read-scope provider (production security.getReadFilter shape)', async () => {
    // The production bridge resolves RLS from the `security` service, which can
    // hit the DB — i.e. the provider returns a Promise. The service must
    // pre-resolve it before the synchronous SQL builder runs and still scope
    // BOTH base and joined objects by the per-request tenant.
    const captured: { sql: string; params: unknown[] }[] = [];
    const compiled = compileDataset(dataset);
    const asyncReadScope = async (
      _object: string,
      context?: ExecutionContext,
    ): Promise<FilterCondition | undefined> => {
      await Promise.resolve();
      return context?.tenantId ? { organization_id: context.tenantId } : undefined;
    };
    const service = new AnalyticsService({
      cubes: [compiled.cube],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async (_o, sql, params) => { captured.push({ sql, params }); return []; },
      getReadScope: asyncReadScope,
      getAllowedRelationships: () => compiled.allowedRelationships,
    });
    await new DatasetExecutor(service).execute(
      compiled,
      { dimensions: ['region'], measures: ['revenue'] },
      ctx('org_async'),
    );
    expect(captured[0].sql).toMatch(/"opportunity"\."organization_id" = \$\d+/);
    expect(captured[0].sql).toMatch(/"account"\."organization_id" = \$\d+/);
    expect(captured[0].params.filter((p) => p === 'org_async')).toHaveLength(2);
  });

  it('fail-closed: an async provider that REJECTS denies the whole query (no unscoped SQL)', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const compiled = compileDataset(dataset);
    const service = new AnalyticsService({
      cubes: [compiled.cube],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async (_o, sql, params) => { captured.push({ sql, params }); return []; },
      getReadScope: async () => { throw new Error('security service unavailable'); },
      getAllowedRelationships: () => compiled.allowedRelationships,
    });
    await expect(
      new DatasetExecutor(service).execute(compiled, { dimensions: ['region'], measures: ['revenue'] }, ctx('org_A')),
    ).rejects.toThrow(/fail-closed/);
    // Crucially, no SQL was emitted — we denied before building/executing it.
    expect(captured).toHaveLength(0);
  });

  it('rejects the join when the relationship is not declared (defense in depth)', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const compiled = compileDataset(dataset);
    const service = new AnalyticsService({
      cubes: [compiled.cube],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async (_o, sql, params) => { captured.push({ sql, params }); return []; },
      getReadScope: () => ({ organization_id: 'org_A' }),
      getAllowedRelationships: () => new Set<string>(),
    });
    await expect(
      new DatasetExecutor(service).execute(compiled, { dimensions: ['region'], measures: ['revenue'] }),
    ).rejects.toThrow(/not backed by a declared relationship/);
  });
});
