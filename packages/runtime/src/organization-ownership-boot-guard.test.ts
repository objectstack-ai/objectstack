// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D10 item 5; ruling 6163114098, Q3 A] The v18 boot refusal's pins:
 * a database still in the v17 shape is refused and the command named; a
 * database whose ceremony verified boots; a fresh database boots. Plus the
 * fail-closed read, and a driver with no physical columns left inert.
 *
 * The columns are read from a real SQLite database through the guard's own
 * raw-SQL probe; the engine is a minimal double exposing the three seams the
 * guard reads (the registry, the driver an object binds to, `findOne`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { AppPlugin } from './app-plugin.js';
import {
  assertOrganizationOwnershipMigrated,
  isOrganizationOwnershipBootRefusal,
  OrganizationOwnershipBootGuardPlugin,
  ORGANIZATION_OWNERSHIP_BOOT_GUARD_PLUGIN_NAME,
  ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE,
} from './organization-ownership-boot-guard.js';

let db: DatabaseSync;

/** The objects the registry serves: two no-column objects and one tenant-walled one. */
const OBJECTS = [
  { name: 'sys_job', systemFields: { tenant: false }, fields: { status: {} } },
  { name: 'sys_metadata', systemFields: { tenant: false }, fields: { type: {}, name: {} } },
  { name: 'crm_deal', fields: { amount: {} } },
];

function engine(opts: { client?: unknown; dialectName?: string; failRead?: boolean } = {}) {
  const driver = {
    ...(opts.dialectName ? { dialectName: opts.dialectName } : {}),
    config: { client: opts.client ?? 'better-sqlite3' },
    async execute(sql: string, params: unknown[] = []) {
      if (opts.failRead) throw new Error('SQLITE_BUSY: database is locked');
      return db.prepare(sql).all(...(params as string[]));
    },
  };
  return {
    registry: { getAllObjects: () => OBJECTS },
    getDriverForObject: () => driver,
    async findOne(object: string, query: Record<string, unknown>) {
      const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).all(object).length > 0;
      if (!exists) return null;
      const id = String((query.where as { id?: unknown } | undefined)?.id);
      return db.prepare(`SELECT * FROM ${object} WHERE id = ?`).get(id) ?? null;
    },
  };
}

/** The tables a v17 runtime created: every one carries the injected organization column. */
function v17Shape(): void {
  db.exec(`
    CREATE TABLE sys_job (id TEXT PRIMARY KEY, status TEXT, organization_id TEXT);
    CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, type TEXT, name TEXT, organization_id TEXT);
    CREATE TABLE crm_deal (id TEXT PRIMARY KEY, amount REAL, organization_id TEXT);
    CREATE TABLE sys_migration (id TEXT PRIMARY KEY, last_run_at TEXT, verified_at TEXT, applied_at TEXT, blocking INTEGER, advisory INTEGER);
  `);
}

const marker = (verifiedAt: string | null, blocking = 0): void => {
  db.prepare('INSERT INTO sys_migration VALUES (?, ?, ?, ?, ?, ?)').run(
    'adr-0131-organization-ownership', '2026-10-14T00:00:00Z', verifiedAt, '2026-10-14T00:00:00Z', blocking, 0,
  );
};

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the boot to be refused, and it was not');
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
});
afterEach(() => {
  db.close();
});

