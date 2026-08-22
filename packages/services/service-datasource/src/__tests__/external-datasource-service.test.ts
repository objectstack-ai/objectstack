// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { IntrospectedSchema } from '@objectstack/spec/contracts';
import {
  ExternalDatasourceService,
  type DatasourceLike,
  type ObjectLike,
} from '../external-datasource-service.js';

/** Build a fake introspected schema for the `warehouse` datasource. */
function warehouseSchema(): IntrospectedSchema {
  return {
    dialect: 'postgres',
    introspectedAt: '2026-05-30T00:00:00.000Z',
    tables: {
      'mart.fact_orders': {
        name: 'mart.fact_orders',
        indexes: [],
        columns: [
          { name: 'order_id', type: 'text', nullable: false, primaryKey: true },
          { name: 'customer_id', type: 'text', nullable: false, primaryKey: false },
          { name: 'amount', type: 'numeric(10,2)', nullable: true, primaryKey: false },
          { name: 'ordered_at', type: 'timestamptz', nullable: true, primaryKey: false },
          { name: 'metadata', type: 'jsonb', nullable: true, primaryKey: false },
          { name: 'geo', type: 'geography', nullable: true, primaryKey: false },
        ],
      },
      'public.dim_customer': {
        name: 'public.dim_customer',
        indexes: [],
        columns: [
          { name: 'id', type: 'text', nullable: false, primaryKey: true },
          { name: 'name', type: 'varchar(255)', nullable: true, primaryKey: false },
        ],
      },
    },
  };
}

function makeService(overrides?: {
  datasource?: DatasourceLike;
  objects?: ObjectLike[];
}) {
  const ds: DatasourceLike = overrides?.datasource ?? {
    name: 'warehouse',
    schemaMode: 'external',
    external: { allowedSchemas: ['mart', 'public'] },
  };
  const objects = overrides?.objects ?? [];
  return new ExternalDatasourceService({
    introspect: async () => warehouseSchema(),
    getDatasource: async (n) => (n === ds.name ? ds : undefined),
    getObject: async (n) => objects.find((o) => o.name === n),
    listObjects: async () => objects,
  });
}

describe('listRemoteTables', () => {
  it('lists tables with parsed schema + column counts', async () => {
    const svc = makeService();
    const tables = await svc.listRemoteTables('warehouse');
    expect(tables).toHaveLength(2);
    const orders = tables.find((t) => t.name === 'fact_orders')!;
    expect(orders.schema).toBe('mart');
    expect(orders.columnCount).toBe(6);
  });

  it('filters by requested schema', async () => {
    const svc = makeService();
    const tables = await svc.listRemoteTables('warehouse', { schema: 'public' });
    expect(tables.map((t) => t.name)).toEqual(['dim_customer']);
  });

  it('respects allowedSchemas', async () => {
    const svc = makeService({
      datasource: { name: 'warehouse', schemaMode: 'external', external: { allowedSchemas: ['mart'] } },
    });
    const tables = await svc.listRemoteTables('warehouse');
    expect(tables.map((t) => t.name)).toEqual(['fact_orders']);
  });
});

