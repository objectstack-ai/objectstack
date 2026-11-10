// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The grant table's package-less index on a LIVE PostgreSQL (ADR-0150 D4,
 * #32164) — the dialect whose answer the SQLite suite cannot give.
 *
 * - The partial form is built; a second package-less grant of one
 *   `(user_id, permission_set, organization_id)` is refused, the same grant
 *   bound to two packages is admitted, and a second boot is a no-op.
 * - Epic condition 1, measured over real rows: nothing the old three-column key
 *   refused is admitted, with a non-null and a null organization. The old key
 *   is built as knex compiles it here (a UNIQUE constraint) in a sibling table,
 *   and both tables take the same rows.
 * - Epic condition 2: existing duplicates fail the build with the keys named,
 *   and no row is touched.
 *
 * Needs `OS_TEST_POSTGRES_URL` and reports a named SKIP without one;
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1` turns a missing URL into a failure, as in
 * the sibling live files. Runs in its own schema, named by
 * `currentLiveMysqlDatabase` (the per-file resolver these files share).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import {
    USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME,
    USER_PERMISSION_SET_TABLE,
    ensureUserPermissionSetPackagelessIndex,
} from './user-permission-set-packageless-index.js';
import { currentLiveMysqlDatabase } from './live-mysql-database.testkit.js';
import type { IndexExec } from './partial-index-probe.js';

const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const EXPECT_LIVE = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';

if (EXPECT_LIVE && !PG_URL) {
    describe('grant package-less index — live PostgreSQL', () => {
        it('OS_TEST_POSTGRES_URL must be set on a runner that declared it provisioned', () => {
            throw new Error('OS_EXPECT_LIVE_DIALECT_MATRIX=1 without OS_TEST_POSTGRES_URL: the live cell would have been skipped.');
        });
    });
}

const quietLogger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() });

/** The sibling table carrying the key this one replaced. */
const OLD_KEY_TABLE = 'old_key_user_permission_set';

describe.skipIf(!PG_URL)('grant package-less index on a LIVE PostgreSQL', () => {
    let client: pg.Client;
    const exec: IndexExec = (sql: string) => client.query(sql);
    let schema: string;

    const insertInto = async (
        table: string,
        id: string,
        pkg: string | null,
        org: string | null = 'org_1',
    ): Promise<boolean> => {
        try {
            await client.query(
                `INSERT INTO ${table} (id, user_id, permission_set, permission_set_package, organization_id) ` +
                    "VALUES ($1, 'u1', 'sales_rep', $2, $3)",
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
        schema = currentLiveMysqlDatabase();
        client = new pg.Client({ connectionString: PG_URL });
        await client.connect();
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
        await client.query(`SET search_path TO "${schema}"`);
    });

    afterAll(async () => {
        if (!client) return;
        await client.query('SET search_path TO "$user", public');
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await client.end();
    });

    beforeEach(async () => {
        for (const table of [USER_PERMISSION_SET_TABLE, OLD_KEY_TABLE]) {
            await client.query(`DROP TABLE IF EXISTS ${table}`);
            await client.query(
                `CREATE TABLE ${table} (id TEXT PRIMARY KEY, user_id TEXT, permission_set TEXT, ` +
                    'permission_set_package TEXT, organization_id TEXT)',
            );
        }
        // The declared key as knex compiles it on PostgreSQL: a UNIQUE constraint.
        await client.query(
            `ALTER TABLE ${USER_PERMISSION_SET_TABLE} ADD CONSTRAINT uniq_sys_user_permission_set_declared ` +
                'UNIQUE (user_id, permission_set, permission_set_package, organization_id)',
        );
        // The key it replaced, the same way.
        await client.query(
            `ALTER TABLE ${OLD_KEY_TABLE} ADD CONSTRAINT uniq_old_key ` +
                'UNIQUE (user_id, permission_set, organization_id)',
        );
    });

    it('builds the partial index; a second package-less grant is refused, two packages admitted', async () => {
        expect(await insert('a', null)).toBe(true);
        expect(await insert('b', null)).toBe(true); // the hole, before the index
        await client.query(`DELETE FROM ${USER_PERMISSION_SET_TABLE} WHERE id = 'b'`);

        const log = quietLogger();
        expect(await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'pg' })).toEqual({ status: 'created' });
        const { rows } = await client.query<{ indexdef: string }>(
            `SELECT pg_get_indexdef(to_regclass('"${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME}"')) AS indexdef`,
        );
        expect(rows[0]?.indexdef).toContain('(user_id, permission_set, organization_id) WHERE (permission_set_package IS NULL)');

        expect(await insert('b', null)).toBe(false);
        expect(await insert('p1', 'com.acme.crm')).toBe(true);
        expect(await insert('p2', 'com.acme.hr')).toBe(true);
        expect(await insert('p1b', 'com.acme.crm')).toBe(false);
        // A second boot is a no-op.
        expect(await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'pg' })).toEqual({ status: 'created' });
        expect(log.error).not.toHaveBeenCalled();
    });

    it('admits nothing the old key refused, with a non-null and a null organization (epic condition 1)', async () => {
        expect(await ensureUserPermissionSetPackagelessIndex(exec, quietLogger(), { client: 'pg' })).toEqual({ status: 'created' });
        const rows: Array<[string, string | null]> = [
            ['n1', 'org_1'],
            ['n2', 'org_1'],
            ['z1', null],
            ['z2', null],
        ];
        const answers: Array<{ id: string; old: boolean; now: boolean }> = [];
        for (const [id, org] of rows) {
            answers.push({ id, old: await insertInto(OLD_KEY_TABLE, id, null, org), now: await insert(id, null, org) });
        }
        expect(answers).toEqual([
            { id: 'n1', old: true, now: true },
            { id: 'n2', old: false, now: false },
            // PostgreSQL's UNIQUE treats NULLs as distinct (no NULLS NOT DISTINCT):
            // the old key admitted a second platform-wide grant, and so does this index.
            { id: 'z1', old: true, now: true },
            { id: 'z2', old: true, now: true },
        ]);
    });

    it('existing package-less duplicates: conflict naming the key, no row touched (epic condition 2)', async () => {
        await insert('a', null);
        await insert('b', null);
        const log = quietLogger();
        expect((await ensureUserPermissionSetPackagelessIndex(exec, log, { client: 'pg' })).status).toBe('conflict');
        expect(
            (await client.query(`SELECT id, permission_set_package FROM ${USER_PERMISSION_SET_TABLE} ORDER BY id`)).rows,
        ).toEqual([
            { id: 'a', permission_set_package: null },
            { id: 'b', permission_set_package: null },
        ]);
        expect(log.error).toHaveBeenCalledTimes(1);
        expect(String(log.error.mock.calls[0]?.[0] ?? '')).toContain(
            'user_id=u1, permission_set=sales_rep, organization_id=org_1 (2 grants)',
        );
    });
});
