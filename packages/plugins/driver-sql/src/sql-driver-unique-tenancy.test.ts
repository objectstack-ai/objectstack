// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

/**
 * Tenant-scoped `unique` materialization (#3696).
 *
 * The defect this locks down: `unique: true` used to become a single-column
 * global index that ignored `tenancy` entirely, while the autonumber sequence
 * table is keyed by `(object, tenant_id, field, scope)` and hands every tenant
 * its own counter starting at 1. Two subsystems of the same platform therefore
 * disagreed — tenant B's `PROD-00001` was rejected by an index it could not
 * see, with no user error involved — and the rejection itself leaked that some
 * OTHER tenant held the value (a cross-tenant existence oracle).
 *
 * The contract now:
 *   - `unique: true` + tenant column  → composite `(tenantField, field)`
 *   - `unique: true`, no tenant column → single-column (single-tenant: unchanged)
 *   - `unique: 'global'`               → single-column, always
 *   - declared `indexes[]`             → verbatim columns, never rewritten
 *
 * Retiring the legacy global index is no longer inline DDL at boot: since
 * #3728 it is a `replace_unique_index` drift entry, auto-applied on restart
 * only under the dev `autoMigrate: 'safe'` policy and otherwise left to
 * `os migrate`. The migration tests below therefore opt into that policy.
 */
