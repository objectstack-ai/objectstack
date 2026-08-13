// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  SqlDriver,
  classifyIndexKeyPart,
  diffManagedIndexes,
  isManagedIndexName,
  parseIndexDdl,
} from '../src/index.js';

/**
 * Index-dimension managed-schema drift (#3728).
 *
 * The gap this closes: `detectManagedDrift` was column-only, so the #3696
 * unique-scope migration had nowhere to surface. It compensated by executing
 * its DROP + CREATE inline during `initObjects` — in every environment,
 * production included — leaving one log line and nothing for `os migrate plan`
 * to show. An operator who wanted to eyeball the DDL before it hit the database
 * had no way to.
 *
 * The contract now:
 *   - `syncTableIndexes` is ADDITIVE ONLY. It never drops or rewrites an index.
 *   - The legacy retirement is a `replace_unique_index` drift entry: visible in
 *     `os migrate plan`, applied by `os migrate apply`, and auto-applied at boot
 *     only under the same dev `autoMigrate: 'safe'` policy that governs every
 *     other safe drift (#2186).
 *   - Declared-index drift (missing / redefined / orphaned) is detected too.
 */
describe('SqlDriver index drift (#3728)', () => {
  let knexInstance: any;

  const makeDriver = (opts: any = {}) => {
    const d = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      ...opts,
    });
    knexInstance = (d as any).knex;
    (d as any).logger = { warn: vi.fn(), info: vi.fn() };
    return d;
  };

  afterEach(async () => {
    await knexInstance?.destroy();
    knexInstance = undefined;
  });

  /** The pre-#3696 physical shape: a global unique index on a tenant-scoped field. */
  const seedLegacyGlobalUnique = async (indexName = 'product_code_unique') => {
    await knexInstance.schema.createTable('product', (t: any) => {
      t.string('id').primary();
      t.string('organization_id');
      t.string('code');
    });
    await knexInstance.raw(`CREATE UNIQUE INDEX ${indexName} ON product (code)`);
    await knexInstance('product').insert([
      { id: 'r1', organization_id: 'org_a', code: 'PROD-00001' },
      { id: 'r2', organization_id: 'org_a', code: 'PROD-00002' },
    ]);
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

  /**
   * Unique index name → canonical key parts, read from the index DDL so
   * expression keys are visible (`PRAGMA index_info` reports a NULL name for
   * them). A plain column reads as its name; the NULL-safe organization key
   * part (ADR-0120 D3) reads as `COALESCE(<column>)` — literal elided, the
   * same literal-agnostic identity the drift differ compares on.
   */
  const uniqueIndexColumns = async (table: string): Promise<Record<string, string[]>> => {
    const list: any = await knexInstance.raw(`PRAGMA index_list(${table})`);
    const master: any = await knexInstance.raw(
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
        const info: any = await knexInstance.raw(`PRAGMA index_info("${idx.name}")`);
        out[idx.name] = info.map((c: any) => c.name);
      }
    }
    return out;
  };

  // ── The issue: the migration is now VISIBLE before it runs ────────────────

  describe('the legacy unique migration is planned, not silently executed', () => {
    it('boot leaves the legacy index in place (autoMigrate off) and reports it as safe drift', async () => {
      const driver = makeDriver(); // autoMigrate defaults to 'off' — i.e. production
      await seedLegacyGlobalUnique();
      await driver.initObjects(productMeta);

      // The DDL did NOT happen behind the operator's back...
      const uniques = await uniqueIndexColumns('product');
      expect(uniques['product_code_unique']).toEqual(['code']);

      // ...and `os migrate plan` can see exactly what it would do.
      const drift = await driver.detectManagedDrift();
      const entry = drift.find((d) => d.op.type === 'replace_unique_index');
      expect(entry).toBeDefined();
      expect(entry!.kind).toBe('index_mismatch');
      expect(entry!.category).toBe('safe');
      expect(entry!.table).toBe('product');
      expect(entry!.op).toMatchObject({
        dropIndexNames: ['product_code_unique'],
        createColumns: ['organization_id', 'code'],
      });
      expect(entry!.message).toMatch(/os migrate apply/);
    });

    it('warns at boot with an actionable hint instead of running the DDL', async () => {
      const driver = makeDriver();
      await seedLegacyGlobalUnique();
      await driver.initObjects(productMeta);

      const warned = ((driver as any).logger.warn as ReturnType<typeof vi.fn>).mock.calls
        .map((c: any[]) => String(c[0]))
        .join('\n');
      expect(warned).toMatch(/os migrate/);
      expect(warned).toMatch(/product\.code/);
    });

    it('detects the `uniq_<table>_<col>` spelling the old rebuild path emitted', async () => {
      const driver = makeDriver();
      await seedLegacyGlobalUnique('uniq_product_code');
      await driver.initObjects(productMeta);

      const drift = await driver.detectManagedDrift();
      const entry = drift.find((d) => d.op.type === 'replace_unique_index');
      expect((entry!.op as any).dropIndexNames).toEqual(['uniq_product_code']);
    });

    it("does NOT report a unique: 'global' field's single-column index", async () => {
      const driver = makeDriver();
      await knexInstance.schema.createTable('runtime', (t: any) => {
        t.string('id').primary();
        t.string('organization_id');
        t.string('hostname');
      });
      await knexInstance.raw('CREATE UNIQUE INDEX uniq_runtime_hostname ON runtime (hostname)');

      await driver.initObjects([
        {
          name: 'runtime',
          fields: {
            organization_id: { type: 'string' },
            hostname: { type: 'string', unique: 'global' },
          },
        },
      ]);

      expect(await driver.detectManagedDrift()).toHaveLength(0);
    });

    it('reports nothing once the composite is the only unique index', async () => {
      const driver = makeDriver();
      await driver.initObjects(productMeta); // fresh table, built to spec
      expect(await driver.detectManagedDrift()).toHaveLength(0);
    });
  });

  // ── #3955: a DECLARED single-column unique is not legacy debt ─────────────
  //
  // An object may declare both a tenant-scoped field-level `unique: true` and
  // an object-level single-column unique index on the same column (HotCRM's
  // `crm_contact` does exactly this: `email: { unique: true }` plus
  // `indexes: [{ fields: ['email'], unique: true }]`). The declared index
  // materializes under `buildIndexName` — `uniq_<table>_<col>` — which is also
  // one of the two spellings the legacy detector looks for. It was therefore
  // reported as pre-#3696 debt to be dropped, and the plan never converged.
  describe('a currently-declared single-column unique index is never called legacy (#3955)', () => {
    const contactMeta = [
      {
        name: 'hp_contact',
        fields: {
          organization_id: { type: 'string' },
          email: { type: 'string', unique: true },
          last_name: { type: 'string' },
        },
        indexes: [
          { fields: ['email'], unique: true },
          { fields: ['last_name'] },
        ],
      },
    ];

    it('builds both indexes and then reports NO drift on a fresh table', async () => {
      const driver = makeDriver();
      await driver.initObjects(contactMeta);

      // Both are current intent: the tenant composite from the field-level
      // `unique: true`, and the verbatim declared global unique.
      const uniques = await uniqueIndexColumns('hp_contact');
      expect(uniques['uniq_hp_contact_organization_id_email']).toEqual(['COALESCE(organization_id)', 'email']);
      expect(uniques['uniq_hp_contact_email']).toEqual(['email']);

      // Before the fix this reported `replace_unique_index` — proposing to drop
      // the index the very same sync had just created from metadata.
      expect(await driver.detectManagedDrift()).toHaveLength(0);
    });

    it('does not ping-pong: applying the plan converges instead of recreating work', async () => {
      const driver = makeDriver();
      await driver.initObjects(contactMeta);

      // Round 1: nothing to do. Round 2 (the old loop's second half) likewise —
      // the declared index is still there, so nothing reports it missing.
      for (let round = 0; round < 3; round++) {
        const drift = await driver.detectManagedDrift();
        expect(drift, `round ${round + 1} should be clean`).toHaveLength(0);
        await driver.applyMigrationEntries(drift, { allowDestructive: false });
      }

      const uniques = await uniqueIndexColumns('hp_contact');
      expect(Object.keys(uniques).sort()).toEqual([
        'uniq_hp_contact_email',
        'uniq_hp_contact_organization_id_email',
      ]);
    });

    it('still retires a genuinely legacy index when metadata declares no such index', async () => {
      // The #3728 behaviour must survive the filter: the same `uniq_<table>_<col>`
      // spelling IS legacy when nothing in metadata declares it.
      const driver = makeDriver();
      await seedLegacyGlobalUnique('uniq_product_code');
      await driver.initObjects(productMeta); // no declared `indexes[]`

      const drift = await driver.detectManagedDrift();
      const entry = drift.find((d) => d.op.type === 'replace_unique_index');
      expect(entry, 'a legacy index nobody declares must still be retired').toBeDefined();
      expect((entry!.op as any).dropIndexNames).toEqual(['uniq_product_code']);
    });

    it('retires the knex-spelled legacy index even when the buildIndexName spelling is declared', async () => {
      // Only the declared spelling is exempt. A pre-#3696 `<table>_<col>_unique`
      // left over from the old createColumn path is still debt.
      const driver = makeDriver();
      await knexInstance.schema.createTable('hp_contact', (t: any) => {
        t.string('id').primary();
        t.string('organization_id');
        t.string('email');
        t.string('last_name');
      });
      await knexInstance.raw('CREATE UNIQUE INDEX hp_contact_email_unique ON hp_contact (email)');
      await driver.initObjects(contactMeta);

      const drift = await driver.detectManagedDrift();
      const entry = drift.find((d) => d.op.type === 'replace_unique_index');
      expect(entry).toBeDefined();
      expect((entry!.op as any).dropIndexNames).toEqual(['hp_contact_email_unique']);
    });
  });

  // ── Applying it through `os migrate apply` ────────────────────────────────

  describe('applyMigrationEntries', () => {
    it('replaces the legacy global unique WITHOUT --allow-destructive, preserving data', async () => {
      const driver = makeDriver();
      await seedLegacyGlobalUnique();
      await driver.initObjects(productMeta);

      const drift = await driver.detectManagedDrift();
      const { applied, skipped } = await driver.applyMigrationEntries(drift, { allowDestructive: false });
      expect(applied.some((d) => d.op.type === 'replace_unique_index')).toBe(true);
      expect(skipped).toHaveLength(0);

      const uniques = await uniqueIndexColumns('product');
      expect(uniques['product_code_unique']).toBeUndefined();
      expect(Object.values(uniques)).toContainEqual(['COALESCE(organization_id)', 'code']);

      // Existing rows survived, and the cross-tenant insert the issue is about works.
      expect(await driver.count('product', {})).toBe(2);
      const b = await driver.create('product', { organization_id: 'org_b', code: 'PROD-00001' });
      expect(b.code).toBe('PROD-00001');

      // Converged: re-running finds nothing.
      expect(await driver.detectManagedDrift()).toHaveLength(0);
    });

    it('is idempotent — applying twice is a no-op the second time', async () => {
      const driver = makeDriver();
      await seedLegacyGlobalUnique();
      await driver.initObjects(productMeta);

      const drift = await driver.detectManagedDrift();
      await driver.applyMigrationEntries(drift, { allowDestructive: false });
      const again = await driver.applyMigrationEntries(drift, { allowDestructive: false });
      expect(again.skipped).toHaveLength(0);
      expect(Object.values(await uniqueIndexColumns('product'))).toContainEqual([
        'COALESCE(organization_id)',
        'code',
      ]);
    });
  });

  // ── Boot-time self-heal still exists, under the #2186 policy ──────────────

  describe("dev auto-reconcile (autoMigrate: 'safe')", () => {
    it('self-heals the legacy unique on restart, so the cross-tenant insert succeeds', async () => {
      const driver = makeDriver({ autoMigrate: 'safe' });
      await seedLegacyGlobalUnique();

      await driver.initObjects(productMeta); // simulates restart after pull+rebuild

      const uniques = await uniqueIndexColumns('product');
      expect(uniques['product_code_unique']).toBeUndefined();
      expect(Object.values(uniques)).toContainEqual(['COALESCE(organization_id)', 'code']);
      expect(await driver.detectManagedDrift()).toHaveLength(0);

      const b = await driver.create('product', { organization_id: 'org_b', code: 'PROD-00001' });
      expect(b.code).toBe('PROD-00001');
    });

    it('is force-disabled under NODE_ENV=production — the index survives untouched', async () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const driver = makeDriver({ autoMigrate: 'safe' });
        await seedLegacyGlobalUnique();
        await driver.initObjects(productMeta);

        expect((await uniqueIndexColumns('product'))['product_code_unique']).toEqual(['code']);
        expect(
          (await driver.detectManagedDrift()).some((d) => d.op.type === 'replace_unique_index'),
        ).toBe(true);
      } finally {
        process.env.NODE_ENV = prev;
      }
    });
  });

  // ── Declared `indexes[]` drift (the issue's "附带发现") ────────────────────

  describe('declared index drift', () => {
    it('flags a declared index the database is missing (safe / create_index)', async () => {
      const driver = makeDriver();
      await knexInstance.schema.createTable('slug_reservation', (t: any) => {
        t.string('id').primary();
        t.string('slug');
      });
      // Register the metadata without letting the additive sync materialize it,
      // so we observe what an operator sees when a create was skipped or failed.
      (driver as any).managedObjectFields.set('slug_reservation', { slug: { type: 'string' } });
      (driver as any).managedObjectIndexes.set('slug_reservation', [
        { fields: ['slug'], unique: true },
      ]);

      const drift = await driver.detectManagedDrift();
      const entry = drift.find((d) => d.op.type === 'create_index');
      expect(entry).toBeDefined();
      expect(entry!.category).toBe('safe');
      expect((entry!.op as any).indexName).toBe('uniq_slug_reservation_slug');

      await driver.applyMigrationEntries(drift, { allowDestructive: false });
      expect(Object.values(await uniqueIndexColumns('slug_reservation'))).toContainEqual(['slug']);
    });

    it('flags an index whose definition no longer matches the declaration (recreate_index)', async () => {
      const driver = makeDriver();
      await driver.initObjects([
        {
          name: 'domain',
          fields: { organization_id: { type: 'string' }, host: { type: 'string' } },
          indexes: [{ name: 'domain_host_idx', fields: ['host'] }],
        } as any,
      ]);

      // Metadata now wants (organization_id, host) under the SAME name — the
      // additive sync skips by name, so this can never self-heal.
      const drift = await driver.detectManagedDrift([
        {
          name: 'domain',
          fields: { organization_id: { type: 'string' }, host: { type: 'string' } },
          indexes: [{ name: 'domain_host_idx', fields: ['organization_id', 'host'] }],
        } as any,
      ]);
      const entry = drift.find((d) => d.op.type === 'recreate_index');
      expect(entry).toBeDefined();
      expect(entry!.category).toBe('needs_confirm'); // non-unique → cannot fail
      expect(entry!.actual).toBe('(host)');
      expect(entry!.expected).toBe('(organization_id, host)');

      await driver.applyMigrationEntries(drift, { allowDestructive: false });
      const list: any = await knexInstance.raw(`PRAGMA index_info("domain_host_idx")`);
      expect(list.map((c: any) => c.name)).toEqual(['organization_id', 'host']);
    });

    it('rates a redefinition that TIGHTENS to UNIQUE as destructive', async () => {
      const driver = makeDriver();
      await driver.initObjects([
        {
          name: 'domain',
          fields: { host: { type: 'string' } },
          indexes: [{ name: 'domain_host_idx', fields: ['host'] }],
        } as any,
      ]);

      const drift = await driver.detectManagedDrift([
        {
          name: 'domain',
          fields: { host: { type: 'string' } },
          indexes: [{ name: 'domain_host_idx', fields: ['host'], unique: true }],
        } as any,
      ]);
      const entry = drift.find((d) => d.op.type === 'recreate_index');
      expect(entry!.category).toBe('destructive');

      // Skipped without the flag — the CREATE can fail on existing duplicates.
      const r = await driver.applyMigrationEntries(drift, { allowDestructive: false });
      expect(r.skipped.some((d) => d.op.type === 'recreate_index')).toBe(true);
    });

    it('flags an orphaned index we generated as destructive, and drops it with the flag', async () => {
      const driver = makeDriver();
      await driver.initObjects([
        {
          name: 'domain',
          fields: { organization_id: { type: 'string' }, host: { type: 'string' } },
          indexes: [{ fields: ['host'] }],
        } as any,
      ]);
      expect(await (driver as any).getExistingIndexNames('domain')).toContain('idx_domain_host');

      // The declaration is gone from metadata; the index is not.
      const objects = [
        { name: 'domain', fields: { organization_id: { type: 'string' }, host: { type: 'string' } } },
      ];
      const drift = await driver.detectManagedDrift(objects);
      const entry = drift.find((d) => d.op.type === 'drop_index');
      expect(entry).toBeDefined();
      expect(entry!.kind).toBe('unmapped_index');
      expect(entry!.category).toBe('destructive');

      expect(
        (await driver.applyMigrationEntries(drift, { allowDestructive: false })).skipped,
      ).toHaveLength(1);
      await driver.applyMigrationEntries(drift, { allowDestructive: true });
      expect(await (driver as any).getExistingIndexNames('domain')).not.toContain('idx_domain_host');
    });

    it("leaves a DBA's hand-rolled index alone — only our naming is orphan-eligible", async () => {
      const driver = makeDriver();
      await driver.initObjects([{ name: 'domain', fields: { host: { type: 'string' } } }]);
      await knexInstance.raw('CREATE INDEX host_lookup_covering ON domain (host)');

      expect(await driver.detectManagedDrift()).toHaveLength(0);
    });
  });

  // ── Pure differ units ─────────────────────────────────────────────────────

  describe('diffManagedIndexes / isManagedIndexName', () => {
    it('ignores a legacy NAME whose definition is not the legacy shape', async () => {
      // Same name, but it indexes a different column — dropping it would be a
      // pure mistake, so name matching alone must not be enough.
      const entries = diffManagedIndexes({
        table: 'product',
        expected: [{ name: 'uniq_product_organization_id_code', columns: ['organization_id', 'code'], unique: true }],
        legacy: [
          {
            column: 'code',
            legacyColumns: ['code'],
            legacyNames: ['product_code_unique'],
            replacement: { name: 'uniq_product_organization_id_code', columns: ['organization_id', 'code'], unique: true },
          },
        ],
        physical: [
          { name: 'product_code_unique', columns: ['sku'], unique: true },
          { name: 'uniq_product_organization_id_code', columns: ['organization_id', 'code'], unique: true },
        ],
      });
      expect(entries.filter((e) => e.op.type === 'replace_unique_index')).toHaveLength(0);
    });

    it('never treats the primary key index as drift', () => {
      const entries = diffManagedIndexes({
        table: 'product',
        expected: [],
        legacy: [],
        physical: [{ name: 'uniq_product_id', columns: ['id'], unique: true, primary: true }],
      });
      expect(entries).toHaveLength(0);
    });

    it('recognises the hash-suffixed long form of a generated name', () => {
      const table = 'a_very_long_table_name_that_forces_the_hash_suffix_path_here';
      expect(
        isManagedIndexName(table, {
          name: `uniq_${table}`.slice(0, 51) + '_deadbeef',
          columns: ['x'],
          unique: true,
        }),
      ).toBe(true);
      expect(isManagedIndexName(table, { name: 'ops_custom_idx', columns: ['x'], unique: false })).toBe(false);
    });
  });
});
