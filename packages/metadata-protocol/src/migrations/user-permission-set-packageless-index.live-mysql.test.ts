// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The grant table's package-less index on a LIVE MySQL / MariaDB (ADR-0150 D4,
 * #32164).
 *
 * - MySQL (8.0.13+) builds the functional key part over the digest; MariaDB a
 *   UNIQUE key over an INVISIBLE generated column carrying it, which stays out
 *   of `SELECT *`. A second package-less grant of one `(user_id,
 *   permission_set, organization_id)` is refused, two packages are admitted,
 *   and a second boot finds the key in `information_schema.statistics` and
 *   sends no DDL, so the server refuses nothing.
 * - Epic condition 1, over real rows: nothing the old three-column key refused
 *   is admitted, with a non-null and a null organization. The old key is built
 *   in a sibling table as `driver-sql` builds a plain UNIQUE over TEXT columns
 *   here (a hash-shadow column, `unhex(sha2(concat(…)))`, and a UNIQUE key over
 *   it), and both tables take the same rows.
 *
 * The columns are TEXT, as `SqlDriver` creates the grant's text fields on MySQL.
 *
 * Needs `OS_TEST_MYSQL_URL` and reports a named SKIP without one;
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1` turns a missing URL into a failure. Runs in
 * its own database (`currentLiveMysqlDatabase`).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';

import {
    USER_PERMISSION_SET_TABLE,
    buildUserPermissionSetPackagelessIndexPresenceSql,
    ensureUserPermissionSetPackagelessIndex,
} from './user-permission-set-packageless-index.js';
import { currentLiveMysqlDatabase } from './live-mysql-database.testkit.js';
import type { IndexExec } from './partial-index-probe.js';

const MYSQL_URL = process.env.OS_TEST_MYSQL_URL;
const EXPECT_LIVE = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';

if (EXPECT_LIVE && !MYSQL_URL) {
    describe('grant package-less index — live MySQL / MariaDB', () => {
        it('OS_TEST_MYSQL_URL must be set on a runner that declared it provisioned', () => {
            throw new Error('OS_EXPECT_LIVE_DIALECT_MATRIX=1 without OS_TEST_MYSQL_URL: the live cell would have been skipped.');
        });
    });
}

const quietLogger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() });

/** The sibling table carrying the key this one replaced. */
const OLD_KEY_TABLE = 'old_key_user_permission_set';

describe.skipIf(!MYSQL_URL)('grant package-less index on a LIVE MySQL / MariaDB', () => {
    let conn: mysql.Connection;
    let database: string;
    let mariadb = false;
    const exec: IndexExec = async (sql: string) => (await conn.query(sql))[0];

    const insertInto = async (table: string, id: string, pkg: string | null, org: string | null = 'org_1'): Promise<boolean> => {
        try {
            await conn.query(
                `INSERT INTO ${table} (id, user_id, permission_set, permission_set_package, organization_id) ` +
                    "VALUES (?, 'u1', 'sales_rep', ?, ?)",
                [id, pkg, org],
            );
            return true;
        } catch {
            return false;
        }
    };
    const insert = (id: string, pkg: string | null, org: string | null = 'org_1') =>
        insertInto(USER_PERMISSION_SET_TABLE, id, pkg, org);

    beforeAll(async () => {
        database = currentLiveMysqlDatabase();
        conn = await mysql.createConnection(MYSQL_URL!);
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
        await conn.query(`USE \`${database}\``);
        const [rows] = await conn.query('SELECT VERSION() AS v');
        mariadb = /mariadb/i.test(String((rows as Array<{ v: string }>)[0]?.v));
    });

    afterAll(async () => {
        if (!conn) return;
        await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
        await conn.end();
    });

    beforeEach(async () => {
        for (const table of [USER_PERMISSION_SET_TABLE, OLD_KEY_TABLE]) {
            await conn.query(`DROP TABLE IF EXISTS ${table}`);
            await conn.query(
                `CREATE TABLE ${table} (id VARCHAR(255) PRIMARY KEY, user_id TEXT, permission_set TEXT, ` +
                    'permission_set_package TEXT, organization_id TEXT)',
            );
        }
        // The old key, as driver-sql keys plain parts over TEXT columns on MySQL.
        await conn.query(
            `ALTER TABLE ${OLD_KEY_TABLE} ADD COLUMN uniq_old_key__hash VARBINARY(32) GENERATED ALWAYS AS ` +
                '(unhex(sha2(concat(user_id, 0x1f, permission_set, 0x1f, organization_id), 256))) VIRTUAL, ' +
                'ADD UNIQUE KEY uniq_old_key (uniq_old_key__hash)',
        );
    });

    it('MySQL builds the functional key part, MariaDB the INVISIBLE carrier (second package-less grant refused, two packages admitted)', async () => {
        const log = quietLogger();
        const presence = buildUserPermissionSetPackagelessIndexPresenceSql('mysql2')!;
        expect(await exec(presence)).toHaveLength(0);
        expect(await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'mysql2' })).toEqual({ status: 'created' });
        // `information_schema.statistics` lists the functional key and MariaDB's key over its carrier alike.
        expect((await exec(presence) as unknown[]).length).toBeGreaterThan(0);
        if (mariadb) {
            // The carrier never reaches `SELECT *` (INVISIBLE).
            await insert('a0', null);
            const [rows] = await conn.query(`SELECT * FROM ${USER_PERMISSION_SET_TABLE}`);
            expect(Object.keys((rows as Array<Record<string, unknown>>)[0] ?? {})).toEqual([
                'id', 'user_id', 'permission_set', 'permission_set_package', 'organization_id',
            ]);
            await conn.query(`DELETE FROM ${USER_PERMISSION_SET_TABLE}`);
        }
        expect(await insert('a', null)).toBe(true);
        expect(await insert('b', null)).toBe(false);
        expect(await insert('p1', 'com.acme.crm')).toBe(true);
        expect(await insert('p2', 'com.acme.hr')).toBe(true);
        // A second boot finds it in the catalog and sends nothing the server would refuse: no CREATE, no ALTER.
        const seen: string[] = [];
        const recording: IndexExec = (sql: string) => (seen.push(sql), exec(sql));
        expect(await ensureUserPermissionSetPackagelessIndex(recording, log, { client: 'mysql2' })).toEqual({ status: 'created' });
        expect(seen.filter((sql) => /^\s*(CREATE|ALTER|DROP)\b/i.test(sql))).toEqual([]);
        expect(log.error).not.toHaveBeenCalled();
    });

    // [#32164, red-line review E2] The last row: what the store alone
    // admits that the old key refused, a packaged grant beside a package-less
    // one; the engine's write seam refuses it above the store
    // (`plugin-security`'s `stored-permission-set-package-stamp.ts`).
    it('among package-less grants admits nothing the old key refused, with a non-null and a null organization (epic condition 1); the store alone admits a packaged grant beside a package-less one', async () => {
        expect(await ensureUserPermissionSetPackagelessIndex(exec, quietLogger(), { client: 'mysql2' })).toEqual({ status: 'created' });
        const rows: Array<[string, string | null, string | null]> = [
            ['n1', null, 'org_1'],
            ['n2', null, 'org_1'],
            ['z1', null, null],
            ['z2', null, null],
            // The fixture builds the guard alone, not the declared key, so only
            // the packaged row beside n1 is read here.
            ['m1', 'com.acme.crm', 'org_1'],
        ];
        const answers: Array<{ id: string; old: boolean; now: boolean }> = [];
        for (const [id, pkg, org] of rows) {
            answers.push({ id, old: await insertInto(OLD_KEY_TABLE, id, pkg, org), now: await insert(id, pkg, org) });
        }
        expect(answers).toEqual([
            { id: 'n1', old: true, now: true },
            { id: 'n2', old: false, now: false },
            // `concat` is NULL when any part is, and UNIQUE exempts NULL: the old
            // key admitted a second platform-wide grant, and so does this index.
            { id: 'z1', old: true, now: true },
            { id: 'z2', old: true, now: true },
            { id: 'm1', old: false, now: true },
        ]);
    });

    it('existing package-less duplicates: conflict, no row touched (epic condition 2)', async () => {
        await insert('a', null);
        await insert('b', null);
        const log = quietLogger();
        expect((await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'mysql2' })).status).toBe('conflict');
        const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM ${USER_PERMISSION_SET_TABLE}`);
        expect(Number((rows as Array<{ n: number }>)[0]?.n)).toBe(2);
        expect(log.error).toHaveBeenCalledTimes(1);
    });
});
