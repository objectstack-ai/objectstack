// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';

/** opportunity cube with a relationship dimension (account.region). */
const cube: Cube = {
  name: 'sales',
  title: 'Sales',
  sql: 'opportunity',
  measures: { revenue: { name: 'revenue', label: 'Revenue', type: 'sum', sql: 'amount' } },
  dimensions: { region: { name: 'region', label: 'Region', type: 'string', sql: 'account.region' } },
  public: false,
};

const query: AnalyticsQuery = {
  cube: 'sales',
  measures: ['revenue'],
  dimensions: ['region'],
  timezone: 'UTC',
};

function ctxWith(overrides: Partial<StrategyContext>): StrategyContext {
  return {
    getCube: (name) => (name === 'sales' ? cube : undefined),
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [],
    ...overrides,
  };
}

describe('NativeSQLStrategy — D-C RLS hardening', () => {
  it('injects the tenant read scope for BOTH the base table and the joined object', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({
      getReadScope: (obj) => ({ organization_id: `org_for_${obj}` }),
      getAllowedRelationships: () => new Set(['account']),
    });

    const { sql, params } = await strategy.generateSql(query, ctx);

    // base table opportunity is scoped
    expect(sql).toContain('"opportunity"."organization_id" =');
    // joined table account is scoped too — this is the bypass that D-C closes
    expect(sql).toContain('"account"."organization_id" =');
    // both tenant params are bound
    expect(params).toContain('org_for_opportunity');
    expect(params).toContain('org_for_account');
  });

  it('rejects a join whose alias is not in the declared relationship allowlist', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({
      // account is NOT allowed → the account.region join must be refused
      getAllowedRelationships: () => new Set<string>(),
    });

    await expect(strategy.generateSql(query, ctx)).rejects.toThrow(
      /join "account" is not backed by a declared relationship/,
    );
  });

  it('allows the join when the relationship is declared', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({ getAllowedRelationships: () => new Set(['account']) });
    const { sql } = await strategy.generateSql(query, ctx);
    expect(sql).toContain('LEFT JOIN "account"');
  });

  it('joins the resolved TARGET TABLE when cube.joins maps alias→table (namespaced)', async () => {
    // alias `account` → table `crm_account` (what the dataset compiler emits).
    const nsCube: Cube = { ...cube, joins: { account: { name: 'crm_account' } } };
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({
      getCube: (n) => (n === 'sales' ? nsCube : undefined),
      getReadScope: (obj) => ({ organization_id: `org:${obj}` }),
      getAllowedRelationships: () => new Set(['account']),
    });
    const { sql, params } = await strategy.generateSql(query, ctx);
    // join targets the real table, aliased to the relationship name
    expect(sql).toContain('LEFT JOIN "crm_account" "account" ON "opportunity"."account" = "account"."id"');
    expect(sql).toContain('"account"."region"');
    // RLS scope for the joined object uses the TARGET object name (crm_account)
    expect(params).toContain('org:crm_account');
    expect(params).toContain('org:opportunity');
  });

  it('is backward-compatible: no scope hooks → no scope predicates, no allowlist check', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({});
    const { sql } = await strategy.generateSql(query, ctx);
    expect(sql).not.toContain('organization_id');
    expect(sql).toContain('LEFT JOIN "account"');
  });

  it('renumbers scope params after existing filter params', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({
      getReadScope: (obj) => (obj === 'opportunity' ? { organization_id: 'org1' } : undefined),
      getAllowedRelationships: () => new Set(['account']),
    });
    const filteredQuery: AnalyticsQuery = { ...query, where: { stage: 'won' } };
    const { sql, params } = await strategy.generateSql(filteredQuery, ctx);
    // filter param bound first ($1), scope param second ($2)
    expect(params).toEqual(['won', 'org1']);
    expect(sql).toContain('$2');
  });
});

