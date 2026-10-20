// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyConversionsToStoredItem } from '@objectstack/spec';
import { SqlDriver, classifyIndexKeyPart, expectedIndexes, parseIndexDdl } from '../src/index.js';
import { asPre18TenantColumn } from './pre-18-tenant-column.testkit.js';

/**
 * Unique-scope materialization: tenancy composites (#3696) + the explicit
 * scope vocabulary (ADR-0120) + the plain organization key part (ADR-0131 D1).
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
 * injects the column and never fills it) is EVERY row. ADR-0120 D3 answered it
 * with a NULL-safe key part, `COALESCE(organization_id, '__global__')`.
 * ADR-0131 D1 closes the hole at the column instead: a fresh table's tenant
 * column is NOT NULL, so new DDL keys the PLAIN organization column and the
 * NULL-organization "platform bucket" no longer exists. Only a database built
 * before 18.x still holds a nullable tenant column (`asPre18TenantColumn`),
 * and there NULL-organization rows are exempt from the plain index — SQL
 * UNIQUE is NULL-distinct.
 *
 * The contract now (ADR-0120 D1 vocabulary; ADR-0131 D1 key shape):
 *
 *   field `unique: true` / `'organization'` + tenant column
 *     → composite `(tenantField, field)` — unique per organization, the
 *       tenant key part plain (no COALESCE).
 *   field `unique: true` / `'organization'`, no tenant column
 *     → single-column `(field)`.
 *   field `unique: 'global'`
 *     → single-column `(field)`, platform-wide, always.
 *   declared index `unique: 'global'`
 *     → VERBATIM listed columns, never rewritten — the #3696 verbatim contract,
 *       now the `'global'` arm of the vocabulary. Bare `true`, its positional
 *       spelling, is refused by the spec since protocol 18 (#5082), and stored
 *       metadata converts it to `'global'` (ADR-0120 D2) — the D2 corpus pin
 *       below proves that respelling builds the same indexes byte for byte.
 *       The old "`'global'` is a synonym of `true`" pin retired with the bare
 *       spelling.
 *   declared index `unique: 'organization'`
 *     → the plain organization column PREPENDED to the listed columns; with
 *       no tenant column it degrades to the listed columns (S11); a listed
 *       tenant column is kept in place, never prepended twice (S6 respelling).
 *
 * Retiring the legacy global index is no longer inline DDL at boot: since
 * #3728 it is a `replace_unique_index` drift entry, auto-applied on restart
 * only under the dev `autoMigrate: 'safe'` policy and otherwise left to
 * `os migrate`. The ADR-0120 D4 tightening (bare composite → NULL-safe
 * composite) is retired with the COALESCE expectation: a bare composite IS the
 * expected shape now, so no op is proposed (ADR-0131 D1). The migration tests
 * below opt into that policy.
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
   * them). A plain column reads as its name; a legacy NULL-safe organization
   * key part (ADR-0120 D3) would read as `COALESCE(<column>)` — literal
   * elided, the same literal-agnostic identity the drift differ compares on —
   * which is how the pins below prove new DDL carries none (ADR-0131 D1).
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

  it('materializes a COMPOSITE (tenant, field) unique index, PLAIN tenant key part first (ADR-0131 D1)', async () => {
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
    // No leftover single-column global unique on `code`, and no retired
    // NULL-safe (ADR-0120 D3) composite.
    expect(Object.values(uniques)).not.toContainEqual(['code']);
    expect(Object.values(uniques)).not.toContainEqual(['COALESCE(organization_id)', 'code']);

    // The DDL itself carries no expression key (ADR-0131 D1): the tenant
    // column is NOT NULL on a fresh table, so the plain column is the whole
    // per-organization key — no '__global__' platform bucket is built.
    const k = (driver as any).knex;
    const master: any = await k.raw(
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'uniq_product_organization_id_code'`,
    );
    expect(String(master[0]?.sql)).toMatch(/\(\s*[`"]?organization_id[`"]?\s*,\s*[`"]?code[`"]?\s*\)/i);
    expect(String(master[0]?.sql)).not.toMatch(/COALESCE|__global__/i);
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

  it("leaves a declared 'global' index exactly as authored", async () => {
    // A declared index names its own columns. Many are platform-wide on
    // purpose (a DNS hostname, a reserved slug, a Stripe customer id), so
    // injecting a tenant column here would silently break them. Retained FOR
    // `'global'` (ADR-0120 D6.6) — the spelling the verbatim contract has
    // been stated in since bare `true` was refused at protocol 18.
    await driver.initObjects([
      {
        name: 'slug_reservation',
        fields: {
          organization_id: { type: 'string' },
          slug: { type: 'string' },
        },
        indexes: [{ fields: ['slug'], unique: 'global' }],
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

  // ── ADR-0120 D2: the bare-`true` → `'global'` conversion is zero-drift ────
  //
  // The regression corpus ADR-0120 D2 names: the S4/S5 shapes, i.e. the nine
  // engine-owned idempotency/dedup keys of the #4986 inventory, each as it was
  // declared when the ADR was written — bare `unique: true` on a declared
  // index. (Four have since moved to `'organization'` on purpose and the rest
  // to `'global'`; the corpus is frozen at the ADR-time spelling because that
  // is the population stored rows carry.) Each is replayed through the stored
  // seam's own conversion pass, and two facts are pinned:
  //
  //   1. the expected-index output is BYTE-IDENTICAL before and after — the
  //      conversion changes the spelling and nothing the driver materializes;
  //   2. on a database built from the bare spelling, the drift plan for the
  //      converted metadata is EMPTY — no index op, safe or destructive.
  //
  // The second has a control: the same database against one index moved to
  // `'organization'` is NOT empty, so the empty plan is a reading, not a
  // detector that cannot see index drift.
  describe('ADR-0120 D2 — the nine-key corpus converts with zero drift', () => {
    const NINE_KEY_CORPUS: Array<{ name: string; fields: Record<string, any>; indexes: any[] }> = [
      { name: 'sys_job', fields: { name: { type: 'string' } }, indexes: [{ fields: ['name'], unique: true }] },
      { name: 'sys_notification', fields: { dedup_key: { type: 'string' } }, indexes: [{ fields: ['dedup_key'], unique: true }] },
      {
        name: 'http_delivery',
        fields: { source: { type: 'string' }, dedup_key: { type: 'string' } },
        indexes: [{ fields: ['source', 'dedup_key'], unique: true }],
      },
      { name: 'sys_presence', fields: { session_id: { type: 'string' } }, indexes: [{ fields: ['session_id'], unique: true }] },
      {
        name: 'sys_email_template',
        fields: { name: { type: 'string' }, locale: { type: 'string' } },
        indexes: [{ fields: ['name', 'locale'], unique: true }],
      },
      {
        name: 'notification_delivery',
        fields: { notification_id: { type: 'string' }, recipient_id: { type: 'string' }, channel: { type: 'string' } },
        indexes: [{ fields: ['notification_id', 'recipient_id', 'channel'], unique: true }],
      },
      {
        name: 'notification_receipt',
        fields: { notification_id: { type: 'string' }, user_id: { type: 'string' }, channel: { type: 'string' } },
        indexes: [{ fields: ['notification_id', 'user_id', 'channel'], unique: true }],
      },
      {
        name: 'notification_subscription',
        fields: { topic: { type: 'string' }, principal: { type: 'string' } },
        indexes: [{ fields: ['topic', 'principal'], unique: true }],
      },
      {
        name: 'notification_preference',
        fields: { user_id: { type: 'string' }, topic: { type: 'string' }, channel: { type: 'string' } },
        indexes: [{ fields: ['user_id', 'topic', 'channel'], unique: true }],
      },
    ].map((o) => ({ ...o, fields: { organization_id: { type: 'string' }, ...o.fields } }));

    const converted = () => NINE_KEY_CORPUS.map((o) => applyConversionsToStoredItem('object', o));

    /** What the driver asks the database for, per table — serialized, so "identical" means bytes. */
    const expectedBytes = (objects: Array<{ name: string; fields: Record<string, any>; indexes: any[] }>) =>
      JSON.stringify(
        objects.map((o) =>
          expectedIndexes({
            table: o.name,
            fields: o.fields,
            tenantField: 'organization_id',
            declaredIndexes: o.indexes,
            physicalColumns: new Set(['id', ...Object.keys(o.fields)]),
          }),
        ),
      );

    it('the conversion respells every corpus index to global, and only that', () => {
      const after = converted();
      expect(after.map((o) => o.indexes.map((i: any) => i.unique))).toEqual(NINE_KEY_CORPUS.map(() => ['global']));
      // Nothing but the scope word moved: same names, fields and columns.
      expect(after.map((o) => ({ ...o, indexes: o.indexes.map(({ unique: _u, ...rest }: any) => rest) }))).toEqual(
        NINE_KEY_CORPUS.map((o) => ({ ...o, indexes: o.indexes.map(({ unique: _u, ...rest }: any) => rest) })),
      );
    });

    it('expected-index output is byte-identical before and after the conversion', () => {
      const before = expectedBytes(NINE_KEY_CORPUS);
      expect(before).toContain('"unique":true'); // non-vacuous: the corpus does declare uniques
      expect(expectedBytes(converted())).toBe(before);
    });

    it('a database built from the bare spelling shows an EMPTY drift plan for the converted metadata', async () => {
      await driver.initObjects(NINE_KEY_CORPUS as any);
      expect(await driver.detectManagedDrift(converted() as any)).toEqual([]);

      // Control: one index stated per organization IS index drift here, so the
      // empty plan above is the detector reading, not the detector blind.
      const moved = converted().map((o) =>
        o.name === 'sys_presence' ? { ...o, indexes: [{ fields: ['session_id'], unique: 'organization' }] } : o,
      );
      const drift = await driver.detectManagedDrift(moved as any);
      expect(drift.filter((d) => d.table === 'sys_presence').length).toBeGreaterThan(0);
    });
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
    // The replacement is the plain composite (ADR-0131 D1).
    expect(Object.values(uniques)).toContainEqual(['organization_id', 'code']);

    // Existing data survived, and the cross-tenant insert now works.
    expect(await driver.count('product', {})).toBe(2);
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
    // The rebuild lands on the same plain composite as `initObjects` (ADR-0131 D1).
    expect(Object.values(uniques)).toContainEqual(['organization_id', 'code']);
    expect(Object.values(uniques)).not.toContainEqual(['code']);
    expect(Object.values(uniques)).not.toContainEqual(['COALESCE(organization_id)', 'code']);

    // Data preserved, and cross-tenant reuse still works post-rebuild.
    expect(await driver.count('product', {})).toBe(1);
    const b = await driver.create('product', { organization_id: 'org_b', code: 'C1', note: 'n' });
    expect(b.code).toBe('C1');
  });

  // ── ADR-0131 D1: the NULL-organization bucket is retired (#5030) ──────────

  describe('NULL organization under the plain key part (ADR-0131 D1, #5030)', () => {
    it('#5030 closed at the column: a fresh tenant column refuses a NULL organization outright', async () => {
      // The measured #5030 shape — the kernel injects `organization_id` and a
      // row leaves it NULL, slipping past a NULL-distinct composite — cannot
      // be written on a fresh table: the tenant column is NOT NULL (ADR-0131
      // D1), so the plain composite has no NULL rows to be void on.
      await driver.initObjects([
        {
          name: 'account',
          fields: {
            organization_id: { type: 'string' },
            email: { type: 'text', unique: true },
          },
        },
      ]);

      await expect(driver.create('account', { email: 'dup@example.com' })).rejects.toThrow(
        /NOT NULL constraint failed|null value in column/,
      );
      expect(await driver.count('account', {})).toBe(0);
    });

    it('on a pre-18 nullable column, NULL-organization rows are exempt; organizations stay unique (S8)', async () => {
      await driver.initObjects([
        {
          name: 'template',
          fields: {
            organization_id: { type: 'string' },
            key: { type: 'string', unique: true },
          },
        },
      ]);

      // Rows with no organization exist only on a database built before 18.x
      // (ADR-0131 D1 makes a fresh tenant column NOT NULL).
      await asPre18TenantColumn(driver, 'template');
      await driver.create('template', { key: 'welcome' });
      // …an organization may still hold the same value (per-org scope)…
      const org = await driver.create('template', { organization_id: 'org_a', key: 'welcome' });
      expect(org.key).toBe('welcome');
      // …a SECOND NULL-organization row is admitted too: the plain key part
      // is NULL-distinct, and ADR-0131 D1 retired the ADR-0120 D3 platform
      // bucket rather than rebuilding it…
      const second = await driver.create('template', { key: 'welcome' });
      expect(second.key).toBe('welcome');
      expect(await driver.count('template', { where: { key: 'welcome' } } as any)).toBe(3);
      // …while the organization itself is still held to one row per value.
      await expect(driver.create('template', { organization_id: 'org_a', key: 'welcome' })).rejects.toThrow(
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

      // Byte-for-byte the `unique: true` shape: the plain composite (ADR-0131 D1).
      const uniques = await uniqueIndexColumns('contact');
      expect(Object.values(uniques)).toContainEqual(['organization_id', 'email']);

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
    it('prepends the PLAIN organization column to the listed columns (ADR-0131 D1)', async () => {
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
        'organization_id',
        'department',
        'code',
      ]);

      // Per-organization semantics: two orgs may hold the same (department,
      // code); the same org may not; NULL-organization rows (pre-18 only)
      // are exempt — the plain key part is NULL-distinct (ADR-0131 D1).
      await driver.create('case_record', { organization_id: 'org_a', department: 'sales', code: 'C-1' });
      await driver.create('case_record', { organization_id: 'org_b', department: 'sales', code: 'C-1' });
      await expect(
        driver.create('case_record', { organization_id: 'org_a', department: 'sales', code: 'C-1' }),
      ).rejects.toThrow(/UNIQUE constraint failed|duplicate key value/);
      // Rows with no organization exist only on a database built before 18.x
      // (ADR-0131 D1 makes a fresh tenant column NOT NULL).
      await asPre18TenantColumn(driver, 'case_record');
      await driver.create('case_record', { department: 'sales', code: 'C-2' });
      const nullOrgTwin = await driver.create('case_record', { department: 'sales', code: 'C-2' });
      expect(nullOrgTwin.code).toBe('C-2');
      // The relaxation kept the index exactly as built: org_a is still refused.
      await expect(
        driver.create('case_record', { organization_id: 'org_a', department: 'sales', code: 'C-1' }),
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

    it('keeps a LISTED tenant column plain in place — the S6 respelling, not double-prepended', async () => {
      // The hand-written legacy shape, opted into the explicit vocabulary:
      // the author already listed the tenant column, so the org key part is
      // not prepended again — and since ADR-0131 D1 the listed column stays
      // the plain column, no longer rewritten to the NULL-safe form.
      await driver.initObjects([
        {
          name: 'team',
          fields: { organization_id: { type: 'string' }, name: { type: 'string' } },
          indexes: [{ fields: ['organization_id', 'name'], unique: 'organization' }],
        } as any,
      ]);

      const uniques = await uniqueIndexColumns('team');
      expect(uniques['uniq_team_organization_id_name']).toEqual(['organization_id', 'name']);

      await driver.create('team', { organization_id: 'org_a', name: 'Core' });
      await expect(driver.create('team', { organization_id: 'org_a', name: 'Core' })).rejects.toThrow(
        /UNIQUE constraint failed|duplicate key value/,
      );

      // Rows with no organization exist only on a database built before 18.x
      // (ADR-0131 D1 makes a fresh tenant column NOT NULL); there they are
      // exempt from the plain key part.
      await asPre18TenantColumn(driver, 'team');
      await driver.create('team', { name: 'Core' });
      const twin = await driver.create('team', { name: 'Core' });
      expect(twin.name).toBe('Core');
    });
  });

  // ── ADR-0120 D4 retired: a bare composite IS the expectation (ADR-0131 D1) ─

  describe('bare composite from a pre-18 database — no tightening proposed (ADR-0131 D1)', () => {
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

    it("boots under autoMigrate: 'safe' with the bare composite untouched and ZERO drift", async () => {
      // ADR-0120 D4 used to propose `recreate_index` (bare → COALESCE) here.
      // The expectation is the plain composite now, which this index already
      // is — so there is nothing to tighten.
      await driver.disconnect();
      driver = makeDriver({ autoMigrate: 'safe' });
      const k = await seedBareComposite();
      await k('product').insert([
        { id: 'r1', organization_id: 'org_a', code: 'C1' },
        { id: 'r2', organization_id: null, code: 'C1' },
      ]);

      await driver.initObjects(productMeta);

      const uniques = await uniqueIndexColumns('product');
      expect(uniques['uniq_product_organization_id_code']).toEqual(['organization_id', 'code']);
      expect(await driver.detectManagedDrift()).toHaveLength(0);
      // Per organization still enforced; a NULL-organization row is exempt.
      await expect(driver.create('product', { organization_id: 'org_a', code: 'C1' })).rejects.toThrow(
        /UNIQUE constraint failed|duplicate key value/,
      );
      const nullOrg = await driver.create('product', { code: 'C1' });
      expect(nullOrg.code).toBe('C1');
    });

    it('duplicate NULL-organization rows are no longer a blocker — no op proposed, rows and index kept', async () => {
      // The data that used to BLOCK the D4 tightening: duplicates the
      // NULL-distinct index admitted. Under the plain expectation they are
      // not a violation of anything the driver asks for.
      await driver.disconnect();
      driver = makeDriver({ autoMigrate: 'safe' });
      const k = await seedBareComposite();
      await k('product').insert([
        { id: 'r1', organization_id: null, code: 'DUP' },
        { id: 'r2', organization_id: null, code: 'DUP' },
      ]);

      await driver.initObjects(productMeta);
      expect((await uniqueIndexColumns('product'))['uniq_product_organization_id_code']).toEqual([
        'organization_id',
        'code',
      ]);

      const drift = await driver.detectManagedDrift();
      expect(drift.filter((d) => d.op.type === 'recreate_index')).toEqual([]);
      expect(drift).toHaveLength(0);
      expect(await driver.count('product', {})).toBe(2);
    });
  });
});