describe('SqlDriver unique × tenancy (#3696)', () => {
  let driver: SqlDriver;

  const makeDriver = (opts: any = {}) =>
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      ...opts,
    });

  beforeEach(async () => {
    driver = makeDriver();
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  /** Index name → column list, for the non-PK indexes on a table. */
  async function indexColumns(table: string): Promise<Record<string, string[]>> {
    const k = (driver as any).knex;
    const list: any = await k.raw(`PRAGMA index_list(${table})`);
    const out: Record<string, string[]> = {};
    for (const idx of list) {
      if (idx.origin === 'pk') continue;
      const info: any = await k.raw(`PRAGMA index_info(${idx.name})`);
      out[idx.name] = info.map((c: any) => c.name);
    }
    return out;
  }

  async function uniqueIndexColumns(table: string): Promise<Record<string, string[]>> {
    const k = (driver as any).knex;
    const list: any = await k.raw(`PRAGMA index_list(${table})`);
    const out: Record<string, string[]> = {};
    for (const idx of list) {
      if (idx.origin === 'pk' || idx.unique !== 1) continue;
      const info: any = await k.raw(`PRAGMA index_info(${idx.name})`);
      out[idx.name] = info.map((c: any) => c.name);
    }
    return out;
  }

  // ── The scenario from the issue: autonumber + unique, two tenants ──────────

  it('lets two tenants hold the same unique code (the autonumber collision)', async () => {
    await driver.initObjects([
      {
        name: 'product',
        fields: {
          organization_id: { type: 'string' },
          code: { type: 'autonumber', format: 'PROD-{00000}', unique: true },
          name: { type: 'string' },
        },
      },
    ]);

    // Each tenant's sequence starts at 1 — so both mint PROD-00001. Before the
    // fix the second insert died with SQLITE_CONSTRAINT_UNIQUE.
    const a = await driver.create('product', { organization_id: 'org_a', name: 'A' });
    const b = await driver.create('product', { organization_id: 'org_b', name: 'B' });

    expect(a.code).toBe('PROD-00001');
    expect(b.code).toBe('PROD-00001');
  });

  it('still rejects a duplicate code WITHIN one tenant', async () => {
    await driver.initObjects([
      {
        name: 'product',
        fields: {
          organization_id: { type: 'string' },
          code: { type: 'string', unique: true },
        },
      },
    ]);

    await driver.create('product', { organization_id: 'org_a', code: 'X-1' });
    await expect(
      driver.create('product', { organization_id: 'org_a', code: 'X-1' }),
    ).rejects.toThrow(/UNIQUE constraint failed|duplicate key value/);

    // …and the same value in a different tenant is fine.
    const other = await driver.create('product', { organization_id: 'org_b', code: 'X-1' });
    expect(other.code).toBe('X-1');
  });

  it("keeps `unique: 'global'` unique across tenants", async () => {
    await driver.initObjects([
      {
        name: 'runtime',
        fields: {
          organization_id: { type: 'string' },
          hostname: { type: 'string', unique: 'global' },
        },
      },
    ]);

    await driver.create('runtime', { organization_id: 'org_a', hostname: 'app.example.com' });
    await expect(
      driver.create('runtime', { organization_id: 'org_b', hostname: 'app.example.com' }),
    ).rejects.toThrow(/UNIQUE constraint failed|duplicate key value/);
  });

  // ── Physical shape ────────────────────────────────────────────────────────

  it('materializes a COMPOSITE (tenant, field) unique index, tenant column first', async () => {
    await driver.initObjects([
      {
        name: 'product',
        fields: {
          organization_id: { type: 'string' },
          code: { type: 'string', unique: true },
        },
      },
    ]);

    const uniques = await uniqueIndexColumns('product');
    expect(Object.values(uniques)).toContainEqual(['organization_id', 'code']);
    // No leftover single-column global unique on `code`.
    expect(Object.values(uniques)).not.toContainEqual(['code']);
  });

  it('materializes a SINGLE-column unique when the object has no tenant column', async () => {
    await driver.initObjects([
      { name: 'widget', fields: { sku: { type: 'string', unique: true } } },
    ]);

    const uniques = await uniqueIndexColumns('widget');
    expect(Object.values(uniques)).toContainEqual(['sku']);
  });

  it('materializes a SINGLE-column unique when tenancy is explicitly disabled', async () => {
    await driver.initObjects([
      {
        name: 'catalog_entry',
        tenancy: { enabled: false },
        fields: {
          organization_id: { type: 'string' },
          slug: { type: 'string', unique: true },
        },
      } as any,
    ]);

    const uniques = await uniqueIndexColumns('catalog_entry');
    expect(Object.values(uniques)).toContainEqual(['slug']);
    expect(Object.values(uniques)).not.toContainEqual(['organization_id', 'slug']);

    // Behaviorally: a platform-global catalog still rejects cross-org dupes.
    await driver.create('catalog_entry', { organization_id: 'org_a', slug: 's' });
    await expect(
      driver.create('catalog_entry', { organization_id: 'org_b', slug: 's' }),
    ).rejects.toThrow(/UNIQUE constraint failed|duplicate key value/);
  });

  it('does not compose a unique declared ON the tenant column itself', async () => {
    // "one row per tenant" — `(organization_id, organization_id)` is not a
    // constraint, so this must stay single-column.
    await driver.initObjects([
      {
        name: 'billing_customer',
        fields: { organization_id: { type: 'string', unique: true } },
      },
    ]);

    const uniques = await uniqueIndexColumns('billing_customer');
    expect(Object.values(uniques)).toContainEqual(['organization_id']);

    await driver.create('billing_customer', { organization_id: 'org_a' });
    await expect(driver.create('billing_customer', { organization_id: 'org_a' })).rejects.toThrow(
      /UNIQUE constraint failed|duplicate key value/,
    );
  });

  it('honors a declared tenancy.tenantField other than organization_id', async () => {
    await driver.initObjects([
      {
        name: 'env_setting',
        tenancy: { enabled: true, tenantField: 'environment_id' },
        fields: {
          environment_id: { type: 'string' },
          key: { type: 'string', unique: true },
        },
      } as any,
    ]);

    const uniques = await uniqueIndexColumns('env_setting');
    expect(Object.values(uniques)).toContainEqual(['environment_id', 'key']);

    await driver.create('env_setting', { environment_id: 'env_a', key: 'k' });
    const other = await driver.create('env_setting', { environment_id: 'env_b', key: 'k' });
    expect(other.key).toBe('k');
  });

  // ── Declared indexes are NOT rewritten ────────────────────────────────────

  it('leaves declared object-level indexes exactly as authored', async () => {
    // A declared index names its own columns. Many are platform-wide on
    // purpose (a DNS hostname, a reserved slug, a Stripe customer id), so
    // injecting a tenant column here would silently break them.
    await driver.initObjects([
      {
        name: 'slug_reservation',
        fields: {
          organization_id: { type: 'string' },
          slug: { type: 'string' },
        },
        indexes: [{ fields: ['slug'], unique: true }],
      } as any,
    ]);

    const uniques = await uniqueIndexColumns('slug_reservation');
    expect(Object.values(uniques)).toContainEqual(['slug']);
    expect(Object.values(uniques)).not.toContainEqual(['organization_id', 'slug']);

    await driver.create('slug_reservation', { organization_id: 'org_a', slug: 'acme' });
    await expect(
      driver.create('slug_reservation', { organization_id: 'org_b', slug: 'acme' }),
    ).rejects.toThrow(/UNIQUE constraint failed|duplicate key value/);
  });

  it("accepts unique: 'global' on a declared index as a synonym of true", async () => {
    await driver.initObjects([
      {
        name: 'domain',
        fields: { organization_id: { type: 'string' }, host: { type: 'string' } },
        indexes: [{ fields: ['host'], unique: 'global' }],
      } as any,
    ]);

    const uniques = await uniqueIndexColumns('domain');
    expect(Object.values(uniques)).toContainEqual(['host']);
  });

  // ── Legacy migration: drop the global index, create the composite ─────────

  it('retires a legacy global unique index and replaces it with the composite', async () => {
    driver = makeDriver({ autoMigrate: 'safe' });
    const k = (driver as any).knex;

    // Reproduce exactly what the OLD code left behind: knex's `col.unique()`
    // naming from `createColumn`.
    await k.schema.createTable('product', (t: any) => {
      t.string('id').primary();
      t.timestamp('created_at');
      t.timestamp('updated_at');
      t.string('organization_id');
      t.string('code');
    });
    await k.raw('CREATE UNIQUE INDEX product_code_unique ON product (code)');

    // Pre-existing rows satisfy the new (weaker) constraint by construction —
    // the migration is a pure relaxation, so it cannot fail on real data.
    await k('product').insert([
      { id: 'r1', organization_id: 'org_a', code: 'PROD-00001' },
      { id: 'r2', organization_id: 'org_a', code: 'PROD-00002' },
    ]);

    await driver.initObjects([
      {
        name: 'product',
        fields: {
          organization_id: { type: 'string' },
          code: { type: 'string', unique: true },
        },
      },
    ]);

    const uniques = await uniqueIndexColumns('product');
    expect(uniques['product_code_unique']).toBeUndefined();
    expect(Object.values(uniques)).toContainEqual(['organization_id', 'code']);

    // Existing data survived, and the cross-tenant insert now works.
    expect(await driver.count('product', { object: 'product' })).toBe(2);
    const b = await driver.create('product', { organization_id: 'org_b', code: 'PROD-00001' });
    expect(b.code).toBe('PROD-00001');
  });

  it('retires the legacy `uniq_<table>_<col>` index left by the drift rebuild path', async () => {
    driver = makeDriver({ autoMigrate: 'safe' });
    const k = (driver as any).knex;
    await k.schema.createTable('product', (t: any) => {
      t.string('id').primary();
      t.string('organization_id');
      t.string('code');
    });
    await k.raw('CREATE UNIQUE INDEX uniq_product_code ON product (code)');

    await driver.initObjects([
      {
        name: 'product',
        fields: {
          organization_id: { type: 'string' },
          code: { type: 'string', unique: true },
        },
      },
    ]);

    const uniques = await uniqueIndexColumns('product');
    expect(uniques['uniq_product_code']).toBeUndefined();
    expect(Object.values(uniques)).toContainEqual(['organization_id', 'code']);
  });

  it("does NOT retire the single-column index of a unique: 'global' field", async () => {
    driver = makeDriver({ autoMigrate: 'safe' });
    const k = (driver as any).knex;
    await k.schema.createTable('runtime', (t: any) => {
      t.string('id').primary();
      t.string('organization_id');
      t.string('hostname');
    });
    await k.raw('CREATE UNIQUE INDEX uniq_runtime_hostname ON runtime (hostname)');

    await driver.initObjects([
      {
        name: 'runtime',
        fields: {
          organization_id: { type: 'string' },
          hostname: { type: 'string', unique: 'global' },
        },
      },
    ]);

    const uniques = await uniqueIndexColumns('runtime');
    expect(uniques['uniq_runtime_hostname']).toEqual(['hostname']);
  });

  it('is idempotent across repeated initObjects runs', async () => {
    const objects = [
      {
        name: 'product',
        fields: {
          organization_id: { type: 'string' },
          code: { type: 'string', unique: true },
        },
      },
    ];

    await driver.initObjects(objects);
    const first = await indexColumns('product');
    await driver.initObjects(objects);
    const second = await indexColumns('product');

    expect(second).toEqual(first);
  });

  // ── The SQLite drift-rebuild path must land on the same DDL ───────────────

  it('keeps the composite (not a global index) after a SQLite drift rebuild', async () => {
    // The rebuild drops and recreates the table, so every index is
    // re-materialized from metadata. It used to inline its own single-column
    // `uniq_<table>_<col>` DDL — silently re-introducing the global index on a
    // tenant-scoped field after any drift reconcile.
    await driver.initObjects([
      {
        name: 'product',
        fields: {
          organization_id: { type: 'string' },
          code: { type: 'string', unique: true },
          note: { type: 'string', required: true },
        },
      },
    ]);
    await driver.create('product', { organization_id: 'org_a', code: 'C1', note: 'n' });

    // Relax `note` NOT NULL → forces the rebuild path on SQLite.
    await (driver as any).rebuildSqliteTablePatched('product', [
      { table: 'product', column: 'note', op: { type: 'relax_not_null', table: 'product', column: 'note' } },
    ]);

    const uniques = await uniqueIndexColumns('product');
    expect(Object.values(uniques)).toContainEqual(['organization_id', 'code']);
    expect(Object.values(uniques)).not.toContainEqual(['code']);

    // Data preserved, and cross-tenant reuse still works post-rebuild.
    expect(await driver.count('product', { object: 'product' })).toBe(1);
    const b = await driver.create('product', { organization_id: 'org_b', code: 'C1', note: 'n' });
    expect(b.code).toBe('C1');
  });
});
