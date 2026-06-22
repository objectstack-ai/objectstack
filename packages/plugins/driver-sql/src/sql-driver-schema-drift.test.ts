// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqlDriver } from '../src/index.js';

/**
 * Managed-schema drift detection + reconcile (#2186).
 *
 * The driver's `initObjects` sync is additive-only. These tests exercise the
 * non-additive paths it could never fix before: detecting divergence, the
 * dev-only loosen auto-reconcile, and the destructive reconcile `os migrate`
 * uses.
 */
describe('SqlDriver managed-schema drift (#2186)', () => {
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
  });

  // Build an "existing DB" table where organization_id is NOT NULL (the shape
  // a DB created while the field was `required: true` has — the #2178 repro).
  const seedLegacyTable = async (driver: SqlDriver) => {
    await knexInstance.schema.createTable('biz_unit', (t: any) => {
      t.string('id').primary();
      t.timestamp('created_at');
      t.timestamp('updated_at');
      t.string('name').notNullable();
      t.string('organization_id').notNullable();
    });
    await knexInstance('biz_unit').insert({ id: '1', name: 'Acme', organization_id: 'org1' });
  };

  // Metadata after #2178: organization_id is now optional.
  const relaxedMeta = [
    {
      name: 'biz_unit',
      fields: {
        name: { type: 'string', required: true },
        organization_id: { type: 'string', required: false },
      },
    },
  ];

  describe('detectManagedDrift', () => {
    it('flags a NOT NULL column that metadata says is optional (safe / relax_not_null)', async () => {
      const driver = makeDriver();
      await seedLegacyTable(driver);
      await driver.initObjects(relaxedMeta);

      const drift = await driver.detectManagedDrift();
      const orgDrift = drift.find((d) => d.column === 'organization_id');
      expect(orgDrift).toBeDefined();
      expect(orgDrift!.kind).toBe('nullability_mismatch');
      expect(orgDrift!.category).toBe('safe');
      expect(orgDrift!.op.type).toBe('relax_not_null');
    });

    it('flags an orphaned physical column as destructive (unmapped_column)', async () => {
      const driver = makeDriver();
      await knexInstance.schema.createTable('biz_unit', (t: any) => {
        t.string('id').primary();
        t.string('name');
        t.string('legacy_code'); // not in metadata
      });
      await driver.initObjects([{ name: 'biz_unit', fields: { name: { type: 'string' } } }]);

      const drift = await driver.detectManagedDrift();
      const orphan = drift.find((d) => d.column === 'legacy_code');
      expect(orphan).toBeDefined();
      expect(orphan!.kind).toBe('unmapped_column');
      expect(orphan!.category).toBe('destructive');
      expect(orphan!.op.type).toBe('drop_column');
    });

    it('flags a required metadata field over a nullable column as destructive (tighten)', async () => {
      const driver = makeDriver();
      await knexInstance.schema.createTable('biz_unit', (t: any) => {
        t.string('id').primary();
        t.string('name'); // nullable
      });
      await driver.initObjects([{ name: 'biz_unit', fields: { name: { type: 'string', required: true } } }]);

      const drift = await driver.detectManagedDrift();
      const d = drift.find((x) => x.column === 'name');
      expect(d?.category).toBe('destructive');
      expect(d?.op.type).toBe('tighten_not_null');
    });

    it('does not flag varchar length on SQLite (no length enforcement)', async () => {
      const driver = makeDriver();
      await knexInstance.schema.createTable('biz_unit', (t: any) => {
        t.string('id').primary();
        t.string('name');
      });
      await driver.initObjects([{ name: 'biz_unit', fields: { name: { type: 'string', maxLength: 999 } } }]);
      const drift = await driver.detectManagedDrift();
      expect(drift.filter((d) => d.kind === 'type_mismatch')).toHaveLength(0);
    });

    it('reports no drift when metadata and physical schema agree', async () => {
      const driver = makeDriver();
      await driver.initObjects(relaxedMeta); // fresh table, built to spec
      const drift = await driver.detectManagedDrift();
      expect(drift).toHaveLength(0);
    });
  });

  describe("dev auto-reconcile (autoMigrate: 'safe')", () => {
    it('self-heals a NOT NULL→NULL relax on restart, preserving data, so an optional-field insert succeeds (#2178 repro)', async () => {
      const driver = makeDriver({ autoMigrate: 'safe' });
      await seedLegacyTable(driver);

      await driver.initObjects(relaxedMeta); // simulates restart after pull+rebuild

      // Column is now nullable...
      const info = await knexInstance('biz_unit').columnInfo();
      expect(info.organization_id.nullable).toBe(true);

      // ...the pre-existing row survived the rebuild...
      const rows = await knexInstance('biz_unit').select('*');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: '1', name: 'Acme', organization_id: 'org1' });

      // ...and a write that omits the now-optional field succeeds.
      await expect(
        knexInstance('biz_unit').insert({ id: '2', name: 'Beta' }),
      ).resolves.toBeDefined();

      // No residual drift.
      expect(await driver.detectManagedDrift()).toHaveLength(0);
    });

    it('does NOT auto-apply destructive drift (orphan column kept; warned instead)', async () => {
      const driver = makeDriver({ autoMigrate: 'safe' });
      await knexInstance.schema.createTable('biz_unit', (t: any) => {
        t.string('id').primary();
        t.string('name');
        t.string('legacy_code');
      });
      await driver.initObjects([{ name: 'biz_unit', fields: { name: { type: 'string' } } }]);

      const info = await knexInstance('biz_unit').columnInfo();
      expect(info).toHaveProperty('legacy_code'); // not dropped
      // P1 acceptance: boot logs a clear, actionable warning per divergence.
      const warn = (driver as any).logger.warn as ReturnType<typeof vi.fn>;
      expect(warn).toHaveBeenCalled();
      const warnedDrift = warn.mock.calls.map((c: any[]) => String(c[0])).join('\n');
      expect(warnedDrift).toMatch(/os migrate/);
    });

    it('is force-disabled under NODE_ENV=production (warns, does not alter)', async () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const driver = makeDriver({ autoMigrate: 'safe' });
        await seedLegacyTable(driver);
        await driver.initObjects(relaxedMeta);
        const info = await knexInstance('biz_unit').columnInfo();
        expect(info.organization_id.nullable).toBe(false); // unchanged
      } finally {
        process.env.NODE_ENV = prev;
      }
    });
  });

  describe('in-place ALTER SQL (Postgres / MySQL)', () => {
    // No live PG/MySQL in CI — assert the generated DDL by spying on knex.raw.
    const opFor = (type: string): any => ({
      kind: 'x', table: 'biz_unit', column: 'organization_id', severity: 'warning',
      category: 'safe', message: 'm', op: { type, table: 'biz_unit', column: 'organization_id', to: 120 },
    });

    const spyDriver = (client: string, columnInfo?: any) => {
      const d = new SqlDriver({ client, connection: { host: 'x', database: 'y', user: 'u' } } as any);
      knexInstance = (d as any).knex;
      (d as any).logger = { warn: vi.fn(), info: vi.fn() };
      const calls: string[] = [];
      (d as any).knex = Object.assign(
        (_t: string) => ({ columnInfo: async () => columnInfo ?? {} }),
        { raw: vi.fn(async (sql: string) => { calls.push(sql); return {}; }) },
      );
      return { d, calls };
    };

    it('Postgres emits standard ALTER COLUMN statements', async () => {
      const { d, calls } = spyDriver('pg');
      expect(await (d as any).applyDriftOpInPlace(opFor('relax_not_null').op)).toBe(true);
      expect(await (d as any).applyDriftOpInPlace(opFor('tighten_not_null').op)).toBe(true);
      expect(await (d as any).applyDriftOpInPlace(opFor('widen_varchar').op)).toBe(true);
      expect(await (d as any).applyDriftOpInPlace(opFor('drop_column').op)).toBe(true);
      expect(calls[0]).toMatch(/ALTER COLUMN \?\? DROP NOT NULL/);
      expect(calls[1]).toMatch(/ALTER COLUMN \?\? SET NOT NULL/);
      expect(calls[2]).toMatch(/TYPE varchar\(120\)/);
      expect(calls[3]).toMatch(/DROP COLUMN/);
    });

    it('MySQL MODIFY reconstructs char length so a nullability change keeps it', async () => {
      const { d, calls } = spyDriver('mysql2', { organization_id: { type: 'varchar', maxLength: 255 } });
      expect(await (d as any).applyDriftOpInPlace(opFor('relax_not_null').op)).toBe(true);
      expect(calls[0]).toMatch(/MODIFY \?\? varchar\(255\) NULL/);
    });
  });

  describe('applyMigrationEntries (os migrate apply core)', () => {
    it('relaxes NOT NULL without allowDestructive', async () => {
      const driver = makeDriver();
      await seedLegacyTable(driver);
      await driver.initObjects(relaxedMeta);

      const drift = await driver.detectManagedDrift();
      const { applied, skipped } = await driver.applyMigrationEntries(drift, { allowDestructive: false });
      expect(applied.some((d) => d.op.type === 'relax_not_null')).toBe(true);
      expect(skipped).toHaveLength(0);
      expect((await knexInstance('biz_unit').columnInfo()).organization_id.nullable).toBe(true);
    });

    it('skips destructive drops unless allowDestructive, then drops with it', async () => {
      const driver = makeDriver();
      await knexInstance.schema.createTable('biz_unit', (t: any) => {
        t.string('id').primary();
        t.string('name');
        t.string('legacy_code');
      });
      await knexInstance('biz_unit').insert({ id: '1', name: 'Acme', legacy_code: 'x' });
      await driver.initObjects([{ name: 'biz_unit', fields: { name: { type: 'string' } } }]);

      const drift = await driver.detectManagedDrift();

      // Without the flag: orphan is skipped, column kept.
      const r1 = await driver.applyMigrationEntries(drift, { allowDestructive: false });
      expect(r1.skipped.some((d) => d.op.type === 'drop_column')).toBe(true);
      expect(await knexInstance('biz_unit').columnInfo()).toHaveProperty('legacy_code');

      // With the flag: orphan dropped, data preserved.
      const r2 = await driver.applyMigrationEntries(drift, { allowDestructive: true });
      expect(r2.applied.some((d) => d.op.type === 'drop_column')).toBe(true);
      const info = await knexInstance('biz_unit').columnInfo();
      expect(info).not.toHaveProperty('legacy_code');
      const rows = await knexInstance('biz_unit').select('*');
      expect(rows[0]).toMatchObject({ id: '1', name: 'Acme' });
    });
  });
});