describe('generateObjectDraft', () => {
  it('maps columns to field types and flags lossy/unknown for review', async () => {
    const svc = makeService();
    const draft = await svc.generateObjectDraft('warehouse', 'fact_orders');

    expect(draft.name).toBe('fact_orders');
    expect(draft.datasource).toBe('warehouse');
    const fields = draft.definition.fields as Record<string, { type: string; primaryKey?: boolean }>;
    expect(fields.order_id).toEqual({ type: 'text', primaryKey: true });
    expect(fields.amount.type).toBe('number');
    expect(fields.ordered_at.type).toBe('datetime');
    expect(fields.metadata.type).toBe('json');
    // geography is unknown → defaulted to text + review note.
    expect(fields.geo.type).toBe('text');
    expect(draft.review.some((r) => r.column === 'geo')).toBe(true);

    // Source carries the external binding + a REVIEW marker.
    expect(draft.source).toContain("remoteName: 'fact_orders'");
    expect(draft.source).toContain("remoteSchema: 'mart'");
    expect(draft.source).toContain('REVIEW:');
    expect(draft.source).toContain("order_id: { type: 'text', primaryKey: true }");
  });

  it('honours include/exclude/rename/primaryKey options', async () => {
    const svc = makeService();
    const draft = await svc.generateObjectDraft('warehouse', 'fact_orders', {
      includeColumns: ['order_id', 'amount'],
      rename: { amount: 'total' },
      primaryKey: ['order_id'],
    });
    const fields = draft.definition.fields as Record<string, unknown>;
    expect(Object.keys(fields)).toEqual(['order_id', 'total']);
  });

  it('throws when the remote table is missing', async () => {
    const svc = makeService();
    await expect(svc.generateObjectDraft('warehouse', 'nope')).rejects.toThrow(/not found/);
  });
});

describe('importObject', () => {
  /** Build a service with a recording persistObject (runtime metadata store). */
  function makeImporter(persistObject?: (name: string, def: Record<string, unknown>) => Promise<void>) {
    const persisted: Array<{ name: string; def: Record<string, unknown> }> = [];
    const svc = new ExternalDatasourceService({
      introspect: async () => warehouseSchema(),
      getDatasource: async () => ({ name: 'warehouse', schemaMode: 'external' }),
      getObject: async () => undefined,
      listObjects: async () => [],
      persistObject:
        persistObject ?? (async (name, def) => { persisted.push({ name, def }); }),
    });
    return { svc, persisted };
  }

  it('persists a runtime federated object and returns name/definition/review', async () => {
    const { svc, persisted } = makeImporter();
    const result = await svc.importObject('warehouse', 'fact_orders');

    expect(result.name).toBe('fact_orders');
    expect(persisted).toHaveLength(1);
    expect(persisted[0].name).toBe('fact_orders');
    const def = persisted[0].def as { datasource: string; external: { remoteName: string; writable?: boolean } };
    expect(def.datasource).toBe('warehouse');
    expect(def.external.remoteName).toBe('fact_orders');
    // Read-only by default — no writable flag leaks in.
    expect(def.external.writable).toBeUndefined();
    // The geography column surfaced a review note (carried over from the draft).
    expect(result.review.some((r) => r.column === 'geo')).toBe(true);
  });

  it('applies the name override and writable opt-in', async () => {
    const { svc, persisted } = makeImporter();
    const result = await svc.importObject('warehouse', 'fact_orders', {
      name: 'wh_orders',
      writable: true,
    });
    expect(result.name).toBe('wh_orders');
    const def = persisted[0].def as { name: string; label: string; external: { writable?: boolean } };
    expect(def.name).toBe('wh_orders');
    expect(def.label).toBe('Wh Orders');
    expect(def.external.writable).toBe(true);
  });

  it('forwards draft options (include/rename) through to the persisted fields', async () => {
    const { svc, persisted } = makeImporter();
    await svc.importObject('warehouse', 'fact_orders', {
      includeColumns: ['order_id', 'amount'],
      rename: { amount: 'total' },
    });
    const def = persisted[0].def as { fields: Record<string, unknown> };
    expect(Object.keys(def.fields)).toEqual(['order_id', 'total']);
  });

  it('throws when no writable metadata store is wired', async () => {
    const svc = new ExternalDatasourceService({
      introspect: async () => warehouseSchema(),
      getDatasource: async () => ({ name: 'warehouse', schemaMode: 'external' }),
      getObject: async () => undefined,
      listObjects: async () => [],
      // no persistObject
    });
    await expect(svc.importObject('warehouse', 'fact_orders')).rejects.toThrow(
      /writable metadata store/,
    );
  });

  it('throws when the remote table is missing (no persistence)', async () => {
    const { svc, persisted } = makeImporter();
    await expect(svc.importObject('warehouse', 'ghost')).rejects.toThrow(/not found/);
    expect(persisted).toHaveLength(0);
  });
});

