// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { bootSchemaStack } from './schema-migrate.js';

/**
 * End-to-end (#2186, #3728): boot the real standalone stack via
 * `bootSchemaStack` against a pre-seeded "legacy" SQLite DB — `organization_id`
 * created NOT NULL, and a platform-wide UNIQUE index on a field metadata now
 * scopes per tenant — then verify `os migrate`'s engine detects BOTH drifts and
 * reconciles them, exercising the full createStandaloneStack → AppPlugin →
 * ObjectQL → driver path.
 *
 * The index half is the #3728 acceptance: under `NODE_ENV=production` nothing
 * self-heals at boot, so whatever `plan` reports here is exactly what an
 * operator would see before any DDL touches their database.
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
              code: { type: 'text', unique: true }, // tenant-scoped since #3696
            },
          },
        ],
      }),
    );

    // Seed a "legacy" DB: organization_id NOT NULL (the #2178 shape) plus the
    // platform-wide unique index on `code` the pre-#3696 driver emitted.
    const seed = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
    const k = (seed as any).knex;
    await k.schema.createTable('mig_biz_unit', (t: any) => {
      t.string('id').primary();
      t.timestamp('created_at');
      t.timestamp('updated_at');
      t.string('name').notNullable();
      t.string('organization_id').notNullable();
      t.string('code');
    });
    await k.raw('CREATE UNIQUE INDEX mig_biz_unit_code_unique ON mig_biz_unit (code)');
    await k('mig_biz_unit').insert({ id: '1', name: 'Acme', organization_id: 'org1', code: 'BU-00001' });
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

  it('detects the NOT NULL + legacy-unique drift, applies both, and self-verifies in-sync', async () => {
    const stack = await bootSchemaStack({ jsonOutput: false, databaseUrl: `file:${dbFile}`, projectRoot: dir });
    try {
      expect(stack.driver).toBeTruthy();
      expect(stack.managedTableCount).toBeGreaterThan(0);

      // Boot changed nothing — this is exactly what `os migrate plan` renders.
      const drift = await stack.driver!.detectManagedDrift();

      const org = drift.find((d) => d.table === 'mig_biz_unit' && d.column === 'organization_id');
      expect(org, 'expected drift on mig_biz_unit.organization_id').toBeDefined();
      // ADR-0113: a column stricter than its declaration is needs_confirm —
      // reported by plan, applied by an explicit `os migrate apply` (the human
      // IS the confirmation), but never by dev auto-reconcile.
      expect(org!.category).toBe('needs_confirm');
      expect(org!.op.type).toBe('relax_not_null');

      // #3728: the legacy platform-wide unique is PLANNED, not silently rewritten.
      const idx = drift.find((d) => d.op.type === 'replace_unique_index');
      expect(idx, 'expected replace_unique_index drift on mig_biz_unit.code').toBeDefined();
      expect(idx!.category).toBe('safe');
      expect(idx!.op).toMatchObject({
        table: 'mig_biz_unit',
        dropIndexNames: ['mig_biz_unit_code_unique'],
        createColumns: ['organization_id', 'code'],
      });

      const { applied, skipped } = await stack.driver!.applyMigrationEntries(drift, { allowDestructive: false });
      expect(applied.some((d) => d.op.type === 'relax_not_null')).toBe(true);
      expect(applied.some((d) => d.op.type === 'replace_unique_index')).toBe(true);
      expect(skipped).toHaveLength(0);

      const after = await stack.driver!.detectManagedDrift();
      expect(after.find((d) => d.table === 'mig_biz_unit' && d.column === 'organization_id')).toBeUndefined();
      expect(after.find((d) => d.op.type === 'replace_unique_index')).toBeUndefined();

      // The seeded row survived the reconcile.
      expect(await (stack.driver as any).count('mig_biz_unit', {})).toBe(1);
    } finally {
      await stack.shutdown();
    }
  }, 30_000);
});

/**
 * #3955 — `os migrate` and the dev runtime must compute ONE schema view.
 *
 * A zh-locale deployment's dev runtime provisions the hidden `__search`
 * pinyin companion column (ADR-0098) on every eligible object. The migrate
 * boot goes through `createStandaloneStack`, which — before the fix — never
 * derived the locale-gated pinyin decision from the artifact, so its metadata
 * lacked every companion column and `os migrate plan` reported each live
 * `__search` column as a destructive orphan, with `--allow-destructive` as
 * the printed remediation. Following that advice would have dropped live
 * feature columns.
 */
