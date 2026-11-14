// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The connector connection table's package-less index on a LIVE PostgreSQL
 * (ADR-0150 D4 and D8 row R11, #31699) — the dialect whose answer the SQLite
 * suite cannot give. The grant guard's live file
 * (`user-permission-set-packageless-index.live-postgres.test.ts`) on this table.
 *
 * - The partial form is built; a second package-less connection of one
 *   `(organization_id, connector_name)` is refused, the instance of two
 *   packages is admitted, and a second boot is a no-op.
 * - The catalog read before any DDL: absent, then present, and a second boot
 *   with a write open on the table sends no DDL, where `CREATE … IF NOT
 *   EXISTS` would wait for the table's SHARE lock (a 2 s `lock_timeout` fails it).
 * - Measured over real rows: among package-less connections nothing the old
 *   `(organization_id, connector_name)` key refused is admitted. The old key is
 *   built as knex compiles it here (a UNIQUE constraint) in a sibling table, and
 *   both tables take the same rows.
 * - Existing duplicates fail the build with the keys named, and no row is
 *   touched.
 *
 * Needs `OS_TEST_POSTGRES_URL` and reports a named SKIP without one;
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1` turns a missing URL into a failure, as in
 * the sibling live files. Runs in its own schema, named by
 * `currentLiveMysqlDatabase` (the per-file resolver these files share).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import {
    CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME,
    CONNECTOR_CONNECTION_TABLE,
    buildConnectorConnectionPackagelessIndexPresenceSql,
    ensureConnectorConnectionPackagelessIndex,
} from './connector-connection-packageless-index.js';
import { currentLiveMysqlDatabase } from './live-mysql-database.testkit.js';
import type { IndexExec } from './partial-index-probe.js';

const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const EXPECT_LIVE = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';

if (EXPECT_LIVE && !PG_URL) {
    describe('connection package-less index — live PostgreSQL', () => {
        it('OS_TEST_POSTGRES_URL must be set on a runner that declared it provisioned', () => {
            throw new Error('OS_EXPECT_LIVE_DIALECT_MATRIX=1 without OS_TEST_POSTGRES_URL: the live cell would have been skipped.');
        });
    });
}

const quietLogger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() });

/** The sibling table carrying the key this one replaced. */
const OLD_KEY_TABLE = 'old_key_connector_connection';

describe.skipIf(!PG_URL)('connection package-less index on a LIVE PostgreSQL', () => {
    let client: pg.Client;
    const exec: IndexExec = (sql: string) => client.query(sql);
    let schema: string;

    const insertInto = async (
        table: string,
        id: string,
        pkg: string | null,
        org = 'org_1',
    ): Promise<boolean> => {
        try {
            await client.query(
                `INSERT INTO ${table} (id, organization_id, connector_name, connector_package) ` +
                    "VALUES ($1, $2, 'github', $3)",
                [id, org, pkg],
            );
            return true;
        } catch {
            return false;
        }
    };
    const insert = (id: string, pkg: string | null, org = 'org_1') =>
        insertInto(CONNECTOR_CONNECTION_TABLE, id, pkg, org);

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
        for (const table of [CONNECTOR_CONNECTION_TABLE, OLD_KEY_TABLE]) {
            await client.query(`DROP TABLE IF EXISTS ${table}`);
            await client.query(
                `CREATE TABLE ${table} (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, ` +
                    'connector_name TEXT NOT NULL, connector_package TEXT)',
            );
        }
        // The declared key as knex compiles it on PostgreSQL: a UNIQUE constraint.
        await client.query(
            `ALTER TABLE ${CONNECTOR_CONNECTION_TABLE} ADD CONSTRAINT uniq_sys_connector_connection_declared ` +
                'UNIQUE (organization_id, connector_package, connector_name)',
        );
        // The key it replaced, the same way.
        await client.query(
            `ALTER TABLE ${OLD_KEY_TABLE} ADD CONSTRAINT uniq_old_key ` +
                'UNIQUE (organization_id, connector_name)',
        );
    });

    it('builds the partial index; a second package-less connection is refused, two packages admitted', async () => {
        expect(await insert('a', null)).toBe(true);
        expect(await insert('b', null)).toBe(true); // the hole, before the index
        await client.query(`DELETE FROM ${CONNECTOR_CONNECTION_TABLE} WHERE id = 'b'`);

        const log = quietLogger();
        expect(await ensureConnectorConnectionPackagelessIndex(exec, log, { client: 'pg' })).toEqual({ status: 'created' });
        const { rows } = await client.query<{ indexdef: string }>(
            `SELECT pg_get_indexdef(to_regclass('"${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}"')) AS indexdef`,
        );
        expect(rows[0]?.indexdef).toContain('(organization_id, connector_name) WHERE (connector_package IS NULL)');

        expect(await insert('b', null)).toBe(false);
        expect(await insert('p1', 'com.acme.crm')).toBe(true);
        expect(await insert('p2', 'com.acme.hr')).toBe(true);
        expect(await insert('p1b', 'com.acme.crm')).toBe(false);
        // A second boot is a no-op.
        expect(await ensureConnectorConnectionPackagelessIndex(exec, log, { client: 'pg' })).toEqual({ status: 'created' });
        expect(log.error).not.toHaveBeenCalled();
    });

    it('reads the catalog before any DDL: absent, then present; a second boot sends no DDL while a write holds the table', async () => {
        const presence = buildConnectorConnectionPackagelessIndexPresenceSql('pg')!;
        expect((await client.query(presence)).rows).toHaveLength(0);
        expect(await ensureConnectorConnectionPackagelessIndex(exec, quietLogger(), { client: 'pg' })).toEqual({ status: 'created' });
        expect((await client.query(presence)).rows).toHaveLength(1);

        // `CREATE UNIQUE INDEX IF NOT EXISTS` waits for the table's SHARE lock
        // before it finds the name taken, so with an open write it would block
        // here and fail at the timeout; the catalog read does not wait.
        const writer = new pg.Client({ connectionString: PG_URL });
        await writer.connect();
        try {
            await writer.query(`SET search_path TO "${schema}"`);
            await writer.query('BEGIN');
            await writer.query(
                `INSERT INTO ${CONNECTOR_CONNECTION_TABLE} (id, organization_id, connector_name, connector_package) ` +
                    "VALUES ('w1', 'org_9', 'github', 'com.acme.crm')",
            );
            await client.query("SET lock_timeout = '2s'");
            const seen: string[] = [];
            const recording: IndexExec = (sql: string) => (seen.push(sql), client.query(sql));
            const log = quietLogger();
            expect(await ensureConnectorConnectionPackagelessIndex(recording, log, { client: 'pg' })).toEqual({ status: 'created' });
            expect(seen.filter((sql) => /^\s*(CREATE|ALTER|DROP)\b/i.test(sql))).toEqual([]);
            expect(log.error).not.toHaveBeenCalled();
        } finally {
            await client.query('RESET lock_timeout');
            await writer.query('ROLLBACK');
            await writer.end();
        }
    });

    // What the store alone admits that the old key refused, a packaged
    // connection beside a package-less one; the connection store, the table's
    // one writer, updates the row it finds and never writes it.
    it('among package-less connections admits nothing the old key refused; a second package\'s instance is admitted', async () => {
        expect(await ensureConnectorConnectionPackagelessIndex(exec, quietLogger(), { client: 'pg' })).toEqual({ status: 'created' });
        const rows: Array<[string, string | null]> = [
            ['n1', null],
            ['n2', null],
            ['m1', 'com.acme.crm'],
            ['m2', 'com.acme.crm'],
            ['h1', 'com.acme.hr'],
        ];
        const answers: Array<{ id: string; old: boolean; now: boolean }> = [];
        for (const [id, pkg] of rows) {
            answers.push({ id, old: await insertInto(OLD_KEY_TABLE, id, pkg), now: await insert(id, pkg) });
        }
        expect(answers).toEqual([
            { id: 'n1', old: true, now: true },
            { id: 'n2', old: false, now: false },
            { id: 'm1', old: false, now: true },
            { id: 'm2', old: false, now: false },
            { id: 'h1', old: false, now: true },
        ]);
    });

    it('existing package-less duplicates: conflict naming the key, no row touched', async () => {
        await insert('a', null);
        await insert('b', null);
        const log = quietLogger();
        expect((await ensureConnectorConnectionPackagelessIndex(exec, log, { client: 'pg' })).status).toBe('conflict');
        expect(
            (await client.query(`SELECT id, connector_package FROM ${CONNECTOR_CONNECTION_TABLE} ORDER BY id`)).rows,
        ).toEqual([
            { id: 'a', connector_package: null },
            { id: 'b', connector_package: null },
        ]);
        expect(log.error).toHaveBeenCalledTimes(1);
        expect(String(log.error.mock.calls[0]?.[0] ?? '')).toContain('organization_id=org_1, connector_name=github (2 connections)');
    });
});