describe('validateObject', () => {
  const baseObject: ObjectLike = {
    name: 'wh_order',
    datasource: 'warehouse',
    external: { remoteName: 'fact_orders' },
    fields: {
      order_id: { type: 'text' },
      customer_id: { type: 'text' },
      amount: { type: 'number' },
      ordered_at: { type: 'datetime' },
    },
  };

  it('returns ok for a matching federated object', async () => {
    const svc = makeService({ objects: [baseObject] });
    const result = await svc.validateObject('wh_order');
    expect(result.ok).toBe(true);
    expect(result.diffs).toHaveLength(0);
  });

  it('reports a type_mismatch error for an incompatible field', async () => {
    const svc = makeService({
      objects: [{ ...baseObject, fields: { ...baseObject.fields, amount: { type: 'datetime' } } }],
    });
    const result = await svc.validateObject('wh_order');
    expect(result.ok).toBe(false);
    expect(result.diffs).toContainEqual(
      expect.objectContaining({ kind: 'type_mismatch', column: 'amount', severity: 'error' }),
    );
  });

  it('reports a missing_column error', async () => {
    const svc = makeService({
      objects: [{ ...baseObject, fields: { ...baseObject.fields, nonexistent: { type: 'text' } } }],
    });
    const result = await svc.validateObject('wh_order');
    expect(result.ok).toBe(false);
    expect(result.diffs).toContainEqual(
      expect.objectContaining({ kind: 'missing_column', column: 'nonexistent' }),
    );
  });

  it('reports missing_table when the remote table is absent', async () => {
    const svc = makeService({
      objects: [{ ...baseObject, external: { remoteName: 'ghost' } }],
    });
    const result = await svc.validateObject('wh_order');
    expect(result.ok).toBe(false);
    expect(result.diffs[0].kind).toBe('missing_table');
  });

  it('treats a managed datasource object as nothing-to-validate', async () => {
    const svc = makeService({
      datasource: { name: 'warehouse', schemaMode: 'managed' },
      objects: [baseObject],
    });
    const result = await svc.validateObject('wh_order');
    expect(result.ok).toBe(true);
    expect(result.diffs).toHaveLength(0);
  });

  it('honours columnMap and ignoreColumns', async () => {
    const svc = makeService({
      objects: [
        {
          name: 'wh_order',
          datasource: 'warehouse',
          external: {
            remoteName: 'fact_orders',
            columnMap: { customer_id: 'cust' },
            ignoreColumns: ['metadata'],
          },
          fields: { order_id: { type: 'text' }, cust: { type: 'text' } },
        },
      ],
    });
    const result = await svc.validateObject('wh_order');
    expect(result.ok).toBe(true);
  });

  it('flags a lossy mapping as a warning without failing', async () => {
    const svc = makeService({
      objects: [
        {
          name: 'wh_order',
          datasource: 'warehouse',
          external: { remoteName: 'fact_orders' },
          fields: { order_id: { type: 'text' }, metadata: { type: 'text' } },
        },
      ],
    });
    const result = await svc.validateObject('wh_order');
    expect(result.ok).toBe(true);
    expect(result.diffs).toContainEqual(
      expect.objectContaining({ kind: 'type_mismatch', column: 'metadata', severity: 'warning' }),
    );
  });
});

describe('validateAll', () => {
  it('aggregates results across federated objects only', async () => {
    const svc = makeService({
      objects: [
        { name: 'local_thing', datasource: 'default', fields: { id: { type: 'text' } } },
        {
          name: 'wh_order',
          datasource: 'warehouse',
          external: { remoteName: 'fact_orders' },
          fields: { order_id: { type: 'text' }, amount: { type: 'number' } },
        },
      ],
    });
    const report = await svc.validateAll();
    expect(report.ok).toBe(true);
    expect(report.results.map((r) => r.object)).toEqual(['wh_order']);
  });
});

