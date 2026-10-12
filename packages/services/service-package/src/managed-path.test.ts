// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23022 — `sys_packages` reaches the documented migration path, and then the
 * boot honours `OS_SKIP_SCHEMA_SYNC`.
 *
 * ## What was broken
 *
 * `start()` ran its raw `CREATE TABLE IF NOT EXISTS sys_packages` whatever the
 * flag said ("When `1`, skip the implicit `db:sync` on boot. Use after running
 * migrations manually."), and the managed path did not cover the table at all:
 * `os migrate plan --json` did not list it and `os migrate apply` did not
 * create it. Honouring the flag alone would have left a flag deployment with no
 * `sys_packages`, so the order is load-bearing: the declaration first, then the
 * skip.
 *
 * ## What this suite holds
 *
 *  1. `init()` declares the table as the `package.storage` service: a
 *     read-only presence probe per dialect, and the boot's own
 *     `ensurePackageTable` — on a real SQLite database, the table it creates is
 *     the `(id, version)` table with its index.
 *  2. `start()` reads the value the engine published (`skipSchemaSync`), and
 *     when it is set issues no SQL at all, says so once at `info`, and still
 *     registers the `package` service. Unset, it creates the table as before.
 *
 * The CLI end — `os migrate plan` listing the table and `apply` creating it,
 * through this real plugin composed by the migrate funnel — is
 * `packages/cli/src/utils/schema-migrate.package-table.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { PackageServicePlugin, type PackageService } from './index.js';
import { PACKAGE_TABLE_COLUMNS, PACKAGE_TABLE_STATEMENTS } from './package-table.js';

const PACKAGE_STORAGE_SERVICE = 'package.storage';

interface Declaration {
  table: string;
  columns: readonly string[];
  present(): Promise<boolean | undefined>;
  ensure(): Promise<void>;
}

/** A real `node:sqlite` database behind an engine whose default driver says `sqlite`, recording every statement. */
function sqliteEngine(extra: Record<string, unknown> = {}) {
  const db = new DatabaseSync(':memory:');
  const seen: string[] = [];
  const engine: any = {
    getDefaultDriverName: () => 'default',
    getDriverByName: () => ({ dialectName: 'sqlite' }),
    async execute({ sql, args }: { sql: string; args?: unknown[] }) {
      seen.push(sql);
      const stmt = db.prepare(sql);
      return /^\s*select/i.test(sql) ? stmt.all(...((args ?? []) as any[])) : stmt.run(...((args ?? []) as any[]));
    },
    ...extra,
  };
  return { db, engine, seen };
}

/** An engine whose default driver names `dialectName`, answering every statement with `answer`. */
function recordingEngine(dialectName: unknown, answer: (sql: string) => unknown) {
  const seen: string[] = [];
  const engine: any = {
    getDefaultDriverName: () => 'default',
    getDriverByName: () => ({ dialectName }),
    async execute({ sql }: { sql: string }) {
      seen.push(sql);
      return answer(sql);
    },
  };
  return { engine, seen };
}

function pluginContext(engine: unknown) {
  const logs: Array<{ level: string; msg: string }> = [];
  const services = new Map<string, unknown>();
  const ctx: any = {
    logger: {
      debug: (msg: string) => logs.push({ level: 'debug', msg }),
      info: (msg: string) => logs.push({ level: 'info', msg }),
      warn: (msg: string) => logs.push({ level: 'warn', msg }),
      error: (msg: string) => logs.push({ level: 'error', msg }),
    },
    getService: (n: string) => (n === 'objectql' ? engine : services.get(n)),
    registerService: (n: string, s: unknown) => { services.set(n, s); },
  };
  return { ctx, logs, services };
}

function tableShape(db: DatabaseSync) {
  return {
    columns: db.prepare("SELECT name, type, \"notnull\" AS not_null FROM pragma_table_info('sys_packages') ORDER BY cid").all(),
    pk: db.prepare("SELECT name FROM pragma_table_info('sys_packages') WHERE pk > 0 ORDER BY pk").all(),
    indexes: db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_packages_latest'").all(),
  };
}

const hasTable = (db: DatabaseSync) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sys_packages'").all().length === 1;

// ---------------------------------------------------------------------------
// 1. init() declares the table for the migrate path
// ---------------------------------------------------------------------------

describe('[#23022] init() declares sys_packages as the package.storage service', () => {
  it('a real SQLite database: absent → ensure() creates the (id, version) table and its index → present', async () => {
    const { db, engine, seen } = sqliteEngine();
    const { ctx, services } = pluginContext(engine);
    await new PackageServicePlugin().init(ctx);

    const storage = services.get(PACKAGE_STORAGE_SERVICE) as Declaration;
    expect(storage.table).toBe('sys_packages');
    expect([...storage.columns]).toEqual([...PACKAGE_TABLE_COLUMNS]);

    expect(await storage.present()).toBe(false);
    // The probe is a read: it sent one SELECT and created nothing.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^SELECT /);
    expect(hasTable(db)).toBe(false);

    await storage.ensure();
    expect(seen.slice(1)).toEqual([
      PACKAGE_TABLE_STATEMENTS.standard.createTable,
      PACKAGE_TABLE_STATEMENTS.standard.createLatestIndex,
    ]);
    expect(await storage.present()).toBe(true);
    expect(tableShape(db)).toEqual({
      columns: PACKAGE_TABLE_COLUMNS.map((name) => ({
        name,
        type: 'TEXT',
        not_null: ['created_at', 'updated_at'].includes(name) ? 0 : 1,
      })),
      pk: [{ name: 'id' }, { name: 'version' }],
      indexes: [{ name: 'idx_packages_latest' }],
    });
  });

  it('the declared columns are the CREATE TABLE columns of every dialect, in order', () => {
    for (const set of Object.values(PACKAGE_TABLE_STATEMENTS)) {
      const columns = [...set.createTable.matchAll(/^\s*([a-z_]+)\s+[A-Z]/gm)].map((m) => m[1]);
      expect(columns).toEqual([...PACKAGE_TABLE_COLUMNS]);
    }
  });

  it.each([
    ['sqlite', /FROM sqlite_master WHERE type = 'table' AND name = 'sys_packages'/],
    ['postgres', /FROM information_schema\.tables WHERE table_schema = current_schema\(\) AND table_name = 'sys_packages'/],
    ['mysql', /FROM information_schema\.tables WHERE table_schema = DATABASE\(\) AND table_name = 'sys_packages'/],
  ])('a %s default driver is asked its own catalog', async (dialectName, probe) => {
    const { engine, seen } = recordingEngine(dialectName, () => ({ rows: [] }));
    const { ctx, services } = pluginContext(engine);
    await new PackageServicePlugin().init(ctx);
    expect(await (services.get(PACKAGE_STORAGE_SERVICE) as Declaration).present()).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(probe);
  });

  it.each([
    ['a row', [{ present: 1 }], true],
    ['no row', [], false],
    ['{ rows: [row] }', { rows: [{ present: 1 }] }, true],
    ["mysql2's [rows, fields] with a row", [[{ present: 1 }], []], true],
    ["mysql2's [rows, fields] with none", [[], []], false],
  ])('the catalog answers %s', async (_label, answer, present) => {
    const { engine } = recordingEngine('mysql', () => answer);
    const { ctx, services } = pluginContext(engine);
    await new PackageServicePlugin().init(ctx);
    expect(await (services.get(PACKAGE_STORAGE_SERVICE) as Declaration).present()).toBe(present);
  });

  it.each([
    ["the driver names 'unknown'", 'unknown'],
    ['a driver that names no dialect (memory, MongoDB)', undefined],
  ])('could not tell is undefined, never absent, and sends no SQL: %s', async (_label, dialectName) => {
    const { engine, seen } = recordingEngine(dialectName, () => []);
    const { ctx, services } = pluginContext(engine);
    await new PackageServicePlugin().init(ctx);
    expect(await (services.get(PACKAGE_STORAGE_SERVICE) as Declaration).present()).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it('a seam that returns no result set is undefined, never absent', async () => {
    const { engine } = recordingEngine('sqlite', () => null);
    const { ctx, services } = pluginContext(engine);
    await new PackageServicePlugin().init(ctx);
    expect(await (services.get(PACKAGE_STORAGE_SERVICE) as Declaration).present()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. start() honours the value the engine resolved
// ---------------------------------------------------------------------------

describe('[#23022] start() issues no DDL when the engine resolved skipSchemaSync', () => {
  it('flag set: no SQL at all, the table stays absent, ONE info line, and the package service is still registered', async () => {
    const { db, engine, seen } = sqliteEngine({ skipSchemaSync: true });
    const { ctx, logs, services } = pluginContext(engine);
    const plugin = new PackageServicePlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);

    // Hydration reads `list()` and finds no table; no DDL reached the database.
    expect(seen.filter((sql) => !/^\s*SELECT/i.test(sql))).toEqual([]);
    expect(hasTable(db)).toBe(false);

    const lines = logs.filter((l) => l.level === 'info' && l.msg.includes('sys_packages'));
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toContain('NOT provisioned at boot');
    expect(lines[0].msg).toContain('OS_SKIP_SCHEMA_SYNC');
    expect(lines[0].msg).toContain('os migrate apply');
    expect(logs.filter((l) => l.level === 'warn' || l.level === 'error')).toEqual([]);
    expect(typeof (services.get('package') as PackageService | undefined)?.publish).toBe('function');
  });

  it('flag set, then the documented path: the declaration creates the table the boot did not', async () => {
    const { db, engine } = sqliteEngine({ skipSchemaSync: true });
    const { ctx, services } = pluginContext(engine);
    const plugin = new PackageServicePlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    expect(hasTable(db)).toBe(false);

    await (services.get(PACKAGE_STORAGE_SERVICE) as Declaration).ensure();
    expect(hasTable(db)).toBe(true);
    const out = await (services.get('package') as PackageService).publish({
      manifest: { id: 'com.acme.crm', version: '1.0.0' } as any,
      metadata: {},
    });
    expect(out).toEqual({ success: true });
  });

  it.each([
    ['unset', {}],
    ['false', { skipSchemaSync: false }],
    ["the string 'true' (only the boolean the engine publishes counts)", { skipSchemaSync: 'true' }],
  ])('CONTROL — flag %s: the boot creates the table as before, and says nothing about skipping', async (_label, extra) => {
    const { db, engine, seen } = sqliteEngine(extra);
    const { ctx, logs } = pluginContext(engine);
    const plugin = new PackageServicePlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);

    expect(seen.slice(0, 2)).toEqual([
      PACKAGE_TABLE_STATEMENTS.standard.createTable,
      PACKAGE_TABLE_STATEMENTS.standard.createLatestIndex,
    ]);
    expect(hasTable(db)).toBe(true);
    expect(logs.some((l) => l.msg.includes('NOT provisioned at boot'))).toBe(false);
  });
});
