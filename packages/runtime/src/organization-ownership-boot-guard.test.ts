// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D10 item 5; ruling 6163114098, Q3 A; ruling record 6269955919 on
 * the v18 epic, ① A] The v18 boot refusal's pins. The guard decides on ONE
 * field, the ownership shape generation the ceremony's `sys_migration` row
 * attests:
 *
 *  - a verified marker at the current generation boots — the ceremony's, or
 *    the BIRTH MARKER the guard writes once on a store created from empty;
 *  - no marker on any other store (a v17 database, an 18.0 pre-release one) is refused,
 *    naming the ceremony and the tables still carrying a retired column;
 *  - a verified marker below the current generation (a shorter ceremony's) is
 *    refused, naming the ceremony again;
 *  - an unverified or unreadable marker is refused; a failing column read is
 *    refused; a store with no physical columns is inert.
 *
 * The columns are read from a real SQLite database through the guard's own
 * raw-SQL probe; the engine is a minimal double exposing the seams the guard
 * reads (the registry, the driver an object binds to and its schema-sync
 * stats, `findOne`, `insert`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ORGANIZATION_OWNERSHIP_SHAPE_GENERATION } from '@objectstack/spec/system';
import { AppPlugin } from './app-plugin.js';
import {
  assertOrganizationOwnershipMigrated,
  isOrganizationOwnershipBootRefusal,
  OrganizationOwnershipBirthMarkerPlugin,
  OrganizationOwnershipBootGuardPlugin,
  recordOrganizationOwnershipBirth,
  ORGANIZATION_OWNERSHIP_BOOT_GUARD_PLUGIN_NAME,
  ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE,
} from './organization-ownership-boot-guard.js';

let db: DatabaseSync;

/** The objects the registry serves: the three spellings of "no organization column", and one tenant-walled object. */
const OBJECTS = [
  { name: 'sys_job', systemFields: { tenant: false }, fields: { status: {} } },
  { name: 'sys_metadata', systemFields: { tenant: false }, fields: { type: {}, name: {} } },
  { name: 'sys_api_key', tenancy: { enabled: false }, fields: { key: {} } },
  { name: 'crm_deal', fields: { amount: {} } },
];

type Stats = { created: number; existing: number } | undefined;

function engine(opts: { client?: unknown; dialectName?: string; failRead?: boolean; stats?: Stats; failInsert?: boolean } = {}) {
  const driver = {
    ...(opts.dialectName ? { dialectName: opts.dialectName } : {}),
    config: { client: opts.client ?? 'better-sqlite3' },
    async execute(sql: string, params: unknown[] = []) {
      if (opts.failRead) throw new Error('SQLITE_BUSY: database is locked');
      return db.prepare(sql).all(...(params as string[]));
    },
    getSchemaSyncStats: () => opts.stats,
  };
  return {
    registry: { getAllObjects: () => OBJECTS },
    getDriverForObject: () => driver,
    async findOne(object: string, query: Record<string, unknown>) {
      assertEngineFindOnePredicate(object, query);
      const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).all(object).length > 0;
      if (!exists) return null;
      const id = String((query.where as { id?: unknown } | undefined)?.id);
      return db.prepare(`SELECT * FROM ${object} WHERE id = ?`).get(id) ?? null;
    },
    async insert(object: string, data: Record<string, unknown>) {
      if (opts.failInsert) throw new Error('SQLITE_READONLY: attempt to write a readonly database');
      const keys = Object.keys(data).filter((k) => !['created_at', 'updated_at'].includes(k));
      db.prepare(`INSERT INTO ${object} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(
        ...(keys.map((k) => data[k]) as never[]),
      );
      return data;
    },
  };
}

const LEDGER = 'CREATE TABLE sys_migration (id TEXT PRIMARY KEY, last_run_at TEXT, verified_at TEXT, applied_at TEXT, blocking INTEGER, advisory INTEGER, details TEXT);';

/** The tables a v17 runtime created: every one carries the injected organization column. */
function v17Shape(): void {
  db.exec(`
    CREATE TABLE sys_job (id TEXT PRIMARY KEY, status TEXT, organization_id TEXT);
    CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, type TEXT, name TEXT, organization_id TEXT);
    CREATE TABLE sys_api_key (id TEXT PRIMARY KEY, key TEXT, organization_id TEXT);
    CREATE TABLE crm_deal (id TEXT PRIMARY KEY, amount REAL, organization_id TEXT);
    ${LEDGER}
  `);
}

/** What an 18.0 pre-release install left, or what the ceremony's column-drops step leaves: no table in the v17 shape. */
function columnlessShape(): void {
  db.exec(`
    CREATE TABLE sys_job (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, type TEXT, name TEXT);
    CREATE TABLE sys_api_key (id TEXT PRIMARY KEY, key TEXT);
    CREATE TABLE crm_deal (id TEXT PRIMARY KEY, amount REAL, organization_id TEXT);
    ${LEDGER}
  `);
}

/** The ceremony's checkpoint marker, at `generation` (`null`: a marker written before generations existed). */
const marker = (verifiedAt: string | null, blocking = 0, generation: number | null = ORGANIZATION_OWNERSHIP_SHAPE_GENERATION): void => {
  const details = JSON.stringify({ checkpoint: { ceremony: 'ADR-0131 D10', inventoryDigest: 'x', completed: {}, ...(generation === null ? {} : { shapeGeneration: generation }) } });
  db.prepare('INSERT INTO sys_migration VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'adr-0131-organization-ownership', '2026-10-14T00:00:00Z', verifiedAt, '2026-10-14T00:00:00Z', blocking, 0, details,
  );
};

const markerRow = (): Record<string, unknown> | undefined =>
  db.prepare(`SELECT * FROM sys_migration WHERE id = 'adr-0131-organization-ownership'`).get() as Record<string, unknown> | undefined;

/** The schema-sync stats of a store this boot created from empty, and of one it found. */
const CREATED_EMPTY: Stats = { created: 40, existing: 0 };
const FOUND: Stats = { created: 0, existing: 40 };

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

describe('the v18 boot refusal (ADR-0131 D10 item 5; the birth marker, ruling ① A)', () => {
  it('⭐ a v17-shape database is refused, naming the command and every table still carrying the column — tenancy.enabled: false included', async () => {
    v17Shape();
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ stats: FOUND })));
    expect(isOrganizationOwnershipBootRefusal(err)).toBe(true);
    expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect(err.tables).toEqual(['sys_api_key', 'sys_job', 'sys_metadata']);
    expect(err.message).toMatch(/carries no organization-ownership marker: 17\.x or an 18\.0 pre-release \(18\.0\.0-next\.\*\) created it/);
    expect(err.message).toContain('sys_api_key, sys_job, sys_metadata still carry a physical organization_id column its object no longer declares.');
    expect(err.message).toMatch(/os migrate organization-ownership --apply --plan-file PLAN --backup-taken/);
    // An 18.0 pre-release database takes the same ceremony: the text names no release line to stay on,
    // and never says every 18.0 database (18.0.0 itself writes the birth marker).
    expect(err.message).not.toMatch(/17\.x release|keep this one|does not upgrade|every 18\.0/);
  });

  it('a development boot names the ceremony with --dev, so it boots the way the refused boot did', async () => {
    v17Shape();
    const dev = await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ stats: FOUND }), undefined, { dev: true }));
    expect(dev.message).toContain(
      "Run 'os migrate organization-ownership --dev --out PLAN' to write and review its plan, take a backup, then run " +
        "'os migrate organization-ownership --dev --apply --plan-file PLAN --backup-taken'",
    );
    const served = await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ stats: FOUND })));
    expect(served.message).not.toContain('--dev');
  });

  it('⭐ R1: a store created from empty gets its birth marker, exactly once, and boots — again and again', async () => {
    columnlessShape();
    const fixed = new Date('2026-10-19T12:00:00.000Z');
    await expect(assertOrganizationOwnershipMigrated(engine({ stats: CREATED_EMPTY }), undefined, { now: () => fixed })).resolves.toBeUndefined();
    const row = markerRow()!;
    expect(row).toMatchObject({ verified_at: fixed.toISOString(), blocking: 0 });
    const details = JSON.parse(String(row.details));
    expect(Object.keys(details)).toEqual(['birth']);
    expect(details.birth).toMatchObject({ shapeGeneration: ORGANIZATION_OWNERSHIP_SHAPE_GENERATION, createdAt: fixed.toISOString() });
    expect(typeof details.birth.platformVersion).toBe('string');
    // The next boot finds its own store and the marker: it boots, and writes nothing.
    await expect(assertOrganizationOwnershipMigrated(engine({ stats: FOUND }))).resolves.toBeUndefined();
    expect(markerRow()).toEqual(row);
  });

  it('⭐ an 18.0 pre-release database — no retired column, no marker, a store this boot found — is refused, naming the ceremony', async () => {
    columnlessShape();
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ stats: FOUND })));
    expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect(err.tables).toEqual([]);
    expect(err.message).toMatch(/^This database carries no organization-ownership marker/);
    expect(markerRow()).toBeUndefined();
  });

  it('"cannot say" is no: a store whose driver reports no stats, on an engine that cannot say either, is refused and no marker written', async () => {
    columnlessShape();
    expect(isOrganizationOwnershipBootRefusal(await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ stats: undefined }))))).toBe(true);
    expect(markerRow()).toBeUndefined();
  });

  it('a birth marker that cannot be written refuses the boot, saying the next boot would take the store for an old one', async () => {
    columnlessShape();
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ stats: CREATED_EMPTY, failInsert: true })));
    expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect(err.message).toMatch(/birth marker .* could not be written \(SQLITE_READONLY/);
  });

  it('⭐ F5: a verified marker below the current generation — a shorter ceremony, or one written before generations — is refused, naming the ceremony', async () => {
    columnlessShape();
    marker('2026-10-14T01:00:00Z', 0, null);
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ stats: FOUND })));
    expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect(err.message).toContain(
      `certified by an organization-ownership ceremony of shape generation 0, and this release requires generation ${ORGANIZATION_OWNERSHIP_SHAPE_GENERATION}`,
    );
    expect(err.message).toMatch(/os migrate organization-ownership --apply --plan-file PLAN --backup-taken/);
  });

  it('a marker that is not verified (an unfinished ceremony, or one whose post-check found discrepancies) is refused', async () => {
    v17Shape();
    marker(null);
    expect((await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ stats: FOUND })))).message).toMatch(/has not finished on this database/);
    db.exec(`DELETE FROM sys_migration`);
    marker('2026-10-14T01:00:00Z', 2);
    expect(isOrganizationOwnershipBootRefusal(await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ stats: FOUND }))))).toBe(true);
  });

  it('⭐ a database whose ceremony verified at the current generation boots, whatever its columns', async () => {
    v17Shape();
    marker('2026-10-14T01:00:00Z');
    await expect(assertOrganizationOwnershipMigrated(engine({ stats: FOUND }))).resolves.toBeUndefined();
  });

  it('⭐ a migrated database (the columns dropped) whose ceremony verified boots', async () => {
    columnlessShape();
    marker('2026-10-14T01:00:00Z');
    await expect(assertOrganizationOwnershipMigrated(engine({ stats: FOUND }))).resolves.toBeUndefined();
  });

  it('⭐ a migrated database (the columns dropped) whose ceremony did NOT verify is refused: its post-check found rows it has not carried', async () => {
    columnlessShape();
    marker(null, 602);
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ stats: FOUND })));
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
    expect(isOrganizationOwnershipBootRefusal(await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ stats: FOUND }))))).toBe(true);
  });

  it('a marker that cannot be read is refused, never passed — and never overwritten with a birth marker', async () => {
    columnlessShape();
    const failing = { ...engine({ stats: CREATED_EMPTY }), findOne: async () => { throw new Error('SQLITE_BUSY: database is locked'); } };
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(failing));
    expect(err.code).toBe(ORGANIZATION_OWNERSHIP_BOOT_REFUSAL_CODE);
    expect(err.message).toMatch(/marker \(sys_migration 'adr-0131-organization-ownership'\) of this database could not be read/);
    expect(markerRow()).toBeUndefined();
  });

  it('a boot with no storage — no driver serves the ledger, and the engine refuses its read — has no database to judge, and boots', async () => {
    const storageless = {
      ...engine(),
      getDriverForObject: () => undefined,
      findOne: async () => { throw new Error("[ObjectQL] No driver available for object 'sys_migration'"); },
    };
    await expect(assertOrganizationOwnershipMigrated(storageless)).resolves.toBeUndefined();
  });

  it('a composition with no ledger object has nothing to judge, and boots', async () => {
    columnlessShape();
    const noLedger = { ...engine({ stats: FOUND }), getObject: () => undefined };
    await expect(assertOrganizationOwnershipMigrated(noLedger)).resolves.toBeUndefined();
  });

  it('a column read that fails is refused, never taken for a migrated database', async () => {
    v17Shape();
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ failRead: true, stats: FOUND })));
    expect(isOrganizationOwnershipBootRefusal(err)).toBe(true);
    expect(err.message).toMatch(/could not read whether this database is still in an earlier organization-ownership shape/);
  });

  it('⭐ a driver whose knex client is a dialect CLASS (SqliteWasmDriver, the default for a served file database) is read by its dialectName, and refused', async () => {
    v17Shape();
    class Client_WasmSqlite {}
    const err = await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ client: Client_WasmSqlite, dialectName: 'sqlite', stats: FOUND })));
    expect(isOrganizationOwnershipBootRefusal(err)).toBe(true);
    expect(err.tables).toEqual(['sys_api_key', 'sys_job', 'sys_metadata']);
  });

  it('a driver with no physical columns (memory, MongoDB) is inert: nothing refused, no marker written', async () => {
    v17Shape();
    await expect(assertOrganizationOwnershipMigrated(engine({ client: 'memory', stats: CREATED_EMPTY }))).resolves.toBeUndefined();
    expect(markerRow()).toBeUndefined();
  });

  it('⭐ the birth half alone (every CLI boot): writes the marker on a store it created from empty, and never refuses', async () => {
    columnlessShape();
    // A store this boot found: nothing owed, nothing written, no refusal.
    await expect(recordOrganizationOwnershipBirth(engine({ stats: FOUND }))).resolves.toBeNull();
    expect(markerRow()).toBeUndefined();
    // A v17-shape store is never given a birth marker, even one reported created.
    db.exec(`DROP TABLE sys_job; CREATE TABLE sys_job (id TEXT PRIMARY KEY, status TEXT, organization_id TEXT);`);
    await expect(recordOrganizationOwnershipBirth(engine({ stats: CREATED_EMPTY }))).resolves.toBeNull();
    expect(markerRow()).toBeUndefined();
    db.exec(`DROP TABLE sys_job; CREATE TABLE sys_job (id TEXT PRIMARY KEY, status TEXT);`);
    // Created from empty: the marker, once; the plugin over a failing write logs and starts.
    const ctx: any = { getService: () => engine({ stats: CREATED_EMPTY }), logger: {} };
    await new OrganizationOwnershipBirthMarkerPlugin().start(ctx);
    expect(JSON.parse(String(markerRow()!.details)).birth.shapeGeneration).toBe(ORGANIZATION_OWNERSHIP_SHAPE_GENERATION);
    db.exec('DELETE FROM sys_migration');
    const errors: string[] = [];
    const failing: any = { getService: () => engine({ stats: CREATED_EMPTY, failInsert: true }), logger: { error: (m: string) => errors.push(m) } };
    await expect(new OrganizationOwnershipBirthMarkerPlugin().start(failing)).resolves.toBeUndefined();
    expect(errors).toEqual([expect.stringMatching(/the first 'os serve' will refuse it/)]);
  });

  it('⭐ the plugin refuses in its own start(), registering no hook: a refused boot stops before any later plugin starts', async () => {
    v17Shape();
    const hooks = new Map<string, () => Promise<void>>();
    const ctx: any = {
      hook: (event: string, handler: () => Promise<void>) => hooks.set(event, handler),
      getService: (name: string) => (name === 'objectql' ? engine({ stats: FOUND }) : undefined),
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
      expect(isOrganizationOwnershipBootRefusal(await refusalOf(() => assertOrganizationOwnershipMigrated(engine({ stats: FOUND }))))).toBe(true);
    } finally {
      process.env = saved;
    }
  });
});
