// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13204 — the unmanaged-table sweep against a REAL booted stack and a REAL
 * database file, in both directions.
 *
 * `unmanaged-tables.test.ts` pins the predicate over hand-built sets. What it
 * cannot pin is the two joins to the rest of the system, and both are exactly
 * where a section like this goes wrong:
 *
 *  1. **The managed set is the plan's own.** The sweep reads
 *     `managedObjectFields` off the driver `os migrate plan` diffed. That
 *     member is `protected` and reached structurally, so only a real boot can
 *     say whether it is populated at the moment the sweep runs — and a
 *     mistimed read (before `measureComposedCoverage` binds the composed
 *     host's objects) would report every platform table as unmanaged.
 *  2. **The catalog query runs.** The three statements are written for three
 *     dialects; this exercises the sqlite one through the driver's own raw
 *     seam, against tables that really exist.
 *
 * ⛔ The NEGATIVE control is the point. `sys_user` is put in the database
 * BEFORE the boot and must NOT be reported, alongside `_objectstack_sequences`
 * and an application table. A sweep observed only in the presence of an orphan
 * would be indistinguishable from one that reports everything.
 *
 * The positive control is the card's own measured case: a `sys_`-prefixed
 * table left behind by a retired object, which no plan can mention today.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { bootSchemaStack, type SchemaStack } from '../../utils/schema-migrate.js';
import { collectUnmanagedTables, type UnmanagedTablesReport } from './unmanaged-tables.js';

const ARTIFACT = {
  // #8687: manifest fields under `manifest:` — the flat spelling is refused.
  manifest: { id: 'orphan_smoke', name: 'Orphan Smoke', version: '0.0.0', type: 'app' },
  objects: [{ name: 'orphan_widget', fields: { name: { type: 'text' } } }],
};

/**
 * The env vars that outrank the unified project default (#6469). Every one of
 * them must be absent or the boot resolves somewhere else entirely and this
 * test silently stops testing anything.
 */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL',
  'DATABASE_URL',
  'TURSO_DATABASE_URL',
  'OS_DATABASE_DRIVER',
  'OS_HOME',
] as const;

describe('os migrate plan — unmanaged tables, against a real database (#13204)', () => {
  let dir: string;
  let dbFile: string;
  let stack: SchemaStack | null = null;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-orphan-'));
    mkdirSync(join(dir, 'dist'), { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    dbFile = join(dir, 'data', 'app.db');
    writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(ARTIFACT));

    // The physical database, assembled OUTSIDE the booted stack so every table
    // below is a fact about the file rather than about the boot.
    const seed = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: dbFile },
      useNullAsDefault: true,
    });
    const k = (seed as unknown as { knex: any }).knex;
    const plain = async (name: string): Promise<void> => {
      await k.schema.createTable(name, (t: any) => { t.string('id').primary(); });
    };
    // NEGATIVE controls — every one of these is legitimate and must stay unreported.
    await plain('sys_user');                  // declared AND managed by the platform floor
    await plain('_objectstack_sequences');    // the driver's own autonumber ledger
    await plain('orphan_widget');             // this deployment's own object
    await plain('app_leftovers');             // no reserved prefix at all
    // POSITIVE control — the card's measured shape: a retired object's table.
    await plain('sys_scim_provider');
    await k.destroy();

    for (const key of OVERRIDING_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
    process.env.NODE_ENV = 'production'; // no dev auto-reconcile

    // The same boot `os migrate plan` performs: deferred DDL, read-only probe,
    // and the deployment's own composed object set.
    stack = await bootSchemaStack({
      jsonOutput: false,
      projectRoot: dir,
      databaseUrl: dbFile,
      deferSchemaDdl: true,
      readOnlyProbe: true,
      composeHostStack: true,
    });
  }, 120_000);

  afterEach(async () => {
    try { await stack?.shutdown(); } catch { /* torn down either way */ }
    stack = null;
    for (const key of OVERRIDING_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  async function sweep(): Promise<UnmanagedTablesReport> {
    const { normalizeRows } = await import('@objectstack/metadata-protocol');
    return collectUnmanagedTables({
      driver: stack!.driver,
      declaredObjects: stack!.allObjects(),
      normalize: normalizeRows,
    });
  }

  it('the boot this sweep reads from really did populate the managed set', () => {
    // The premise the whole section rests on. A zero here would make every
    // assertion below pass for the wrong reason — the sweep would be
    // differencing against an empty set.
    expect(stack!.driver).not.toBeNull();
    expect(stack!.managedTableCount).toBeGreaterThan(0);
  });

  it('REPORTS the stranded table, and reports ONLY it', async () => {
    const report = await sweep();
    // ⛔ `unreadable` is not a pass. It is the third state, and it means the
    // measurement below never happened.
    expect(report.status).toBe('read');
    const read = report as Extract<UnmanagedTablesReport, { status: 'read' }>;
    expect(read.tables.map((f) => f.table)).toEqual(['sys_scim_provider']);
    // The negative controls, named individually so a failure says which one moved.
    for (const legitimate of ['sys_user', '_objectstack_sequences', 'orphan_widget', 'app_leftovers']) {
      expect(read.tables.map((f) => f.table)).not.toContain(legitimate);
    }
    expect(read.physicalTables).toBeGreaterThanOrEqual(5);
  }, 120_000);

  it('goes SILENT once the stranded table is the only thing that changes', async () => {
    // The other direction of the same measurement: remove the orphan, leave
    // every negative control in place, and the section must disappear. Without
    // this, "reports only sys_scim_provider" is also satisfied by a section
    // that reports a fixed string.
    const before = await sweep();
    expect((before as { tables: unknown[] }).tables).toHaveLength(1);

    await stack!.shutdown();
    stack = null;
    const surgeon = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: dbFile },
      useNullAsDefault: true,
    });
    const k = (surgeon as unknown as { knex: any }).knex;
    await k.schema.dropTable('sys_scim_provider');
    await k.destroy();

    stack = await bootSchemaStack({
      jsonOutput: false,
      projectRoot: dir,
      databaseUrl: dbFile,
      deferSchemaDdl: true,
      readOnlyProbe: true,
      composeHostStack: true,
    });

    const after = await sweep();
    expect(after.status).toBe('read');
    expect((after as { tables: unknown[] }).tables).toEqual([]);
    // Still a real sweep, not an early return: the negative controls are all
    // still in the database.
    expect((after as { physicalTables: number }).physicalTables).toBeGreaterThanOrEqual(4);
  }, 180_000);
});
