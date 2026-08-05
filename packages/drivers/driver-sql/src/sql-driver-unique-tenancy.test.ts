// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver, classifyIndexKeyPart, parseIndexDdl } from '../src/index.js';

/**
 * Unique-scope materialization: tenancy composites (#3696) + the explicit
 * scope vocabulary and NULL-safe organization key part (ADR-0120, #5030).
 *
 * The defect #3696 locked down: `unique: true` used to become a single-column
 * global index that ignored `tenancy` entirely, while the autonumber sequence
 * table hands every tenant its own counter starting at 1 — tenant B's
 * `PROD-00001` was rejected by an index it could not see, and the rejection
 * leaked that some OTHER tenant held the value (an existence oracle).
 *
 * The defect #5030 measured on top of it: SQL UNIQUE is NULL-distinct, so the
 * bare `(organization_id, field)` composite enforced NOTHING on rows whose
 * organization is NULL — which on a single-tenant stack (where the kernel
 * injects the column and never fills it) is EVERY row. ADR-0120 D3 makes the
 * organization key part NULL-safe: `COALESCE(organization_id, '__global__')`.
 *
 * The contract now (ADR-0120 D1/D3; scope is a vocabulary, not a position):
 *
 *   field `unique: true` / `'organization'` + tenant column
 *     → composite `(COALESCE(tenantField, '__global__'), field)` — unique per
 *       organization; NULL-organization rows form one platform bucket, unique
 *       among themselves (#5030).
 *   field `unique: true` / `'organization'`, no tenant column
 *     → single-column `(field)`.
 *   field `unique: 'global'`
 *     → single-column `(field)`, platform-wide, always.
 *   declared index `unique: true` / `'global'`
 *     → VERBATIM listed columns, never rewritten — the #3696 verbatim contract,
 *       now the `'global'` arm of the vocabulary (bare `true` retires at
 *       protocol 18; the synonym pin below retires with it).
 *   declared index `unique: 'organization'`
 *     → NULL-safe organization key part PREPENDED to the listed columns; with
 *       no tenant column it degrades to the listed columns (S11); a listed
 *       tenant column is made NULL-safe in place instead (S6 respelling).
 *
 * Retiring the legacy global index is no longer inline DDL at boot: since
 * #3728 it is a `replace_unique_index` drift entry, auto-applied on restart
 * only under the dev `autoMigrate: 'safe'` policy and otherwise left to
 * `os migrate`. The #5030 tightening (bare composite → NULL-safe composite)
 * goes through the same ceremony as `recreate_index`, gated by the ADR-0120 D4
 * duplicate pre-flight probe. The migration tests below opt into that policy.
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

  /**
   * Unique index name → canonical key parts, read from the index DDL so
   * expression keys are visible (`PRAGMA index_info` reports a NULL name for
   * them). A plain column reads as its name; the NULL-safe organization key
   * part (ADR-0120 D3) reads as `COALESCE(<column>)` — literal elided, the
   * same literal-agnostic identity the drift differ compares on.
   */
  async function uniqueIndexColumns(table: string): Promise<Record<string, string[]>> {
    const k = (driver as any).knex;
    const list: any = await k.raw(`PRAGMA index_list(${table})`);
    const master: any = await k.raw(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`,
      [table],
    );
    const ddlByName = new Map<string, string>();
    for (const r of Array.isArray(master) ? master : (master?.rows ?? [])) {
      if (typeof r?.sql === 'string' && r.sql) ddlByName.set(r.name, r.sql);
    }
    const out: Record<string, string[]> = {};
    for (const idx of list) {
      if (idx.origin === 'pk' || idx.unique !== 1) continue;
      const parsed = parseIndexDdl(ddlByName.get(idx.name) ?? '');
      if (parsed) {
        out[idx.name] = parsed.keyParts.map((p) => {
          const part = classifyIndexKeyPart(p);
          if (part.kind === 'column') return part.column;
          return part.column === null ? p : `COALESCE(${part.column})`;
        });
      } else {
        const info: any = await k.raw(`PRAGMA index_info(${idx.name})`);
        out[idx.name] = info.map((c: any) => c.name);
      }
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

  it('materializes a COMPOSITE (tenant, field) unique index, NULL-safe tenant key part first', async () => {
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
    expect(Object.values(uniques)).toContainEqual(['COALESCE(organization_id)', 'code']);
    // No leftover single-column global unique on `code`, and no bare
    // (NULL-distinct — i.e. void on NULL-org rows, #5030) composite.
    expect(Object.values(uniques)).not.toContainEqual(['code']);
    expect(Object.values(uniques)).not.toContainEqual(['organization_id', 'code']);

    // The literal is pinned too (ADR-0120 D3, maintainer-resolved): the
    // constraint-violation error must read as "the platform bucket collided"
    // — `('__global__', …)` — and the word must match the autonumber sequence
    // table's GLOBAL_TENANT, not a bare ''.
    const k = (driver as any).knex;
    const master: any = await k.raw(
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'uniq_product_organization_id_code'`,
    );
    expect(String(master[0]?.sql)).toMatch(/COALESCE\([`"]?organization_id[`"]?, '__global__'\)/i);
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
    expect(Object.values(uniques)).toContainEqual(['COALESCE(environment_id)', 'key']);

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
    expect(Object.values(uniques)).toContainEqual(['COALESCE(organization_id)', 'code']);

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
    expect(Object.values(uniques)).toContainEqual(['COALESCE(organization_id)', 'code']);
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
    expect(Object.values(uniques)).toContainEqual(['COALESCE(organization_id)', 'code']);
    expect(Object.values(uniques)).not.toContainEqual(['code']);
    expect(Object.values(uniques)).not.toContainEqual(['organization_id', 'code']);

    // Data preserved, and cross-tenant reuse still works post-rebuild.
    expect(await driver.count('product', { object: 'product' })).toBe(1);
    const b = await driver.create('product', { organization_id: 'org_b', code: 'C1', note: 'n' });
    expect(b.code).toBe('C1');
  });

  // ── ADR-0120 D3: the NULL-organization bucket is constrained (#5030) ──────

  describe('NULL-safe organization uniqueness (ADR-0120 D3, #5030)', () => {
    it('#5030 regression: unique IS enforced when organization_id exists but is NULL on every row', async () => {
      // The measured defect shape, verbatim from the issue: the kernel injects
      // `organization_id` on single-tenant stacks too, every row leaves it
      // NULL, and the bare NULL-distinct composite admitted any number of
      // duplicates — field-level `unique: true` enforced NOTHING.
      await driver.initObjects([
        {
          name: 'account',
          fields: {
            organization_id: { type: 'string' },
            email: { type: 'text', unique: true },
          },
        },
      ]);

      const first = await driver.create('account', { email: 'dup@example.com' });
      expect(first.organization_id ?? null).toBeNull();
      await expect(driver.create('account', { email: 'dup@example.com' })).rejects.toThrow(
        /UNIQUE constraint failed|duplicate key value/,
      );
    });

    it('the NULL bucket and organizations coexist: one platform holder, plus one per organization (S8)', async () => {
      await driver.initObjects([
        {
          name: 'template',
          fields: {
            organization_id: { type: 'string' },
            key: { type: 'string', unique: true },
          },
        },
      ]);

      // Platform (NULL-organization) row takes the value…
      await driver.create('template', { key: 'welcome' });
      // …an organization may still hold the same value (per-org scope)…
      const org = await driver.create('template', { organization_id: 'org_a', key: 'welcome' });
      expect(org.key).toBe('welcome');
      // …but a SECOND platform row may not: NULL rows are one bucket, unique
      // among themselves.
      await expect(driver.create('template', { key: 'welcome' })).rejects.toThrow(
        /UNIQUE constraint failed|duplicate key value/,
      );
    });

    it("accepts field-level unique: 'organization' as the explicit synonym of true (ADR-0120 D1)", async () => {
      await driver.initObjects([
        {
          name: 'contact',
          fields: {
            organization_id: { type: 'string' },
            email: { type: 'string', unique: 'organization' },
          },
        } as any,
      ]);

      const uniques = await uniqueIndexColumns('contact');
      expect(Object.values(uniques)).toContainEqual(['COALESCE(organization_id)', 'email']);

      await driver.create('contact', { organization_id: 'org_a', email: 'a@x.test' });
      const other = await driver.create('contact', { organization_id: 'org_b', email: 'a@x.test' });
      expect(other.email).toBe('a@x.test');
      await expect(
        driver.create('contact', { organization_id: 'org_a', email: 'a@x.test' }),
      ).rejects.toThrow(/UNIQUE constraint failed|duplicate key value/);
    });
  });

  // ── ADR-0120 D1: declared-index `unique: 'organization'` ──────────────────

  describe("declared-index unique: 'organization' (ADR-0120 D1)", () => {
    it('prepends the NULL-safe organization key part to the listed columns', async () => {
      await driver.initObjects([
        {
          name: 'case_record',
          fields: {
            organization_id: { type: 'string' },
            department: { type: 'string' },
            code: { type: 'string' },
          },
          indexes: [{ fields: ['department', 'code'], unique: 'organization' }],
        } as any,
      ]);

      const uniques = await uniqueIndexColumns('case_record');
      expect(uniques['uniq_case_record_organization_id_department_code']).toEqual([
        'COALESCE(organization_id)',
        'department',
        'code',
      ]);

      // Per-organization semantics: two orgs may hold the same (department,
      // code); the same org may not; the NULL bucket is constrained too.
      await driver.create('case_record', { organization_id: 'org_a', department: 'sales', code: 'C-1' });
      await driver.create('case_record', { organization_id: 'org_b', department: 'sales', code: 'C-1' });
      await expect(
        driver.create('case_record', { organization_id: 'org_a', department: 'sales', code: 'C-1' }),
      ).rejects.toThrow(/UNIQUE constraint failed|duplicate key value/);
      await driver.create('case_record', { department: 'sales', code: 'C-2' });
      await expect(
        driver.create('case_record', { department: 'sales', code: 'C-2' }),
      ).rejects.toThrow(/UNIQUE constraint failed|duplicate key value/);
    });

    it('degrades to the listed columns alone when the object has no tenant column (S11)', async () => {
      await driver.initObjects([
        {
          name: 'plain_catalog',
          fields: { department: { type: 'string' }, code: { type: 'string' } },
          indexes: [{ fields: ['department', 'code'], unique: 'organization' }],
        } as any,
      ]);

      const uniques = await uniqueIndexColumns('plain_catalog');
      expect(uniques['uniq_plain_catalog_department_code']).toEqual(['department', 'code']);
    });

    it('makes a LISTED tenant column NULL-safe in place — the S6 respelling, not double-prepended', async () => {
      // The hand-written legacy shape, opted into the explicit vocabulary:
      // the author already listed the tenant column, so the org key part is
      // not prepended again — the listed column's own key part becomes the
      // NULL-safe form.
      await driver.initObjects([
        {
          name: 'team',
          fields: { organization_id: { type: 'string' }, name: { type: 'string' } },
          indexes: [{ fields: ['organization_id', 'name'], unique: 'organization' }],
        } as any,
      ]);

      const uniques = await uniqueIndexColumns('team');
      expect(uniques['uniq_team_organization_id_name']).toEqual([
        'COALESCE(organization_id)',
        'name',
      ]);

      await driver.create('team', { name: 'Core' });
      await expect(driver.create('team', { name: 'Core' })).rejects.toThrow(
        /UNIQUE constraint failed|duplicate key value/,
      );
    });
  });

  // ── ADR-0120 D4: the tightening goes through the ceremony ─────────────────

  describe('bare-composite tightening + duplicate pre-flight (ADR-0120 D4)', () => {
    /** A pre-ADR-0120 database: the bare NULL-distinct composite, in place. */
    const seedBareComposite = async () => {
      const k = (driver as any).knex;
      await k.schema.createTable('product', (t: any) => {
        t.string('id').primary();
        t.timestamp('created_at');
        t.timestamp('updated_at');
        t.string('organization_id');
        t.string('code');
      });
      await k.raw(
        'CREATE UNIQUE INDEX uniq_product_organization_id_code ON product (organization_id, code)',
      );
      return k;
    };

    const productMeta = [
      {
        name: 'product',
        fields: {
          organization_id: { type: 'string' },
          code: { type: 'string', unique: true },
        },
      },
    ];

    it("auto-tightens at boot under autoMigrate: 'safe' when the probe is clean", async () => {
      await driver.disconnect();
      driver = makeDriver({ autoMigrate: 'safe' });
      const k = await seedBareComposite();
      // Clean data: distinct codes, including one NULL-organization row.
      await k('product').insert([
        { id: 'r1', organization_id: 'org_a', code: 'C1' },
        { id: 'r2', organization_id: null, code: 'C1' },
      ]);

      await driver.initObjects(productMeta);

      const uniques = await uniqueIndexColumns('product');
      expect(uniques['uniq_product_organization_id_code']).toEqual([
        'COALESCE(organization_id)',
        'code',
      ]);
      // Healthy database: converged, zero drift.
      expect(await driver.detectManagedDrift()).toHaveLength(0);
      // The NULL bucket is now enforced: a second platform-bucket C1 is refused.
      await expect(driver.create('product', { code: 'C1' })).rejects.toThrow(
        /UNIQUE constraint failed|duplicate key value/,
      );
    });

    it('BLOCKS the tightening on duplicate NULL-organization rows — old index kept, rows reported', async () => {
      await driver.disconnect();
      driver = makeDriver({ autoMigrate: 'safe' });
      const k = await seedBareComposite();
      // The #5030 defect made data: duplicates the NULL-distinct index admitted.
      await k('product').insert([
        { id: 'r1', organization_id: null, code: 'DUP' },
        { id: 'r2', organization_id: null, code: 'DUP' },
      ]);

      // Boot survives — the tightening is not applied, the old index stays.
      await driver.initObjects(productMeta);
      expect((await uniqueIndexColumns('product'))['uniq_product_organization_id_code']).toEqual([
        'organization_id',
        'code',
      ]);

      // The plan reports the op as BLOCKED, with the offending group named —
      // and the COALESCE key makes the report self-describing ('__global__' =
      // the platform bucket).
      const drift = await driver.detectManagedDrift();
      const entry = drift.find((d) => d.op.type === 'recreate_index');
      expect(entry).toBeDefined();
      expect(entry!.category).toBe('destructive');
      expect(entry!.severity).toBe('error');
      expect(entry!.message).toMatch(/BLOCKED/);
      expect(entry!.message).toMatch(/__global__/);
      expect(entry!.message).toMatch(/"DUP"/);
      expect(entry!.message).toMatch(/#5030/);

      // Even `--allow-destructive` cannot force it: apply re-probes and
      // refuses — at no point is a constraint dropped without its replacement
      // being creatable.
      const { applied, skipped } = await driver.applyMigrationEntries([entry!], {
        allowDestructive: true,
      });
      expect(applied).toHaveLength(0);
      expect(skipped).toHaveLength(1);
      expect((await uniqueIndexColumns('product'))['uniq_product_organization_id_code']).toEqual([
        'organization_id',
        'code',
      ]);

      // Deduplicating unblocks the op: the probe comes back clean, the entry
      // re-grades `safe`, and a plain apply tightens the index.
      await k('product').where({ id: 'r2' }).delete();
      const drift2 = await driver.detectManagedDrift();
      const entry2 = drift2.find((d) => d.op.type === 'recreate_index');
      expect(entry2).toBeDefined();
      expect(entry2!.category).toBe('safe');
      const res2 = await driver.applyMigrationEntries([entry2!], { allowDestructive: false });
      expect(res2.applied).toHaveLength(1);
      expect((await uniqueIndexColumns('product'))['uniq_product_organization_id_code']).toEqual([
        'COALESCE(organization_id)',
        'code',
      ]);
      expect(await driver.detectManagedDrift()).toHaveLength(0);
    });
  });
});