describe('bootSchemaStack — dev-provisioned __search companions are not orphans (#3955)', () => {
  let dir: string;
  let dbFile: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-mig-pinyin-'));
    mkdirSync(join(dir, 'dist'), { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    dbFile = join(dir, 'data', 'app.db');

    // Compiled-artifact stand-in for a Chinese deployment: the i18n block is
    // exactly what `os build` compiles out of `objectstack.config.ts`.
    writeFileSync(
      join(dir, 'dist', 'objectstack.json'),
      JSON.stringify({
        id: 'mig_pinyin_smoke',
        name: 'Migrate Pinyin Smoke',
        i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'], fallbackLocale: 'en' },
        objects: [
          {
            name: 'mig_person',
            fields: {
              name: { type: 'text', required: true },
              email: { type: 'text' },
            },
          },
        ],
      }),
    );

    // Seed the database the way a dev-runtime first boot leaves it: the
    // object's columns PLUS the provisioned `__search` companion.
    const seed = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
    const k = (seed as any).knex;
    await k.schema.createTable('mig_person', (t: any) => {
      t.string('id').primary();
      t.timestamp('created_at');
      t.timestamp('updated_at');
      t.string('name').notNullable();
      t.string('email');
      t.string('__search');
    });
    await k('mig_person').insert({ id: '1', name: '张伟', email: 'zw@example.com', __search: 'zhangwei zw' });
    await k.destroy();

    savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    savedEnv.OS_SEARCH_PINYIN_ENABLED = process.env.OS_SEARCH_PINYIN_ENABLED;
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
    process.env.NODE_ENV = 'production';
    // The defect precondition: nothing external decided pinyin — the boot must
    // derive it from the artifact's locales, exactly like serve/dev does.
    delete process.env.OS_SEARCH_PINYIN_ENABLED;
  });

  afterAll(() => {
    process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.OS_SEARCH_PINYIN_ENABLED === undefined) delete process.env.OS_SEARCH_PINYIN_ENABLED;
    else process.env.OS_SEARCH_PINYIN_ENABLED = savedEnv.OS_SEARCH_PINYIN_ENABLED;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('the migrate boot provisions the companion in metadata, so plan reports no __search drift', async () => {
    const stack = await bootSchemaStack({ jsonOutput: false, databaseUrl: `file:${dbFile}`, projectRoot: dir });
    try {
      expect(stack.driver).toBeTruthy();

      // The fix, observed at the seam: the artifact's zh-CN locale was stamped
      // into the pinyin decision, so the migrate boot's OWN metadata carries
      // the companion column — the same schema view the dev runtime serves.
      const managed = (stack.driver as any).managedObjectFields.get('mig_person');
      expect(managed, 'mig_person must be metadata-managed').toBeDefined();
      expect(Object.keys(managed)).toContain('__search');

      // And the defect, gone: no drift on __search — before the fix this was a
      // destructive drop_column "orphaned" finding pointing at --allow-destructive.
      const drift = await stack.driver!.detectManagedDrift();
      const searchDrift = drift.filter((d) => d.column === '__search');
      expect(searchDrift).toEqual([]);
      expect(drift.filter((d) => d.category === 'destructive')).toEqual([]);
    } finally {
      await stack.shutdown();
    }
  }, 30_000);
});
