// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end acceptance for #3917: booting the migrate stack must not touch the
 * target database.
 *
 * The report's second finding was that `runtime.start()` boots the full plugin
 * set, `syncRegisteredSchemas` runs create-table/add-column DDL, and all of that
 * happens BEFORE `os migrate plan` renders a line or `os migrate apply` shows
 * its `[y/N]`. So the test that matters is not "does the driver have a flag" —
 * it is "after a real `bootSchemaStack`, is the database byte-for-byte what it
 * was?" That is what this asserts, through the same
 * createStandaloneStack → AppPlugin → ObjectQL → driver path the commands use.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { bootSchemaStack } from './schema-migrate.js';

const ARTIFACT = {
  id: 'defer_smoke',
  name: 'Defer Smoke',
  objects: [
    {
      name: 'defer_widget',
      fields: {
        name: { type: 'text', required: true },
        // Absent from the pre-existing table below — the additive sync would
        // have silently ALTERed it in at boot.
        colour: { type: 'text' },
      },
    },
    // No physical counterpart at all — the additive sync would have CREATEd it.
    { name: 'defer_gadget', fields: { label: { type: 'text' } } },
  ],
  // A seed the boot would otherwise write into the operator's live database.
  data: [{ object: 'defer_widget', records: [{ id: 'seed-1', name: 'Seeded' }] }],
};

describe('bootSchemaStack({ deferSchemaDdl }) — the boot writes nothing (#3917)', () => {
  let dir: string;
  let dbFile: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-defer-'));
    mkdirSync(join(dir, 'dist'), { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    dbFile = join(dir, 'data', 'app.db');
    writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(ARTIFACT));

    // One pre-existing table, missing the `colour` column.
    const seed = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
    const k = (seed as any).knex;
    await k.schema.createTable('defer_widget', (t: any) => {
      t.string('id').primary();
      t.timestamp('created_at');
      t.timestamp('updated_at');
      t.string('name');
    });
    await k('defer_widget').insert({ id: 'pre-1', name: 'Existing' });
    await k.destroy();

    savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
    process.env.NODE_ENV = 'production'; // no dev auto-reconcile
  });

  afterEach(() => {
    process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  /** Read the physical shape straight from the file, outside the booted stack. */
  async function inspect(): Promise<{ tables: string[]; widgetColumns: string[]; widgetRows: number }> {
    const d = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
    const k = (d as any).knex;
    try {
      const rows = await k.raw("SELECT name FROM sqlite_master WHERE type = 'table'");
      const tables = (rows as Array<{ name: string }>).map((r) => r.name).filter((n) => !n.startsWith('sqlite_'));
      const widgetColumns = tables.includes('defer_widget')
        ? Object.keys(await k('defer_widget').columnInfo()).sort()
        : [];
      const widgetRows = tables.includes('defer_widget')
        ? Number((await k('defer_widget').count({ n: '*' }))[0].n)
        : 0;
      return { tables: tables.sort(), widgetColumns, widgetRows };
    } finally {
      await k.destroy();
    }
  }

  it('leaves the schema and the rows exactly as they were, and reports what it held back', async () => {
    const before = await inspect();
    expect(before.tables).toEqual(['defer_widget']);
    expect(before.widgetColumns).toEqual(['created_at', 'id', 'name', 'updated_at']);

    const stack = await bootSchemaStack({ jsonOutput: false, databaseUrl: `file:${dbFile}`, deferSchemaDdl: true, projectRoot: dir });
    try {
      const after = await inspect();
      // The core assertion: boot created no table, added no column, wrote no
      // seed row. Before #3917 all three happened here.
      expect(after.tables).toEqual(before.tables);
      expect(after.widgetColumns).toEqual(before.widgetColumns);
      expect(after.widgetRows).toBe(before.widgetRows);

      // …and the work it held back is reported, so the plan can show it.
      const pending = stack.pendingSchemaWork;
      expect(pending.find((p) => p.table === 'defer_gadget')).toMatchObject({ kind: 'create_table' });
      const widget = pending.find((p) => p.table === 'defer_widget');
      expect(widget?.kind).toBe('add_columns');
      // `colour` plus the platform-injected fields (organization_id, owner_id,
      // …) the pre-existing table predates — every one of them an ALTER the
      // boot used to run unannounced.
      expect(widget?.columns).toContain('colour');

      // Drift detection still works — deferring the DDL must not blind it.
      expect(stack.managedTableCount).toBeGreaterThan(0);
      await expect(stack.driver!.detectManagedDrift()).resolves.toBeInstanceOf(Array);
    } finally {
      await stack.shutdown();
    }
  }, 60_000);

  it('flushSchemaDdl performs exactly the work that was reported', async () => {
    const stack = await bootSchemaStack({ jsonOutput: false, databaseUrl: `file:${dbFile}`, deferSchemaDdl: true, projectRoot: dir });
    try {
      const pending = stack.pendingSchemaWork;
      const performed = await stack.flushSchemaDdl();
      expect(performed).toEqual(pending);

      const after = await inspect();
      expect(after.tables).toContain('defer_gadget');
      expect(after.widgetColumns).toContain('colour');
      // Still no seed row — suppressing the seed is not undone by the flush.
      expect(after.widgetRows).toBe(1);

      // A second boot finds nothing left to do.
      await stack.shutdown();
      const again = await bootSchemaStack({ jsonOutput: false, databaseUrl: `file:${dbFile}`, deferSchemaDdl: true, projectRoot: dir });
      try {
        expect(again.pendingSchemaWork).toEqual([]);
      } finally {
        await again.shutdown();
      }
    } catch (e) {
      await stack.shutdown().catch(() => { /* already down */ });
      throw e;
    }
  }, 60_000);

  it('without the flag, the boot syncs as it always did', async () => {
    const stack = await bootSchemaStack({ jsonOutput: false, databaseUrl: `file:${dbFile}`, projectRoot: dir });
    try {
      expect(stack.pendingSchemaWork).toEqual([]);
      const after = await inspect();
      expect(after.tables).toContain('defer_gadget');
      expect(after.widgetColumns).toContain('colour');
      expect(existsSync(dbFile) && statSync(dbFile).size).toBeGreaterThan(0);
    } finally {
      await stack.shutdown();
    }
  }, 60_000);
});