/**
 * [#10537] `validateDatasource` — the same sweep, scoped to one datasource.
 *
 * The card it closes is a COST/SHAPE defect, not a wrong answer:
 * `POST /datasources/:name/external/validate` used to run `validateAll()` and
 * post-filter the report, so a URL-scoped request drove a live
 * `introspect(datasource)` against EVERY federated datasource and discarded
 * most of what it measured. So the assertions below are about the introspection
 * CALL RECORD — a test comparing only returned rows would have passed before
 * the method existed, since post-filtering already produced the right rows.
 *
 * Every case also pins the rows against `validateAll()` filtered the old way:
 * "same answer, less work" is one claim, and the equivalence half is what keeps
 * the selection predicate (federated AND bound to this datasource) from
 * drifting away from the sweep's.
 */
describe('validateDatasource', () => {
  /** Three datasources — with one, "scoped" and "all" are the same reading. */
  const DATASOURCES = ['wh_a', 'wh_b', 'wh_c'];

  const REMOTE: IntrospectedSchema = {
    dialect: 'postgres',
    introspectedAt: '2026-08-21T00:00:00.000Z',
    tables: {
      orders: {
        name: 'orders',
        indexes: [],
        columns: [{ name: 'order_id', type: 'text', nullable: false, primaryKey: true }],
      },
    },
  };

  /**
   * One federated object per datasource, one local object, and one object that
   * is federated by its `external` binding while sitting on the DEFAULT
   * datasource — the edge where "bound to `:name`" and "federated" come apart,
   * and the reason the scoped filter cannot simply be `datasource === name`.
   */
  const OBJECTS: ObjectLike[] = [
    ...DATASOURCES.map((ds) => ({
      name: `${ds}_orders`,
      datasource: ds,
      external: { remoteName: 'orders' },
      fields: { order_id: { type: 'text' } },
    })),
    { name: 'local_thing', datasource: 'default', fields: { id: { type: 'text' } } },
    {
      name: 'default_bound_orders',
      datasource: 'default',
      external: { remoteName: 'orders' },
      fields: { order_id: { type: 'text' } },
    },
  ];

  function makeMulti(opts: { unreachable?: readonly string[] } = {}) {
    const introspected: string[] = [];
    const unreachable = new Set(opts.unreachable ?? []);
    const svc = new ExternalDatasourceService({
      introspect: async (datasource: string) => {
        introspected.push(datasource);
        if (unreachable.has(datasource)) throw new Error(`connect ECONNREFUSED (${datasource})`);
        return REMOTE;
      },
      getDatasource: async (name: string) =>
        DATASOURCES.includes(name) ? { name, schemaMode: 'external' } : undefined,
      getObject: async (name: string) => OBJECTS.find((o) => o.name === name),
      listObjects: async () => OBJECTS,
      logger: { warn: () => {} },
    });
    return { svc, introspected };
  }

  /** What the pre-#10537 route computed: the whole sweep, filtered afterwards. */
  async function sweptThenFiltered(datasource: string, opts?: { unreachable?: readonly string[] }) {
    const { svc, introspected } = makeMulti(opts);
    const report = await svc.validateAll();
    return {
      results: report.results.filter((r) => r.datasource === datasource),
      introspected,
    };
  }

  it('introspects only the named datasource', async () => {
    expect(DATASOURCES.length).toBeGreaterThan(1);
    const { svc, introspected } = makeMulti();

    const report = await svc.validateDatasource('wh_a');

    expect(introspected).toEqual(['wh_a']);
    expect(report.ok).toBe(true);
    expect(report.results.map((r) => r.object)).toEqual(['wh_a_orders']);
  });

  it('returns exactly the rows the whole-farm sweep would have kept', async () => {
    const { svc } = makeMulti();
    for (const ds of DATASOURCES) {
      const scoped = await svc.validateDatasource(ds);
      const swept = await sweptThenFiltered(ds);
      expect(scoped.results).toEqual(swept.results);
      expect(scoped.ok).toBe(swept.results.every((r) => r.ok));
      // The sweep really was wider — otherwise the line above is vacuous.
      expect(swept.introspected.length).toBeGreaterThan(1);
    }
  });

  it('keeps the federated-only predicate: a `default`-bound external object is the default datasource\'s row', async () => {
    const { svc } = makeMulti();

    const scoped = await svc.validateDatasource('default');
    const swept = await sweptThenFiltered('default');

    // `local_thing` is not federated and appears in neither reading;
    // `default_bound_orders` is federated and appears in both.
    expect(scoped.results.map((r) => r.object)).toEqual(['default_bound_orders']);
    expect(scoped.results).toEqual(swept.results);
  });

  it('never touches an unrelated unreachable remote', async () => {
    const opts = { unreachable: ['wh_b'] } as const;
    const { svc, introspected } = makeMulti(opts);

    const report = await svc.validateDatasource('wh_a');

    expect(introspected).toEqual(['wh_a']);
    expect(report.ok).toBe(true);
    expect(report.results).toEqual((await sweptThenFiltered('wh_a', opts)).results);
  });

  it('keeps the per-object failure row the sweep produces', async () => {
    const opts = { unreachable: ['wh_b'] } as const;
    const { svc, introspected } = makeMulti(opts);

    const report = await svc.validateDatasource('wh_b');

    // The scoped path still turns a per-object throw into a row rather than
    // rejecting the whole report — the sweep's `catch`, not a second one.
    expect(introspected).toEqual(['wh_b']);
    expect(report.ok).toBe(false);
    expect(report.results).toEqual((await sweptThenFiltered('wh_b', opts)).results);
    expect(report.results[0]).toMatchObject({
      ok: false,
      datasource: 'wh_b',
      object: 'wh_b_orders',
      diffs: [expect.objectContaining({ kind: 'missing_table', severity: 'error' })],
    });
  });

  it('answers an empty report for a datasource nothing is bound to — and introspects nothing', async () => {
    const { svc, introspected } = makeMulti();

    const report = await svc.validateDatasource('no_such_ds');

    expect(report).toEqual({ ok: true, results: [] });
    expect(introspected).toEqual([]);
  });
});