describe('the v18 boot refusal (ADR-0131 D10 item 5)', () => {
  it('⭐ a v17-shape database is refused, naming the command and every table still carrying the column', async () => {
    v17Shape();
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine()));
    expect(isOrganizationOwnershipBootRefusal(err)).toBe(true);
    expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect(err.tables).toEqual(['sys_job', 'sys_metadata']);
    expect(err.message).toMatch(/still in the v17 organization-ownership shape: sys_job, sys_metadata/);
    // The apply the refusal names is one the ceremony accepts: a reviewed plan file and the backup acknowledged.
    expect(err.message).toMatch(/os migrate organization-ownership --apply --plan-file PLAN --backup-taken/);
    expect(err.message).toMatch(/the ceremony has not run on it/);
    // In 18.0 the command it names refuses too, so the refusal names the release answer itself, ahead of the command.
    const release = err.message.indexOf('18.0 does not upgrade a v17 database');
    expect(release).toBeGreaterThan(-1);
    expect(err.message.indexOf('17.x release until the 18.x release', release)).toBeGreaterThan(release);
    expect(release).toBeLessThan(err.message.indexOf("Run 'os migrate organization-ownership --out PLAN'"));
  });

  it('a development boot names the ceremony with --dev, so it boots the way the refused boot did', async () => {
    v17Shape();
    const dev = await refusalOf(() => assertOrganizationOwnershipMigrated(engine(), undefined, { dev: true }));
    expect(dev.message).toContain(
      "Run 'os migrate organization-ownership --dev --out PLAN' to write and review its plan, take a backup, then run " +
        "'os migrate organization-ownership --dev --apply --plan-file PLAN --backup-taken'",
    );
    const served = await refusalOf(() => assertOrganizationOwnershipMigrated(engine()));
    expect(served.message).not.toContain('--dev');
  });

  it('a marker that is not verified (an unfinished ceremony, or one whose post-check found discrepancies) is refused', async () => {
    v17Shape();
    marker(null);
    expect((await refusalOf(() => assertOrganizationOwnershipMigrated(engine()))).message).toMatch(/not finished on it/);
    db.exec(`DELETE FROM sys_migration`);
    marker('2026-10-14T01:00:00Z', 2);
    expect(isOrganizationOwnershipBootRefusal(await refusalOf(() => assertOrganizationOwnershipMigrated(engine())))).toBe(true);
  });

  it('⭐ a database whose ceremony verified boots', async () => {
    v17Shape();
    marker('2026-10-14T01:00:00Z');
    await expect(assertOrganizationOwnershipMigrated(engine())).resolves.toBeUndefined();
  });

  /** What the ceremony's column-drops step leaves: no table in the v17 shape, the ledger beside it. */
  const migrated = (): void => {
    db.exec(`
      CREATE TABLE sys_job (id TEXT PRIMARY KEY, status TEXT);
      CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, type TEXT, name TEXT);
      CREATE TABLE crm_deal (id TEXT PRIMARY KEY, amount REAL, organization_id TEXT);
      CREATE TABLE sys_migration (id TEXT PRIMARY KEY, last_run_at TEXT, verified_at TEXT, applied_at TEXT, blocking INTEGER, advisory INTEGER);
    `);
  };

  it('⭐ a migrated database (the columns dropped) whose ceremony verified boots', async () => {
    migrated();
    marker('2026-10-14T01:00:00Z');
    await expect(assertOrganizationOwnershipMigrated(engine())).resolves.toBeUndefined();
  });

  it('⭐ a migrated database (the columns dropped) whose ceremony did NOT verify is refused: its post-check found rows it has not carried', async () => {
    migrated();
    marker(null, 602);
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine()));
    expect(isOrganizationOwnershipBootRefusal(err)).toBe(true);
    expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect(err.tables).toEqual([]);
    expect(err.message).toMatch(/^The organization-ownership ceremony has not finished on this database: its marker \(sys_migration 'adr-0131-organization-ownership'\) is not verified/);
    expect(err.message).toContain(
      "Resolve what the apply report names, then run 'os migrate organization-ownership --out PLAN' again, review it, run " +
        "'os migrate organization-ownership --apply --plan-file PLAN --backup-taken', and start again.",
    );
    // A verified_at with blocking left is not verified either (`isDataMigrationFlagVerified`).
    db.exec('DELETE FROM sys_migration');
    marker('2026-10-14T01:00:00Z', 3);
    expect(isOrganizationOwnershipBootRefusal(await refusalOf(() => assertOrganizationOwnershipMigrated(engine())))).toBe(true);
  });

  it('a migrated database whose marker cannot be read is refused, never passed', async () => {
    migrated();
    const failing = { ...engine(), findOne: async () => { throw new Error('SQLITE_BUSY: database is locked'); } };
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(failing));
    expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect(err.message).toMatch(/its marker \(sys_migration 'adr-0131-organization-ownership'\) could not be read/);
  });

  it('a boot with no storage — no driver serves the ledger, and the engine refuses its read — has no database to judge, and boots', async () => {
    const storageless = {
      ...engine(),
      getDriverForObject: () => undefined,
      findOne: async () => { throw new Error("[ObjectQL] No driver available for object 'sys_migration'"); },
    };
    await expect(assertOrganizationOwnershipMigrated(storageless)).resolves.toBeUndefined();
  });

  it('a migrated database with no marker (no ceremony ran on it) boots; so does a composition with no ledger object', async () => {
    migrated();
    await expect(assertOrganizationOwnershipMigrated(engine())).resolves.toBeUndefined();
    marker(null, 1);
    const noLedger = { ...engine(), getObject: () => undefined };
    await expect(assertOrganizationOwnershipMigrated(noLedger)).resolves.toBeUndefined();
  });

  it('⭐ a fresh database boots: no table it creates carries a retired column, and no marker is needed', async () => {
    await expect(assertOrganizationOwnershipMigrated(engine())).resolves.toBeUndefined();
  });

  it('a column read that fails is refused, never taken for a migrated database', async () => {
    v17Shape();
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ failRead: true })));
    expect(isOrganizationOwnershipBootRefusal(err)).toBe(true);
    expect(err.message).toMatch(/could not read whether this database is still in the v17/);
  });

  it('⭐ a driver whose knex client is a dialect CLASS (SqliteWasmDriver, the default for a served file database) is read by its dialectName, and refused', async () => {
    v17Shape();
    class Client_WasmSqlite {}
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ client: Client_WasmSqlite, dialectName: 'sqlite' })));
    expect(isOrganizationOwnershipBootRefusal(err)).toBe(true);
    expect(err.tables).toEqual(['sys_job', 'sys_metadata']);
  });

  it('a driver with no physical columns (memory, MongoDB) is inert', async () => {
    v17Shape();
    await expect(assertOrganizationOwnershipMigrated(engine({ client: 'memory' }))).resolves.toBeUndefined();
  });

  it('⭐ the plugin refuses in its own start(), registering no hook: a refused boot stops before any later plugin starts', async () => {
    v17Shape();
    const hooks = new Map<string, () => Promise<void>>();
    const ctx: any = {
      hook: (event: string, handler: () => Promise<void>) => hooks.set(event, handler),
      getService: (name: string) => (name === 'objectql' ? engine() : undefined),
      logger: {},
    };
    const plugin = new OrganizationOwnershipBootGuardPlugin();
    await plugin.init(ctx);
    const err = await refusalOf(() => plugin.start(ctx));
    expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect([...hooks.keys()]).toEqual([]);
  });

  it('starts after the engine and the platform objects (sys_migration), order-if-present', () => {
    const plugin = new OrganizationOwnershipBootGuardPlugin();
    expect(plugin.name).toBe(ORGANIZATION_OWNERSHIP_BOOT_GUARD_PLUGIN_NAME);
    expect(plugin.dependencies).toEqual([]);
    expect(plugin.optionalDependencies).toEqual(['com.objectstack.engine.objectql', 'com.objectstack.platform-objects']);
  });

  it('the writers at start declare the guard ahead of them: AppPlugin (the inline seed)', () => {
    expect(new AppPlugin({}).optionalDependencies).toContain(ORGANIZATION_OWNERSHIP_BOOT_GUARD_PLUGIN_NAME);
  });


  it('no escape hatch: no environment variable stands the refusal down', async () => {
    v17Shape();
    const saved = { ...process.env };
    try {
      for (const key of ['OS_ALLOW_UNMIGRATED_ORGANIZATION_OWNERSHIP', 'OS_SKIP_ORGANIZATION_OWNERSHIP_CHECK', 'OS_ALLOW_DEGRADED_TENANCY']) {
        process.env[key] = '1';
      }
      expect(isOrganizationOwnershipBootRefusal(await refusalOf(() => assertOrganizationOwnershipMigrated(engine())))).toBe(true);
    } finally {
      process.env = saved;
    }
  });
});
