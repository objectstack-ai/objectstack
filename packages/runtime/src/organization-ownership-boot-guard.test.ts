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

/**
 * What 18.0 supports for a v17 database: the sentence every refusal closes on,
 * in the words `@objectstack/cli`'s other 18.0 refusals use (the drop gate of
 * `os migrate apply`; `os dev`'s way on for a development database).
 */
const FRESH_INSTALLS_ONLY =
  '18.0 supports fresh installs only and does not upgrade a v17 database: keep a v17 database on a 17.x release ' +
  'until the 18.x release that carries the upgrade path, and upgrade it there.';
const FRESH_INSTALLS_ONLY_DEV =
  '18.0 supports fresh installs only and does not upgrade a v17 database: keep a v17 development database on a ' +
  '17.x release until the 18.x release that carries the upgrade path, and upgrade it there.';
/** `os migrate organization-ownership` refuses on every database in 18.0: no refusal names it or a step of it. */
const WITHDRAWN_COMMAND = /os migrate organization-ownership|--plan-file|--out PLAN|--backup-taken/;

/** The message closes on `tail` (compared as a string, so a failure shows the diff). */
function expectTail(message: string, tail: string): void {
  expect(message.slice(-tail.length)).toBe(tail);
}

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
  it('⭐ a v17-shape database is refused, naming every table still carrying the column', async () => {
    v17Shape();
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine()));
    expect(isOrganizationOwnershipBootRefusal(err)).toBe(true);
    expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect(err.tables).toEqual(['sys_job', 'sys_metadata']);
    expect(err.message).toMatch(/still in the v17 organization-ownership shape: sys_job, sys_metadata/);
    expect(err.message).toMatch(/the ceremony has not run on it/);
    // What it prescribes is pinned per branch below: what 18.0 supports, and no step of the withdrawn command.
  });

  it('a development boot speaks of a development database, as os dev does; a served boot does not', async () => {
    v17Shape();
    const dev = await refusalOf(() => assertOrganizationOwnershipMigrated(engine(), undefined, { dev: true }));
    expect(dev.message).toContain(FRESH_INSTALLS_ONLY_DEV);
    expect(dev.message).not.toMatch(WITHDRAWN_COMMAND);
    expect(dev.message).not.toContain('--dev');
    const served = await refusalOf(() => assertOrganizationOwnershipMigrated(engine()));
    expect(served.message).toContain(FRESH_INSTALLS_ONLY);
    expect(served.message).not.toContain('development');
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

  // 18.0 supports fresh installs only, and its `os migrate organization-ownership`
  // refuses on every database, plan and apply alike. One pin per refusal branch:
  // each closes on what 18.0 supports for a v17 database and names no step of that
  // command. The code and the outcome (refused) are the ones the pins above hold.
  describe('18.0: each branch says what 18.0 supports for a v17 database, and names no step of the withdrawn command', () => {
    const unreadableMarker = () => ({ ...engine(), findOne: async () => { throw new Error('SQLITE_BUSY: database is locked'); } });

    it('⭐ the v17 shape (a table still carries the column), whatever the marker says', async () => {
      v17Shape();
      const absent = await refusalOf(() => assertOrganizationOwnershipMigrated(engine()));
      marker(null);
      const unverified = await refusalOf(() => assertOrganizationOwnershipMigrated(engine()));
      const unreadable = await refusalOf(() => assertOrganizationOwnershipMigrated(unreadableMarker()));
      expect([absent, unverified, unreadable].map((e) => e.tables)).toEqual([
        ['sys_job', 'sys_metadata'], ['sys_job', 'sys_metadata'], ['sys_job', 'sys_metadata'],
      ]);
      for (const err of [absent, unverified, unreadable]) {
        expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
        expectTail(err.message, `The server refuses to start rather than serve v17 data with v18 semantics. ${FRESH_INSTALLS_ONLY}`);
        expect(err.message).not.toMatch(WITHDRAWN_COMMAND);
      }
    });

    it('⭐ a ceremony that ran every step and did not verify (no column left): 18.0 cannot re-run it', async () => {
      migrated();
      marker(null, 602);
      const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine()));
      expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
      expectTail(err.message, `rather than serve rows of an organization-owned object with no organization. ${FRESH_INSTALLS_ONLY}`);
      expect(err.message).not.toMatch(WITHDRAWN_COMMAND);
    });

    it('⭐ a ceremony marker that could not be read (no column left): fix the read first', async () => {
      migrated();
      const err = await refusalOf(() => assertOrganizationOwnershipMigrated(unreadableMarker()));
      expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
      expect(err.message).toMatch(/its marker \(sys_migration 'adr-0131-organization-ownership'\) could not be read/);
      expectTail(err.message, `Fix the read, then start again. ${FRESH_INSTALLS_ONLY}`);
      expect(err.message).not.toMatch(WITHDRAWN_COMMAND);
    });

    it('⭐ a column read that failed: fix the read first', async () => {
      v17Shape();
      const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ failRead: true })));
      expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
      expect(err.tables).toEqual([]);
      expect(err.message).toContain('(SQLITE_BUSY: database is locked)');
      expectTail(err.message, `Fix the read, then start again. ${FRESH_INSTALLS_ONLY}`);
      expect(err.message).not.toMatch(WITHDRAWN_COMMAND);
    });

    it('a development boot says the same of a development database in every branch, and names no --dev command', async () => {
      const dev = { dev: true };
      v17Shape();
      const shape = await refusalOf(() => assertOrganizationOwnershipMigrated(engine(), undefined, dev));
      const columnRead = await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ failRead: true }), undefined, dev));
      db.close();
      db = new DatabaseSync(':memory:');
      migrated();
      const markerRead = await refusalOf(() => assertOrganizationOwnershipMigrated(unreadableMarker(), undefined, dev));
      marker(null, 602);
      const rerun = await refusalOf(() => assertOrganizationOwnershipMigrated(engine(), undefined, dev));
      for (const err of [shape, columnRead, markerRead, rerun]) {
        expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
        expectTail(err.message, FRESH_INSTALLS_ONLY_DEV);
        expect(err.message).not.toMatch(WITHDRAWN_COMMAND);
        expect(err.message).not.toContain('--dev');
      }
    });
  });
});