describe('refreshCatalog', () => {
  it('produces a snapshot with suggested field types', async () => {
    const svc = makeService();
    const catalog = await svc.refreshCatalog('warehouse');
    expect(catalog.datasource).toBe('warehouse');
    expect(catalog.name).toBe('warehouse_catalog');
    const orders = catalog.tables.find((t) => t.remoteName === 'fact_orders')!;
    expect(orders.columns.find((c) => c.name === 'amount')?.suggestedFieldType).toBe('number');
    // Canonicalised through the Zod schema: primaryKey default applied.
    expect(orders.columns.find((c) => c.name === 'order_id')?.primaryKey).toBe(true);
    expect(orders.columns.find((c) => c.name === 'amount')?.primaryKey).toBe(false);
  });

  it('persists the snapshot as an external_catalog record when a store is wired', async () => {
    const persisted: unknown[] = [];
    const svc = new ExternalDatasourceService({
      introspect: async () => warehouseSchema(),
      getDatasource: async () => ({ name: 'warehouse', schemaMode: 'external' }),
      getObject: async () => undefined,
      listObjects: async () => [],
      persistCatalog: async (c) => {
        persisted.push(c);
      },
    });
    const catalog = await svc.refreshCatalog('warehouse');
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toBe(catalog);
    expect((persisted[0] as { name: string }).name).toBe('warehouse_catalog');
  });

  it('still returns the snapshot when persistence throws (best-effort cache)', async () => {
    const svc = new ExternalDatasourceService({
      introspect: async () => warehouseSchema(),
      getDatasource: async () => ({ name: 'warehouse', schemaMode: 'external' }),
      getObject: async () => undefined,
      listObjects: async () => [],
      persistCatalog: async () => {
        throw new Error('metadata store is read-only');
      },
      logger: { warn: () => {} },
    });
    const catalog = await svc.refreshCatalog('warehouse');
    expect(catalog.name).toBe('warehouse_catalog');
  });
});
