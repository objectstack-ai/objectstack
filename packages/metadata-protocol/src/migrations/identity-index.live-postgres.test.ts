// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26630 — the NULL-safe row identity of `sys_setting` and
 * `sys_notification_preference`, LANDED on a live PostgreSQL.
 *
 * ## The defect this pins
 *
 * On PostgreSQL the declared unique both tables start with is a UNIQUE
 * CONSTRAINT, not a bare index: `SqlDriver.syncDeclaredIndexes` builds it with
 * knex's `table.unique()`, which compiles there to `ALTER TABLE … ADD
 * CONSTRAINT … UNIQUE`. The probe-first replacement then ran `DROP INDEX IF
 * EXISTS` on the constraint's index — refused, 2BP01 — and `CREATE UNIQUE INDEX
 * IF NOT EXISTS` under the name the constraint still held, which succeeds as a
 * no-op. Both migrations reported `created` and the plain, NULL-distinct key
 * stayed. Measured on published 18.2.0 against PostgreSQL 16: two tenant-scope
 * rows for one (organization, namespace, key) were accepted.
 *
 * SQLite never had the defect (knex emits a bare `CREATE UNIQUE INDEX` there),
 * which is why the SQLite suites stayed green with it fully present. Only a
 * server can answer what PostgreSQL does with the drop, so a server answers.
 *
 * ## The fixture is the driver's statement, compiled by knex
 *
 * `metadata-protocol` must not depend on a driver, so the declared constraint is
 * the exact text knex's PostgreSQL client compiles `table.unique(columns, {
 * indexName })` to — read off knex 3 for both tables:
 *
 * ```text
 * alter table "sys_setting" add constraint "uniq_sys_setting_organization_id_namespace_key_scope_user_id"
 *   unique ("organization_id", "namespace", "key", "scope", "user_id")
 * ```
 *
 * ## Non-vacuity
 *
 *  1. the suite asserts it is talking to a real PostgreSQL, in its own schema;
 *  2. every fixture first asserts the declared name IS held by a constraint
 *     (`pg_constraint`), the precondition the defect needs — without it a green
 *     run would only show that a bare index can be dropped.
 *
 * ## Provisioning and isolation
 *
 * The sibling `seed-tenancy-backfill.live-postgres.test.ts`'s rules, unchanged:
 * `OS_TEST_POSTGRES_URL` or a named SKIP, `OS_EXPECT_LIVE_DIALECT_MATRIX=1`
 * turns a missing URL into a failure, and everything runs in this file's own
 * schema from `currentLiveMysqlDatabase()` (its header says why the MySQL-named
 * resolver). CI runs this file in the existing metadata-protocol live step,
 * whose `live-postgres` filter selects it by name.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import {
    ensureSysSettingIdentityIndex,
    SYS_SETTING_IDENTITY_INDEX_NAME,
    SYS_SETTING_IDENTITY_PROBE_INDEX_NAME,
    SYS_SETTING_TABLE,
} from './sys-setting-identity-index.js';
import {
    ensureNotificationPreferenceIdentityIndex,
    NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME,
    NOTIFICATION_PREFERENCE_TABLE,
} from './notification-preference-identity-index.js';
import { currentLiveMysqlDatabase } from './live-mysql-database.testkit.js';
import type { IndexExec } from './partial-index-probe.js';

const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const EXPECT_LIVE = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';
const SCHEMA = currentLiveMysqlDatabase();

/** A value no report may print: settings rows can hold secrets. */
const SECRET = 'os26630-secret-value';

if (!PG_URL && EXPECT_LIVE) {
    describe('#26630 live PostgreSQL', () => {
        it('OS_TEST_POSTGRES_URL must be set — this runner declared it provisioned a server', () => {
            throw new Error(
                'OS_EXPECT_LIVE_DIALECT_MATRIX=1 without OS_TEST_POSTGRES_URL: the live PostgreSQL cell for ' +
                    'the identity-index migrations would have been skipped, and PostgreSQL is the one dialect ' +
                    'on which they reported success for a no-op.',
            );
        });
    });
}

describe.skipIf(!PG_URL)('#26630 identity indexes on a LIVE PostgreSQL', () => {
    let client: pg.Client;
    const exec: IndexExec = (sql: string) => client.query(sql);

    const quietLogger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() });

    const indexDef = async (name: string): Promise<string | undefined> => {
        const { rows } = await client.query<{ indexdef: string | null }>(
            `SELECT pg_get_indexdef(to_regclass('"${name}"')) AS indexdef`,
        );
        return rows[0]?.indexdef ?? undefined;
    };

    const constraintHolds = async (table: string, name: string): Promise<boolean> => {
        const { rows } = await client.query(
            'SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = to_regclass($2)',
            [name, `"${table}"`],
        );
        return rows.length > 0;
    };

    /** A tenant-scope settings row — `user_id` is NULL, as `SettingsService.set` writes it. */
    const insertSetting = (id: string) =>
        client.query(
            'INSERT INTO sys_setting (id, organization_id, namespace, key, scope, user_id, value) ' +
                "VALUES ($1, 'org_live', 'branding', 'workspace_name', 'tenant', NULL, $2)",
            [id, SECRET],
        );

    const seedSysSetting = async (): Promise<void> => {
        await client.query('DROP TABLE IF EXISTS os26630_setting_ref');
        await client.query('DROP TABLE IF EXISTS sys_setting');
        await client.query(
            'CREATE TABLE sys_setting (id VARCHAR(64) PRIMARY KEY, organization_id VARCHAR(64) NOT NULL, ' +
                'namespace VARCHAR(255), key VARCHAR(255), scope VARCHAR(32), user_id VARCHAR(64), value TEXT)',
        );
        // The driver's statement, as knex compiles it (header).
        await client.query(
            `alter table "sys_setting" add constraint "${SYS_SETTING_IDENTITY_INDEX_NAME}" ` +
                'unique ("organization_id", "namespace", "key", "scope", "user_id")',
        );
        expect(await constraintHolds(SYS_SETTING_TABLE, SYS_SETTING_IDENTITY_INDEX_NAME)).toBe(true);
    };

    beforeAll(async () => {
        client = new pg.Client({ connectionString: PG_URL });
        await client.connect();
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
        await client.query(`SET search_path TO "${SCHEMA}"`);
    });

    afterAll(async () => {
        if (!client) return;
        await client.query('SET search_path TO "$user", public');
        await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await client.end();
    });

    it("is pointed at a real PostgreSQL, in this file's own schema — without this the run proves nothing", async () => {
        const { rows } = await client.query<{ version: string; search_path: string }>(
            "SELECT version() AS version, current_setting('search_path') AS search_path",
        );
        // eslint-disable-next-line no-console
        console.log(`[#26630] live ${String(rows[0]!.version).split(',')[0]} search_path=${rows[0]!.search_path}`);
        expect(rows[0]!.version).toContain('PostgreSQL');
        expect(rows[0]!.search_path).toContain(SCHEMA);
    });

    describe('sys_setting', () => {
        beforeEach(seedSysSetting);

        it('replaces the declared CONSTRAINT with the NULL-safe index, quietly, and it refuses the duplicate', async () => {
            const logger = quietLogger();
            const result = await ensureSysSettingIdentityIndex(exec, logger, { client: 'pg' });

            expect(result).toEqual({ status: 'created' });
            expect(logger.error).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
            // The constraint is gone and the name now holds the NULL-safe key.
            expect(await constraintHolds(SYS_SETTING_TABLE, SYS_SETTING_IDENTITY_INDEX_NAME)).toBe(false);
            expect(await indexDef(SYS_SETTING_IDENTITY_INDEX_NAME)).toMatch(
                /^CREATE UNIQUE INDEX \S+ ON \S+ USING btree \(organization_id, namespace, key, scope, COALESCE\(user_id, ''::character varying\)\)$/,
            );
            expect(await indexDef(SYS_SETTING_IDENTITY_PROBE_INDEX_NAME)).toBeUndefined();

            // The behaviour the key exists for: the second tenant-scope row for
            // one (organization, namespace, key) is refused, SQLSTATE 23505.
            await insertSetting('s1');
            await expect(insertSetting('s2')).rejects.toMatchObject({ code: '23505' });
        });

        it('a second boot over the same database is quiet and idempotent', async () => {
            await ensureSysSettingIdentityIndex(exec, quietLogger(), { client: 'pg' });
            const first = await indexDef(SYS_SETTING_IDENTITY_INDEX_NAME);

            const logger = quietLogger();
            expect(await ensureSysSettingIdentityIndex(exec, logger, { client: 'pg' })).toEqual({
                status: 'created',
            });
            expect(logger.error).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
            expect(await indexDef(SYS_SETTING_IDENTITY_INDEX_NAME)).toBe(first);
        });

        it('duplicates already present: refuses, keeps the constraint, deletes nothing, and reports a count without values', async () => {
            await insertSetting('d1');
            await insertSetting('d2');
            const logger = quietLogger();

            const result = await ensureSysSettingIdentityIndex(exec, logger, { client: 'pg' });

            expect(result.status).toBe('conflict');
            expect(await constraintHolds(SYS_SETTING_TABLE, SYS_SETTING_IDENTITY_INDEX_NAME)).toBe(true);
            expect(await indexDef(SYS_SETTING_IDENTITY_PROBE_INDEX_NAME)).toBeUndefined();
            const { rows } = await client.query('SELECT id FROM sys_setting ORDER BY id');
            expect(rows.map((r) => r.id)).toEqual(['d1', 'd2']);

            expect(logger.error).toHaveBeenCalledTimes(1);
            const [message, error] = logger.error.mock.calls[0]!;
            expect(message).toContain(`"${SYS_SETTING_TABLE}"`);
            expect(message).toContain('organization_id, namespace, key, scope');
            expect(message).toContain('(1 duplicated key, held by 2 rows)');
            expect(`${message}\n${(error as Error).message}`).not.toContain(SECRET);
        });

        it('a name the drop cannot free is reported as NOT enforced — never as created', async () => {
            // Something depends on the declared constraint, so PostgreSQL refuses
            // to drop it (2BP01) and, without CASCADE, must keep refusing. The
            // `IF NOT EXISTS` create then succeeds as a no-op: the exact shape
            // that used to be answered `created`.
            await client.query(
                'CREATE TABLE os26630_setting_ref (organization_id VARCHAR(64), namespace VARCHAR(255), ' +
                    'key VARCHAR(255), scope VARCHAR(32), user_id VARCHAR(64), ' +
                    'FOREIGN KEY (organization_id, namespace, key, scope, user_id) ' +
                    'REFERENCES sys_setting (organization_id, namespace, key, scope, user_id))',
            );
            const logger = quietLogger();

            const result = await ensureSysSettingIdentityIndex(exec, logger, { client: 'pg' });

            expect(result.status).toBe('failed');
            expect(result.detail).toContain('cannot drop');
            expect(await constraintHolds(SYS_SETTING_TABLE, SYS_SETTING_IDENTITY_INDEX_NAME)).toBe(true);
            expect(logger.error).toHaveBeenCalledTimes(1);
            const [message] = logger.error.mock.calls[0]!;
            expect(message).toContain(SYS_SETTING_IDENTITY_INDEX_NAME);
            expect(message).toContain('duplicate tenant-scope and global-scope settings rows can still be created');
        });
    });

    describe('sys_notification_preference', () => {
        beforeEach(async () => {
            await client.query('DROP TABLE IF EXISTS sys_notification_preference');
            await client.query(
                'CREATE TABLE sys_notification_preference (id VARCHAR(64) PRIMARY KEY, ' +
                    'organization_id VARCHAR(64) NOT NULL, user_id VARCHAR(64), topic VARCHAR(255), ' +
                    'channel VARCHAR(64))',
            );
            await client.query(
                `alter table "sys_notification_preference" add constraint ` +
                    `"${NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME}" ` +
                    'unique ("organization_id", "user_id", "topic", "channel")',
            );
            expect(
                await constraintHolds(NOTIFICATION_PREFERENCE_TABLE, NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME),
            ).toBe(true);
        });

        const insertPreference = (id: string) =>
            client.query(
                'INSERT INTO sys_notification_preference (id, organization_id, user_id, topic, channel) ' +
                    "VALUES ($1, 'org_live', NULL, 'record.assigned', 'email')",
                [id],
            );

        it('replaces the declared CONSTRAINT with the NULL-safe index, and it refuses the duplicate', async () => {
            const logger = quietLogger();
            expect(await ensureNotificationPreferenceIdentityIndex(exec, logger, { client: 'pg' })).toEqual({
                status: 'created',
            });
            expect(logger.error).not.toHaveBeenCalled();
            expect(
                await constraintHolds(NOTIFICATION_PREFERENCE_TABLE, NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME),
            ).toBe(false);
            expect(await indexDef(NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME)).toContain('COALESCE(user_id');

            await insertPreference('p1');
            await expect(insertPreference('p2')).rejects.toMatchObject({ code: '23505' });
        });

        it('duplicates already present: refuses, keeps the constraint, and reports a count', async () => {
            await insertPreference('p1');
            await insertPreference('p2');
            await insertPreference('p3');
            const logger = quietLogger();

            expect((await ensureNotificationPreferenceIdentityIndex(exec, logger, { client: 'pg' })).status).toBe(
                'conflict',
            );
            expect(
                await constraintHolds(NOTIFICATION_PREFERENCE_TABLE, NOTIFICATION_PREFERENCE_IDENTITY_INDEX_NAME),
            ).toBe(true);
            const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM sys_notification_preference');
            expect(rows[0].n).toBe(3);
            const [message] = logger.error.mock.calls[0]!;
            expect(message).toContain('(1 duplicated key, held by 3 rows)');
        });
    });
});
