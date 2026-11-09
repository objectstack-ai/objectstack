// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The activation ledger's package-less index on LIVE PostgreSQL and
 * MySQL/MariaDB — the two dialects whose answer the SQLite suite cannot give.
 *
 * - PostgreSQL builds the partial form; a second package-less row of one
 *   `(metadata_type, name)` is refused, two packages are admitted.
 * - MySQL (8.0.13+) builds the functional key part over the digest; same
 *   answers. MariaDB builds a UNIQUE key over an INVISIBLE generated column
 *   carrying that digest; same answers, and the column stays out of `SELECT *`.
 *
 * The columns are TEXT, as `SqlDriver` creates the ledger's `text` fields on
 * MySQL, because TEXT is why the plain partial and CASE forms are refused there.
 *
 * Needs `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` and reports a named SKIP
 * without one; `OS_EXPECT_LIVE_DIALECT_MATRIX=1` turns a missing URL into a
 * failure, as in the sibling live files. MySQL runs in its own database,
 * derived from this file's path (`currentLiveMysqlDatabase`).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import mysql from 'mysql2/promise';

import {
    ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME,
    ACTIVATION_LEDGER_TABLE,
    ensureActivationLedgerPackagelessIndex,
} from './activation-ledger-packageless-index.js';
import { currentLiveMysqlDatabase } from './live-mysql-database.testkit.js';
import type { IndexExec } from './partial-index-probe.js';

const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const MYSQL_URL = process.env.OS_TEST_MYSQL_URL;
const EXPECT_LIVE = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';

if (EXPECT_LIVE && (!PG_URL || !MYSQL_URL)) {
    describe('activation ledger package-less index — live dialects', () => {
        it('OS_TEST_POSTGRES_URL and OS_TEST_MYSQL_URL must both be set on a runner that declared them provisioned', () => {
            throw new Error('OS_EXPECT_LIVE_DIALECT_MATRIX=1 without both live URLs: a live cell would have been skipped.');
        });
    });
}

const quietLogger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() });

describe.skipIf(!PG_URL)('activation ledger package-less index on a LIVE PostgreSQL', () => {
    let client: pg.Client;
    const exec: IndexExec = (sql: string) => client.query(sql);
    let schema: string;

    const insert = async (id: string, packageId: string | null): Promise<boolean> => {
        try {
            await client.query(
                `INSERT INTO ${ACTIVATION_LEDGER_TABLE} (id, metadata_type, name, package_id) VALUES ($1, 'flow', 'x', $2)`,
                [id, packageId],
            );
            return true;
        } catch {
            return false;
        }
    };

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
        await client.query(`DROP TABLE IF EXISTS ${ACTIVATION_LEDGER_TABLE}`);
        await client.query(
            `CREATE TABLE ${ACTIVATION_LEDGER_TABLE} (id TEXT PRIMARY KEY, metadata_type TEXT, name TEXT, package_id TEXT)`,
        );
        // The declared key as knex compiles it on PostgreSQL: a UNIQUE constraint.
        await client.query(
            `ALTER TABLE ${ACTIVATION_LEDGER_TABLE} ADD CONSTRAINT uniq_sys_metadata_activation_metadata_type_package_id_name ` +
                'UNIQUE (metadata_type, package_id, name)',
        );
    });

    it('builds the partial index; a second package-less row is refused, two packages admitted', async () => {
        expect(await insert('a', null)).toBe(true);
        expect(await insert('b', null)).toBe(true); // the hole, before the index
        await client.query(`DELETE FROM ${ACTIVATION_LEDGER_TABLE} WHERE id = 'b'`);

        const log = quietLogger();
        expect(await ensureActivationLedgerPackagelessIndex(exec, log, { client: 'pg' })).toEqual({ status: 'created' });
        const { rows } = await client.query<{ indexdef: string }>(
            `SELECT pg_get_indexdef(to_regclass('"${ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME}"')) AS indexdef`,
        );
        expect(rows[0]?.indexdef).toContain('WHERE (package_id IS NULL)');

        expect(await insert('b', null)).toBe(false);
        expect(await insert('p1', 'com.acme.alpha')).toBe(true);
        expect(await insert('p2', 'com.acme.beta')).toBe(true);
        expect(await insert('p1b', 'com.acme.alpha')).toBe(false);
        // A second boot is a no-op.
        expect(await ensureActivationLedgerPackagelessIndex(exec, log, { client: 'pg' })).toEqual({ status: 'created' });
        expect(log.error).not.toHaveBeenCalled();
    });

    it('existing package-less duplicates: conflict, no row touched', async () => {
        await insert('a', null);
        await insert('b', null);
        const log = quietLogger();
        expect((await ensureActivationLedgerPackagelessIndex(exec, log, { client: 'pg' })).status).toBe('conflict');
        expect((await client.query(`SELECT COUNT(*)::int AS n FROM ${ACTIVATION_LEDGER_TABLE}`)).rows[0].n).toBe(2);
        expect(log.error).toHaveBeenCalledTimes(1);
    });
});

describe.skipIf(!MYSQL_URL)('activation ledger package-less index on a LIVE MySQL / MariaDB', () => {
    let conn: mysql.Connection;
    let database: string;
    let mariadb = false;
    const exec: IndexExec = async (sql: string) => (await conn.query(sql))[0];

    const insert = async (id: string, packageId: string | null): Promise<boolean> => {
        try {
            await conn.query(
                `INSERT INTO ${ACTIVATION_LEDGER_TABLE} (id, metadata_type, name, package_id) VALUES (?, 'flow', 'x', ?)`,
                [id, packageId],
            );
            return true;
        } catch {
            return false;
        }
    };

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
        await conn.query(`DROP TABLE IF EXISTS ${ACTIVATION_LEDGER_TABLE}`);
        await conn.query(
            `CREATE TABLE ${ACTIVATION_LEDGER_TABLE} (id VARCHAR(255) PRIMARY KEY, metadata_type TEXT, name TEXT, package_id TEXT)`,
        );
    });

    it('MySQL builds the functional key part, MariaDB the INVISIBLE carrier (second package-less row refused, two packages admitted)', async () => {
        const log = quietLogger();
        const result = await ensureActivationLedgerPackagelessIndex(exec, log, { client: 'mysql2' });
        expect(result).toEqual({ status: 'created' });
        if (mariadb) {
            // The carrier never reaches `SELECT *` (INVISIBLE).
            await insert('a0', null);
            const [rows] = await conn.query(`SELECT * FROM ${ACTIVATION_LEDGER_TABLE}`);
            expect(Object.keys((rows as Array<Record<string, unknown>>)[0] ?? {})).toEqual(['id', 'metadata_type', 'name', 'package_id']);
            await conn.query(`DELETE FROM ${ACTIVATION_LEDGER_TABLE}`);
        }
        expect(await insert('a', null)).toBe(true);
        expect(await insert('b', null)).toBe(false);
        expect(await insert('p1', 'com.acme.alpha')).toBe(true);
        expect(await insert('p2', 'com.acme.beta')).toBe(true);
        // A second boot meets ER_DUP_KEYNAME, which is the index being in place.
        expect(await ensureActivationLedgerPackagelessIndex(exec, log, { client: 'mysql2' })).toEqual({ status: 'created' });
        expect(log.error).not.toHaveBeenCalled();
    });
});
