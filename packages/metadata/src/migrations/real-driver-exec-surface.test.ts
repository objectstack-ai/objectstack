// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The migrations in this directory, driven through a driver THIS REPO DEFINES.
 *
 * Every pre-existing case in this directory builds its own double carrying a
 * `raw(sql, bindings?)` method — **including the case that asserts the guard
 * fires**. So the suite pinned the guard's wording while never once exercising
 * a driver the platform ships, and a helper that refused all four of them sat
 * green. Swapping `raw` for `execute` in the helpers AND in the doubles would
 * have moved that hole rather than closed it: a double shaped to the helper's
 * own assumption can only ever agree with it.
 *
 * This file is the closure. `SqliteWasmDriver` is a real driver
 * (`@objectstack/driver-sqlite-wasm`, already a devDependency here and already
 * used by `metadata-history.test.ts`), it extends `SqlDriver`, it runs real
 * SQLite in-process with no server, and it is constructed here the same way an
 * operator constructs one. Nothing below stubs a driver method.
 *
 * ⭐ The load-bearing case is `pins the surface reality this file exists for`:
 * it asserts the real driver has NO `raw` and DOES have `execute`. Without it
 * every case here would keep passing if someone re-introduced a `raw`-only
 * guard and quietly re-added `raw` to the driver — and it is the assertion that
 * fails first if the shipped surface ever moves back.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { dropProjectionTables } from './drop-projection-tables.js';
import { migrateEnvIdToProjectId } from './migrate-env-id-to-project-id.js';
import { migrateProjectIdToEnvironmentId } from './migrate-project-id-to-environment-id.js';

/** Every driver made here, torn down in `afterEach` (sql.js holds a WASM heap). */
const live: SqliteWasmDriver[] = [];

async function realDriver(): Promise<SqliteWasmDriver> {
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    live.push(driver);
    return driver;
}

/** Run SQL the way an operator's setup would — through the driver's own surface. */
function sql(driver: SqliteWasmDriver): (statement: string, bindings?: unknown[]) => Promise<any> {
    return (statement, bindings) => (driver as any).execute(statement, bindings ?? []);
}
afterEach(async () => {
    while (live.length > 0) {
        await live.pop()!.disconnect().catch(() => undefined);
    }
});

describe('migrations against a driver this repo actually defines', () => {
    it('pins the surface reality this file exists for: real drivers have `execute`, not `raw`', async () => {
        const driver = await realDriver();

        // The defect in one line. `SqlDriver` keeps its knex handle `protected`
        // and declares no `raw` member, so the old `typeof driver.raw ===
        // 'function'` guard was false for every driver the platform ships.
        expect(
            typeof (driver as any).raw,
            'if a real driver grows a .raw() member, every other case in this file stops proving anything',
        ).not.toBe('function');

        // ...and the surface `IDataDriver` declares (non-optionally, with bound
        // parameters as its second POSITIONAL argument) is present.
        expect(typeof (driver as any).execute).toBe('function');

        // Non-vacuity for the binding half: `execute` really carries bindings
        // positionally, which is what the migrations' `(sql, bindings)` calls
        // assume. A driver that accepted the array and ignored it would answer
        // `1` here.
        const rows: any = await (driver as any).execute('SELECT ? AS bound', [7]);
        const list: any[] = Array.isArray(rows) ? (Array.isArray(rows[0]) ? rows[0] : rows) : [];
        expect(list[0]?.bound).toBe(7);
    });

    it('migrateProjectIdToEnvironmentId renames the column on a real database', async () => {
        const driver = await realDriver();
        const run = sql(driver);
        await run('CREATE TABLE "sys_metadata" (id TEXT PRIMARY KEY, name TEXT, project_id TEXT)');
        await run('INSERT INTO "sys_metadata" (id, name, project_id) VALUES (?, ?, ?)', ['m1', 'n', 'env_a']);

        const results = await migrateProjectIdToEnvironmentId(driver);

        expect(results.find((r) => r.table === 'sys_metadata')?.status).toBe('renamed');

        // Read the physical schema back, not the return value: the return value
        // is what reported `error` for years while nothing happened.
        const info: any = await run('PRAGMA table_info("sys_metadata")');
        const columns: any[] = Array.isArray(info) ? (Array.isArray(info[0]) ? info[0] : info) : [];
        const names = columns.map((c: any) => c.name);
        expect(names).toContain('environment_id');
        expect(names).not.toContain('project_id');

        // The row survived the rename with its value intact.
        const after: any = await run('SELECT environment_id FROM "sys_metadata" WHERE id = ?', ['m1']);
        const afterRows: any[] = Array.isArray(after) ? (Array.isArray(after[0]) ? after[0] : after) : [];
        expect(afterRows[0]?.environment_id).toBe('env_a');
    });

    it('migrateProjectIdToEnvironmentId is idempotent on a real already-migrated database', async () => {
        const driver = await realDriver();
        await sql(driver)('CREATE TABLE "sys_metadata" (id TEXT PRIMARY KEY, environment_id TEXT)');

        const results = await migrateProjectIdToEnvironmentId(driver);

        expect(results.find((r) => r.table === 'sys_metadata')?.status).toBe('already_done');
    });

    it('migrateEnvIdToProjectId renames the column on a real database', async () => {
        const driver = await realDriver();
        const run = sql(driver);
        await run('CREATE TABLE "sys_metadata" (id TEXT PRIMARY KEY, env_id TEXT)');
        await run('CREATE TABLE "sys_metadata_history" (id TEXT PRIMARY KEY, env_id TEXT)');

        const results = await migrateEnvIdToProjectId(driver);

        expect(results.map((r) => r.status)).toEqual(['renamed', 'renamed']);
        for (const table of ['sys_metadata', 'sys_metadata_history']) {
            const info: any = await run(`PRAGMA table_info("${table}")`);
            const columns: any[] = Array.isArray(info) ? (Array.isArray(info[0]) ? info[0] : info) : [];
            expect(columns.map((c: any) => c.name)).toContain('project_id');
        }
    });

    it('dropProjectionTables drops the deprecated tables on a real database', async () => {
        const driver = await realDriver();
        const run = sql(driver);
        await run('CREATE TABLE sys_object (id TEXT PRIMARY KEY)');
        await run('CREATE TABLE sys_view (id TEXT PRIMARY KEY)');

        const results = await dropProjectionTables(driver);

        expect(results.every((r) => r.status === 'dropped')).toBe(true);

        // Physical proof — `DROP TABLE IF EXISTS` reports success either way, so
        // the return value alone cannot tell "dropped" from "never ran".
        const master: any = await run("SELECT name FROM sqlite_master WHERE type = 'table'");
        const tables: any[] = Array.isArray(master) ? (Array.isArray(master[0]) ? master[0] : master) : [];
        const names = tables.map((t: any) => t.name);
        expect(names).not.toContain('sys_object');
        expect(names).not.toContain('sys_view');
    });
});
