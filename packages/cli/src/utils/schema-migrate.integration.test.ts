// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { bootSchemaStack } from './schema-migrate.js';

/**
 * End-to-end (#2186): boot the real standalone stack via `bootSchemaStack`
 * against a pre-seeded "legacy" SQLite DB (organization_id created NOT NULL),
 * then verify `os migrate`'s engine detects the drift and reconciles it —
 * exercising the full createStandaloneStack → AppPlugin → ObjectQL → driver path.
 */
describe('bootSchemaStack + migrate engine (integration)', () => {
  let dir: string;
  let dbFile: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-mig-'));
    mkdirSync(join(dir, 'dist'), { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    dbFile = join(dir, 'data', 'app.db');

    // Compiled-artifact stand-in: id at top level so AppPlugin registers it.
    writeFileSync(
      join(dir, 'dist', 'objectstack.json'),
      JSON.stringify({
        id: 'mig_smoke',
        name: 'Migrate Smoke',
        objects: [
          {
            name: 'mig_biz_unit',
            fields: {
              name: { type: 'text', required: true },
              organization_id: { type: 'text', required: false }, // optional now
            },
          },
        ],
      }),
    );

    // Seed a "legacy" DB where organization_id is NOT NULL (the #2178 shape).
    const seed = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
    const k = (seed as any).knex;
    await k.schema.createTable('mig_biz_unit', (t: any) => {
      t.string('id').primary();
      t.timestamp('created_at');
      t.timestamp('updated_at');
      t.string('name').notNullable();
      t.string('organization_id').notNullable();
    });
    await k('mig_biz_unit').insert({ id: '1', name: 'Acme', organization_id: 'org1' });
    await k.destroy();

    savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
    process.env.NODE_ENV = 'production'; // ensure no auto-reconcile masks the drift
  });

  afterAll(() => {
    process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('detects the NOT NULL drift, applies it, and self-verifies in-sync', async () => {
    const stack = await bootSchemaStack({ databaseUrl: `file:${dbFile}` });
    try {
      expect(stack.driver).toBeTruthy();
      expect(stack.managedTableCount).toBeGreaterThan(0);

      const drift = await stack.driver!.detectManagedDrift();
      const org = drift.find((d) => d.table === 'mig_biz_unit' && d.column === 'organization_id');
      expect(org, 'expected drift on mig_biz_unit.organization_id').toBeDefined();
      expect(org!.category).toBe('safe');
      expect(org!.op.type).toBe('relax_not_null');

      const { applied, skipped } = await stack.driver!.applyMigrationEntries(drift, { allowDestructive: false });
      expect(applied.some((d) => d.op.type === 'relax_not_null')).toBe(true);
      expect(skipped).toHaveLength(0);

      const after = await stack.driver!.detectManagedDrift();
      expect(after.find((d) => d.table === 'mig_biz_unit' && d.column === 'organization_id')).toBeUndefined();
    } finally {
      await stack.shutdown();
    }
  }, 30_000);
});