describe('NativeSQLStrategy — base-column qualification under joins', () => {
  // Regression: a joined dataset whose base table and joined table share a
  // column name (e.g. `status`) produced `GROUP BY status` → "ambiguous column
  // name" at runtime. Base columns must be qualified with the base table when
  // the cube can join. (Found by dogfooding a joined dataset in Studio.)
  const joinCube: Cube = {
    name: 'sales',
    title: 'Sales',
    sql: 'opportunity',
    measures: { revenue: { name: 'revenue', label: 'Revenue', type: 'sum', sql: 'amount' } },
    dimensions: {
      status: { name: 'status', label: 'Status', type: 'string', sql: 'status' },
      region: { name: 'region', label: 'Region', type: 'string', sql: 'account.region' },
    },
    joins: { account: { name: 'account' } },
    public: false,
  };

  it('qualifies a base-table dimension with the base table when the cube has joins', async () => {
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({
      getCube: (n) => (n === 'sales' ? joinCube : undefined),
      getAllowedRelationships: () => new Set(['account']),
    });
    const q: AnalyticsQuery = { cube: 'sales', measures: ['revenue'], dimensions: ['status', 'region'], timezone: 'UTC' };
    const { sql } = await strategy.generateSql(q, ctx);
    expect(sql).toContain('"opportunity"."status"'); // base column qualified (was bare `status`)
    expect(sql).toContain('"account"."region"');      // relationship column still qualified
    expect(sql).toContain('LEFT JOIN "account"');
    expect(sql).not.toMatch(/GROUP BY\s+status\b/);    // no bare, ambiguous base column
  });

  it('leaves base columns BARE for a single-object cube (no joins) — generated SQL unchanged', async () => {
    const soloCube: Cube = {
      name: 'tasks', title: 'Tasks', sql: 'task',
      measures: { c: { name: 'c', label: 'Count', type: 'count', sql: '*' } },
      dimensions: { status: { name: 'status', label: 'Status', type: 'string', sql: 'status' } },
      public: false,
    };
    const strategy = new NativeSQLStrategy();
    const ctx = ctxWith({ getCube: (n) => (n === 'tasks' ? soloCube : undefined) });
    const q: AnalyticsQuery = { cube: 'tasks', measures: ['c'], dimensions: ['status'], timezone: 'UTC' };
    const { sql } = await strategy.generateSql(q, ctx);
    expect(sql).toContain('GROUP BY status'); // bare — unchanged for single-object cubes
    expect(sql).not.toContain('"task"."status"');
  });
});

describe('NativeSQLStrategy — multi-hop joins (ADR-0071)', () => {
  // opportunity → account (crm_account) → owner (core_user); dimension two hops deep.
  const mhCube: Cube = {
    name: 'sales',
    title: 'Sales',
    sql: 'opportunity',
    measures: { revenue: { name: 'revenue', label: 'Revenue', type: 'sum', sql: 'amount' } },
    dimensions: {
      owner_region: { name: 'owner_region', label: 'Owner Region', type: 'string', sql: 'account.owner.region' },
    },
    joins: {
      account: { name: 'crm_account' },
      'account__owner': { name: 'core_user' },
    },
    public: false,
  };
  const mhQuery: AnalyticsQuery = {
    cube: 'sales',
    measures: ['revenue'],
    dimensions: ['owner_region'],
    timezone: 'UTC',
  };
  const mhCtx = (overrides: Partial<StrategyContext> = {}): StrategyContext => ({
    getCube: (n) => (n === 'sales' ? mhCube : undefined),
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [],
    getAllowedRelationships: () => new Set(['account', 'account__owner']),
    ...overrides,
  });

  it('chains a LEFT JOIN per hop, each aliased by its full path prefix', async () => {
    const { sql } = await new NativeSQLStrategy().generateSql(mhQuery, mhCtx());
    // hop 1: base → account
    expect(sql).toContain('LEFT JOIN "crm_account" "account" ON "opportunity"."account" = "account"."id"');
    // hop 2: account → owner, parent is the hop-1 alias, child alias is the full path
    expect(sql).toContain('LEFT JOIN "core_user" "account__owner" ON "account"."owner" = "account__owner"."id"');
    // the deep column is qualified by the deepest alias
    expect(sql).toContain('"account__owner"."region"');
  });

  it('injects the tenant read scope for the base AND every hop object (per-hop RLS)', async () => {
    const { sql, params } = await new NativeSQLStrategy().generateSql(
      mhQuery,
      mhCtx({ getReadScope: (obj) => ({ organization_id: `org:${obj}` }) }),
    );
    // base + both hop aliases are scoped
    expect(sql).toContain('"opportunity"."organization_id" =');
    expect(sql).toContain('"account"."organization_id" =');
    expect(sql).toContain('"account__owner"."organization_id" =');
    // scope params resolve against each hop's TARGET object (alias → object name)
    expect(params).toContain('org:opportunity');
    expect(params).toContain('org:crm_account');
    expect(params).toContain('org:core_user');
  });

  it('rejects when an intermediate hop is missing from the allowlist', async () => {
    // `account.owner` is registered by the deep dimension but NOT allowed.
    const ctx = mhCtx({ getAllowedRelationships: () => new Set(['account']) });
    await expect(new NativeSQLStrategy().generateSql(mhQuery, ctx)).rejects.toThrow(
      /join "account__owner" is not backed by a declared relationship/,
    );
  });
});
