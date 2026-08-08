// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import { compileDataset } from '../dataset-compiler.js';

/** A representative dataset: revenue by account.region (the ADR headline case). */
const salesDataset = DatasetSchema.parse({
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  include: ['account'],
  filter: { is_deleted: { $ne: true } },
  dimensions: [
    { name: 'region', label: 'Region', field: 'account.region', type: 'string' },
    { name: 'close_month', label: 'Close Month', field: 'close_date', type: 'date', dateGranularity: 'month' },
  ],
  measures: [
    { name: 'revenue', label: 'Revenue', aggregate: 'sum', field: 'amount', format: '$0,0.00' },
    { name: 'deal_count', label: 'Deals', aggregate: 'count' },
    { name: 'won_amount', label: 'Won', aggregate: 'sum', field: 'amount', filter: { stage: 'won' } },
    { name: 'win_rate', label: 'Win Rate', aggregate: 'sum', derived: { op: 'ratio', of: ['won_amount', 'revenue'] } },
  ],
});

describe('compileDataset', () => {
  it('compiles a dataset to a Cube with dimensions and measures', () => {
    const { cube } = compileDataset(salesDataset);
    expect(cube.name).toBe('sales');
    expect(cube.sql).toBe('opportunity');

    // Dimension with a relationship path keeps the dotted sql for the join machinery.
    expect(cube.dimensions.region.sql).toBe('account.region');
    expect(cube.dimensions.region.type).toBe('string');

    // Date dimension maps to a `time` Cube dimension with the declared granularity.
    expect(cube.dimensions.close_month.type).toBe('time');
    expect(cube.dimensions.close_month.granularities).toEqual(['month']);

    // sum measure → metric sql is the field; format carried.
    expect(cube.measures.revenue.type).toBe('sum');
    expect(cube.measures.revenue.sql).toBe('amount');
    expect(cube.measures.revenue.format).toBe('$0,0.00');

    // count with no field → sql '*'.
    expect(cube.measures.deal_count.type).toBe('count');
    expect(cube.measures.deal_count.sql).toBe('*');
  });

  it('exposes the declared relationships as the join allowlist (D-C)', () => {
    const { allowedRelationships } = compileDataset(salesDataset);
    expect(allowedRelationships.has('account')).toBe(true);
    expect(allowedRelationships.size).toBe(1);
  });

  it('carries dataset-level and per-measure filters separately', () => {
    const { filter, measureFilters } = compileDataset(salesDataset);
    expect(filter).toEqual({ is_deleted: { $ne: true } });
    expect(measureFilters.won_amount).toEqual({ stage: 'won' });
  });

  it('extracts derived measures into the sidecar (not as Cube metrics)', () => {
    const { cube, derived } = compileDataset(salesDataset);
    expect(cube.measures.win_rate).toBeUndefined();
    expect(derived).toEqual([{ name: 'win_rate', op: 'ratio', of: ['won_amount', 'revenue'] }]);
  });

  it('rejects a dotted field that traverses an undeclared relationship (D-C)', () => {
    const bad = DatasetSchema.parse({
      name: 'bad',
      label: 'Bad',
      object: 'opportunity',
      include: [], // owner did NOT declare `account`
      dimensions: [{ name: 'region', field: 'account.region' }],
      measures: [{ name: 'cnt', aggregate: 'count' }],
    });
    expect(() => compileDataset(bad)).toThrowError(/not declared in the dataset's `include`/);
  });

  it('validates declared relationships against the object graph when a resolver is given', () => {
    const resolver = (obj: string, rel: string) => (obj === 'opportunity' && rel === 'account' ? 'account' : undefined);
    expect(() => compileDataset(salesDataset, resolver)).not.toThrow();

    const withBadInclude = DatasetSchema.parse({ ...salesDataset, include: ['nonexistent'] });
    expect(() => compileDataset(withBadInclude, resolver)).toThrowError(/does not exist on object/);
  });

  it('emits cube.joins with the resolved TARGET TABLE (alias ≠ table for namespaced objects)', () => {
    // lookup field `account` on `opportunity` references object `crm_account`.
    const resolver = (obj: string, rel: string) =>
      obj === 'opportunity' && rel === 'account' ? 'crm_account' : undefined;
    const { cube } = compileDataset(salesDataset, resolver);
    expect(cube.joins?.account?.name).toBe('crm_account');
  });

  it('without a resolver, falls back to the relationship name as the join table', () => {
    const { cube } = compileDataset(salesDataset);
    expect(cube.joins?.account?.name).toBe('account');
  });

  // Was: "rejects v1-unsupported aggregates with a clear error", driven by
  // `array_agg` reaching `compileDataset`. #6188 retired `array_agg` and
  // `string_agg` from `AggregationFunction`, so that input cannot be built any
  // more — the refusal moved from this compiler to the schema, and it now
  // carries a prescription instead of naming the supported list. Re-pointed
  // rather than deleted: the dataset measure is one of the retirement's two
  // authoring surfaces, and this is where that surface is exercised.
  it('rejects a retired aggregate at the schema, with the retirement prescription', () => {
    expect(() => DatasetSchema.parse({
      name: 'agg',
      label: 'Agg',
      object: 'opportunity',
      dimensions: [],
      measures: [{ name: 'tags', aggregate: 'array_agg', field: 'tag' }],
    })).toThrowError(/`array_agg`.*was removed.*#6188/s);
  });

  it('still compiles the aggregate the ruling kept', () => {
    const ds = DatasetSchema.parse({
      name: 'agg',
      label: 'Agg',
      object: 'opportunity',
      dimensions: [],
      measures: [{ name: 'tags', aggregate: 'count_distinct', field: 'tag' }],
    });
    expect(compileDataset(ds).cube.measures.tags?.type).toBe('count_distinct');
  });
});

describe('compileDataset — multi-hop joins (ADR-0071)', () => {
  /** opportunity → account (crm_account) → owner (core_user). All to-one. */
  const chainResolver = (obj: string, rel: string) => {
    const graph: Record<string, Record<string, { object: string; table: string }>> = {
      opportunity: { account: { object: 'account', table: 'crm_account' } },
      account: { owner: { object: 'user', table: 'core_user' } },
    };
    return graph[obj]?.[rel];
  };

  const twoHop = () =>
    DatasetSchema.parse({
      name: 'sales_by_owner_region',
      label: 'Sales by owner region',
      object: 'opportunity',
      include: ['account', 'account.owner'],
      dimensions: [
        { name: 'owner_region', label: 'Owner Region', field: 'account.owner.region', type: 'string' },
      ],
      measures: [{ name: 'revenue', label: 'Revenue', aggregate: 'sum', field: 'amount' }],
    });

  it('emits one join per path prefix, keyed by the full dotted path', () => {
    const { cube } = compileDataset(twoHop(), chainResolver);
    expect(cube.joins?.['account']?.name).toBe('crm_account');
    expect(cube.joins?.['account__owner']?.name).toBe('core_user');
    // The deepest dimension keeps its full dotted sql for the strategy.
    expect(cube.dimensions.owner_region.sql).toBe('account.owner.region');
  });

  it('allowlist is every prefix alias (declared path + intermediates)', () => {
    const { allowedRelationships } = compileDataset(twoHop(), chainResolver);
    expect(allowedRelationships.has('account')).toBe(true);
    expect(allowedRelationships.has('account__owner')).toBe(true);
    expect(allowedRelationships.size).toBe(2);
  });

  it('auto-includes the intermediate hop when only the deep path is declared', () => {
    const ds = DatasetSchema.parse({
      name: 'deep_only',
      label: 'Deep only',
      object: 'opportunity',
      include: ['account.owner'], // intermediate `account` NOT explicitly declared
      dimensions: [{ name: 'owner_region', field: 'account.owner.region', type: 'string' }],
      measures: [{ name: 'cnt', aggregate: 'count' }],
    });
    const { cube, allowedRelationships } = compileDataset(ds, chainResolver);
    expect(cube.joins?.['account']?.name).toBe('crm_account'); // auto-added intermediate
    expect(cube.joins?.['account__owner']?.name).toBe('core_user');
    expect(allowedRelationships.size).toBe(2);
  });

  it('rejects an include path beyond the 3-hop cap at parse time (spec refine)', () => {
    expect(() =>
      DatasetSchema.parse({
        name: 'too_deep',
        label: 'Too deep',
        object: 'opportunity',
        include: ['a.b.c.d'], // 4 hops
        dimensions: [{ name: 'deep_name', field: 'a.b.c.d.name' }],
        measures: [{ name: 'cnt', aggregate: 'count' }],
      }),
    ).toThrowError(/3-hop limit/);
  });

  it('the compiler also rejects an over-deep include path (defense in depth)', () => {
    // Bypass the spec refine to exercise the compiler's OWN guard (for datasets
    // built programmatically, not parsed through the schema).
    const raw = {
      name: 'too_deep',
      label: 'Too deep',
      object: 'opportunity',
      include: ['a.b.c.d'],
      dimensions: [{ name: 'deep_name', label: 'Deep', type: 'string', field: 'a.b.c.d.name' }],
      measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
    } as unknown as Parameters<typeof compileDataset>[0];
    expect(() => compileDataset(raw)).toThrowError(/exceeds the 3-hop limit/);
  });

  it('rejects a deep field whose relationship path was not declared (D-C)', () => {
    const bad = DatasetSchema.parse({
      name: 'bad_deep',
      label: 'Bad deep',
      object: 'opportunity',
      include: ['account'], // declared `account` but NOT `account.owner`
      dimensions: [{ name: 'owner_region', field: 'account.owner.region' }],
      measures: [{ name: 'cnt', aggregate: 'count' }],
    });
    expect(() => compileDataset(bad, chainResolver)).toThrowError(/relationship path "account.owner".*not declared/s);
  });

  it('accepts a resolver that returns a bare table string (object assumed equal)', () => {
    const ds = DatasetSchema.parse({
      name: 'str_resolver',
      label: 'String resolver',
      object: 'opportunity',
      include: ['account.owner'],
      dimensions: [{ name: 'owner_region', field: 'account.owner.region' }],
      measures: [{ name: 'cnt', aggregate: 'count' }],
    });
    // Legacy string-returning resolver: object name == table name at each hop.
    const stringResolver = (_obj: string, rel: string) => rel;
    const { cube } = compileDataset(ds, stringResolver);
    expect(cube.joins?.['account']?.name).toBe('account');
    expect(cube.joins?.['account__owner']?.name).toBe('owner');
  });
});


/**
 * #5115 — a dataset whose JOIN crosses datasources is metadata that can never
 * execute: the whole dataset is lowered into ONE statement on the base object's
 * datasource (raw SQL routes by object since #5033), so the joined table is
 * simply not there. #5033 made that failure loud at QUERY time, in front of
 * whoever opened the dashboard; this suite pins the same verdict at COMPILE
 * time, while the author (often an AI author) is still holding the metadata.
 *
 * The gate is deliberately narrow, and these cases pin the boundary as much as
 * the rejection: it fires only on a conflict the METADATA PROVES — two explicit,
 * different `object.datasource` bindings — because `'default'` is the schema's
 * default value rather than a routing decision (mapping rules / the ADR-0057
 * lifecycle split / a package's `defaultDatasource` all route objects that
 * never say a word about `datasource`). Everything it cannot prove stays
 * compilable and is caught by #5033's query-time defence.
 */
describe('compileDataset — cross-datasource join gate (#5115)', () => {
  /** opportunity → crm_account → core_user (all to-one). */
  const chainResolver = (obj: string, rel: string) => {
    const graph: Record<string, Record<string, { object: string; table: string }>> = {
      opportunity: { account: { object: 'crm_account', table: 'crm_account' } },
      crm_account: { owner: { object: 'core_user', table: 'core_user' } },
    };
    return graph[obj]?.[rel];
  };

  const datasetWith = (include: string[], dimensions: Record<string, string>[]) =>
    DatasetSchema.parse({
      name: 'revenue_by_region',
      label: 'Revenue by region',
      object: 'opportunity',
      include,
      dimensions: dimensions.map((d) => ({ ...d, type: 'string' })),
      measures: [{ name: 'revenue', label: 'Revenue', aggregate: 'sum', field: 'amount' }],
    });

  const crossDs = datasetWith(['account'], [{ name: 'region', field: 'account.region' }]);

  /** Compile `crossDs` with a datasource map; returns the thrown error, if any. */
  const compileWith = (
    datasources: Record<string, string | undefined>,
    isExternalObject?: (o: string) => boolean,
  ): Error | undefined => {
    try {
      compileDataset(crossDs, chainResolver, {
        getObjectDatasource: (o) => datasources[o],
        ...(isExternalObject ? { isExternalObject } : {}),
      });
      return undefined;
    } catch (e) {
      return e as Error;
    }
  };

  it('rejects two explicitly-bound objects on different datasources, naming BOTH sides and the fix', () => {
    const err = compileWith({ opportunity: 'billing_db', crm_account: 'crm_db' });

    expect(err).toBeDefined();
    const msg = String(err?.message);
    // Both objects …
    expect(msg).toContain('base object "opportunity"');
    expect(msg).toContain('joined object "crm_account"');
    // … both datasources …
    expect(msg).toContain('datasource "billing_db"');
    expect(msg).toContain('datasource "crm_db"');
    // … the offending include path …
    expect(msg).toContain('"account"');
    // … the rule, and a remedy the author can act on — same wording family as
    // the #5033 query-time diagnostic, so the two never read as two bugs.
    expect(msg).toMatch(/JOIN cannot cross datasources/);
    expect(msg).toMatch(/binding both objects to the same datasource/);
    expect(msg).toMatch(/dropping "account" from the dataset's `include`/);
  });

  it('compiles normally when both sides declare the SAME datasource', () => {
    expect(compileWith({ opportunity: 'crm_db', crm_account: 'crm_db' })).toBeUndefined();
    // …and the join is still emitted, unchanged.
    const { cube } = compileDataset(crossDs, chainResolver, { getObjectDatasource: () => 'crm_db' });
    expect(cube.joins?.account?.name).toBe('crm_account');
  });

  it('compares datasource ids case-insensitively (casing is not two databases)', () => {
    expect(compileWith({ opportunity: 'CRM_DB', crm_account: 'crm_db' })).toBeUndefined();
  });

  // ── "cannot answer, do not block" — the tiering, pinned case by case ───────

  it('a host with NO datasource probe compiles exactly as before', () => {
    // The headline tiering case: an embedding with no data engine passes no
    // options at all, and every dataset it registers must still compile.
    expect(() => compileDataset(crossDs, chainResolver)).not.toThrow();
    expect(() => compileDataset(crossDs, chainResolver, {})).not.toThrow();
    const { cube } = compileDataset(crossDs, chainResolver, {});
    expect(cube.joins?.account?.name).toBe('crm_account');
  });

  it('does not block when the probe cannot place the JOIN TARGET', () => {
    expect(compileWith({ opportunity: 'billing_db', crm_account: undefined })).toBeUndefined();
  });

  it('does not block when the probe cannot place the BASE object', () => {
    // "Cannot answer for the base" must not reject every join — the base is the
    // side every comparison is made against.
    expect(compileWith({ opportunity: undefined, crm_account: 'crm_db' })).toBeUndefined();
  });

  it('treats the DEFAULT binding as unanswered on either side', () => {
    // `datasource: 'default'` is the schema's default VALUE, not a routing
    // decision: `ObjectQL.getDriver` only short-circuits on a name OTHER than
    // 'default', then falls through to datasourceMapping rules, the ADR-0057
    // lifecycle split and the package's defaultDatasource. An object that says
    // 'default' may well be routed elsewhere — and may land on exactly the
    // datasource the other side declares, which is why rejecting here would
    // blank a working dashboard.
    expect(compileWith({ opportunity: 'default', crm_account: 'crm_db' })).toBeUndefined();
    expect(compileWith({ opportunity: 'billing_db', crm_account: 'default' })).toBeUndefined();
    expect(compileWith({ opportunity: 'default', crm_account: 'DEFAULT' })).toBeUndefined();
  });

  it('exempts a FEDERATED join target (ADR-0062 D6 — served by the FK-expand path)', () => {
    // NativeSQLStrategy already declines a cube whose base or joined object is
    // external, so such a query runs on the ObjectQL FK-expand path (two reads
    // joined in memory), which crosses datasources by construction. Rejecting
    // it here would break a path that works today.
    expect(
      compileWith({ opportunity: 'billing_db', crm_account: 'sf_prod' }, (o) => o === 'crm_account'),
    ).toBeUndefined();
  });

  it('exempts a FEDERATED base object', () => {
    expect(
      compileWith({ opportunity: 'sf_prod', crm_account: 'crm_db' }, (o) => o === 'opportunity'),
    ).toBeUndefined();
  });

  // ── which hop gets named ──────────────────────────────────────────────────

  it('names the ONE offending hop when a multi-hop path crosses on its second hop', () => {
    const twoHop = datasetWith(
      ['account', 'account.owner'],
      [{ name: 'owner_region', field: 'account.owner.region' }],
    );
    const datasources: Record<string, string> = {
      opportunity: 'billing_db',
      crm_account: 'billing_db', // first hop stays home …
      core_user: 'identity_db', // … the second one leaves
    };
    let thrown: Error | undefined;
    try {
      compileDataset(twoHop, chainResolver, { getObjectDatasource: (o) => datasources[o] });
    } catch (e) {
      thrown = e as Error;
    }
    const msg = String(thrown?.message);
    expect(msg).toContain('joined object "core_user"');
    expect(msg).toContain('datasource "identity_db"');
    expect(msg).toContain('path "account.owner"');
    // The innocent intermediate hop is not blamed.
    expect(msg).not.toContain('joined object "crm_account"');
  });

  it('rejects only the crossing target when several joins are declared', () => {
    const multi = DatasetSchema.parse({
      name: 'multi',
      label: 'Multi',
      object: 'opportunity',
      include: ['owner', 'account'],
      dimensions: [
        { name: 'owner_name', field: 'owner.name', type: 'string' },
        { name: 'region', field: 'account.region', type: 'string' },
      ],
      measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
    });
    const flatResolver = (obj: string, rel: string) => {
      if (obj !== 'opportunity') return undefined;
      if (rel === 'owner') return { object: 'core_user', table: 'core_user' };
      if (rel === 'account') return { object: 'crm_account', table: 'crm_account' };
      return undefined;
    };
    const datasources: Record<string, string> = {
      opportunity: 'billing_db',
      core_user: 'billing_db', // same datasource — fine
      crm_account: 'crm_db', // the offender
    };
    let thrown: Error | undefined;
    try {
      compileDataset(multi, flatResolver, { getObjectDatasource: (o) => datasources[o] });
    } catch (e) {
      thrown = e as Error;
    }
    expect(String(thrown?.message)).toContain('joined object "crm_account"');
    expect(String(thrown?.message)).not.toContain('core_user');
  });
});
