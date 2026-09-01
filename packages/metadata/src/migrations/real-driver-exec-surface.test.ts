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
// The engine double's write verbs route through the producer's OWN dispatch
// predicates, so it cannot accept a call `ObjectQL.<verb>` would refuse — the
// same pinning the sibling suite in this directory carries. Imported from
// `@objectstack/metadata-core` (a `dependencies` entry here) and not from
// `@objectstack/objectql`, which depends on this package: that edge would close
// a cycle turbo rejects.
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
    type EngineFindOneQueryInput,
} from '@objectstack/metadata-core';

import { dropProjectionTables } from './drop-projection-tables.js';
import { migrateEnvIdToProjectId } from './migrate-env-id-to-project-id.js';
import { migrateProjectIdToEnvironmentId } from './migrate-project-id-to-environment-id.js';
import { migrateSysNotificationToEvent } from './migrate-sys-notification-to-event.js';

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

/**
 * Engine double for the ONE helper that also needs an `IDataEngine`. The driver
 * under test is real; this stands in only for the structured-write half, which
 * is not what this file is about.
 */
function recordingEngine() {
    const inserts: Array<{ object: string; row: any }> = [];
    const updates: Array<{ object: string; data: any }> = [];
    return {
        inserts,
        updates,
        engine: {
            async insert(object: string, row: any) {
                inserts.push({ object, row });
                return { id: `${object}_${inserts.length}`, ...row };
            },
            async update(object: string, data: any, options?: Record<string, unknown>) {
                assertEngineUpdateDispatch(data, options);
                updates.push({ object, data });
                return data;
            },
            async find() { return []; },
            async findOne(object: string, query?: EngineFindOneQueryInput) {
                assertEngineFindOnePredicate(object, query);
                return null;
            },
            async delete(_object?: string, options?: Record<string, unknown>) {
                assertEngineDeleteDispatch(options);
                return {};
            },
            async count() { return 0; },
            async aggregate() { return []; },
        } as any,
    };
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

    it('migrateSysNotificationToEvent carries legacy rows across on a real database', async () => {
        const driver = await realDriver();
        const run = sql(driver);
        await run(
            'CREATE TABLE "sys_notification" (' +
                'id TEXT PRIMARY KEY, recipient_id TEXT, type TEXT, title TEXT, body TEXT, url TEXT, ' +
                'actor_name TEXT, is_read INTEGER, read_at TEXT, created_at TEXT, organization_id TEXT, ' +
                'topic TEXT, payload TEXT, severity TEXT)',
        );
        await run(
            'INSERT INTO "sys_notification" ' +
                '(id, recipient_id, type, title, body, url, actor_name, is_read, read_at, created_at, organization_id) ' +
                'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ['n1', 'u1', 'mention', 'You were mentioned', 'hi', '/x', 'Ada', 0, null, '2026-01-01T00:00:00.000Z', 'org_1'],
        );
        const e = recordingEngine();

        const result = await migrateSysNotificationToEvent({ driver, data: e.engine });

        // This is the assertion the card is about: an operator following
        // `docs/handoff/adr-0030-notification-convergence.md` step 2 with their
        // platform driver used to get `{ status: 'error', migrated: 0 }` here.
        expect(result.status).toBe('migrated');
        expect(result.migrated).toBe(1);
        expect(e.inserts.map((i) => i.object)).toEqual(['sys_inbox_message', 'sys_notification_receipt']);
        expect(e.inserts[0]!.row).toMatchObject({ user_id: 'u1', notification_id: 'n1', action_url: '/x' });

        // The legacy columns were really cleared, through the real driver, with
        // the id passed as a BINDING — the one call site that binds a value.
        const rows: any = await run('SELECT recipient_id, title FROM "sys_notification" WHERE id = ?', ['n1']);
        const list: any[] = Array.isArray(rows) ? (Array.isArray(rows[0]) ? rows[0] : rows) : [];
        expect(list[0]?.recipient_id).toBeNull();
        expect(list[0]?.title).toBeNull();
    });

    it('migrateSysNotificationToEvent reports not_applicable on a real post-cut-over table', async () => {
        const driver = await realDriver();
        await sql(driver)(
            'CREATE TABLE "sys_notification" (id TEXT PRIMARY KEY, topic TEXT, payload TEXT, severity TEXT, created_at TEXT)',
        );
        const e = recordingEngine();

        const result = await migrateSysNotificationToEvent({ driver, data: e.engine });

        // Distinguishes the repair from "accepts anything": a real driver whose
        // table never held the inbox shape must still be told apart from one the
        // migration could not drive at all.
        expect(result.status).toBe('not_applicable');
        expect(e.inserts).toHaveLength(0);
    });
});
