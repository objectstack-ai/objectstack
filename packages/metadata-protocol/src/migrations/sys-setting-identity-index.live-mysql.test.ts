// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9434 — the `sys_setting` degradation report's duplicate probe, RUN on a live
 * MySQL.
 *
 * ## Why this file exists rather than one more text pin
 *
 * The defect is invisible on the two dialects the rest of the suite runs on.
 * `key` is non-reserved on PostgreSQL and not a keyword at all on SQLite, so the
 * bare statement is perfectly good SQL there — a SQLite-only test passes with
 * the bug fully present, which is exactly what happened: the sibling suite even
 * EXECUTES the bare probe against a real SQLite and stayed green while MySQL
 * operators were being handed `ERROR 1064`.
 *
 * And the obvious cheap test is worse than none. Asserting that the message
 * "contains a backtick" would pass over any misquoted statement — a backtick in
 * the wrong place, a half-quoted projection, a `GROUP BY` that no longer matches
 * the projection under `ONLY_FULL_GROUP_BY`. Only a server can answer "does this
 * parse", so a server answers it.
 *
 * ## What is proved here, and in which direction
 *
 * Both directions, because one alone is not evidence:
 *
 *   - the MySQL-spelled statement RUNS, and returns the duplicate rows; and
 *   - the bare statement — the one the module printed before this fix — is
 *     REJECTED by the same server in the same session, with `ER_PARSE_ERROR`.
 *
 * Without the second, a server that had somehow accepted the bare form would
 * give a green run that means nothing. It is the card's own measurement, kept
 * live rather than quoted.
 *
 * The end-to-end leg goes further and takes the statement out of the LOG MESSAGE
 * `ensureSysSettingIdentityIndex` actually emits, rather than calling the builder
 * — because what is on trial is the operator's copy-paste, and a builder that is
 * right while the message interpolates the other one is the whole defect.
 *
 * ## The CREATE INDEX is deliberately proved to STAY refused
 *
 * `buildSysSettingIdentityIndexSql` is NOT quoted by this card, and the module's
 * header says quoting would not change MySQL's verdict on it. That claim is
 * checked here rather than trusted: the statement is refused by this server for
 * reasons quoting does not touch (unparenthesized functional key parts). It
 * guards the reasoning in both directions — if MySQL ever accepts it, the
 * `unsupported` arm this whole card is about stops being the arm MySQL reaches.
 *
 * ## Non-vacuity
 *
 * The suite ASSERTS the server is not running with `ANSI_QUOTES` and IS running
 * with `ONLY_FULL_GROUP_BY` before it asserts anything else — the first because
 * a server with it would parse quotes differently, the second because it is what
 * makes the `GROUP BY`/projection pairing a real constraint rather than a
 * formality. Same vacuous-pass guard as the sibling `#9381` file.
 *
 * ## Provisioning
 *
 * Needs `OS_TEST_MYSQL_URL` (the variable the driver-sql live matrix uses) and
 * reports a named SKIP without one — never a silent pass. A runner that knows it
 * provisioned the server sets `OS_EXPECT_LIVE_DIALECT_MATRIX=1`, which turns a
 * missing URL into a failure so a dropped `env:` line cannot quietly return this
 * seam to no coverage.
 *
 * Everything runs in its OWN database (`os_metadata_protocol_9434`), created on
 * the spot, because `sys_setting` is a fixed platform table name that other live
 * suites also use.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';

import {
    buildSysSettingDuplicateProbeSql,
    buildSysSettingDuplicateProbeSqlMysql,
    buildSysSettingIdentityIndexSql,
    ensureSysSettingIdentityIndex,
    SYS_SETTING_IDENTITY_INDEX_NAME,
    SYS_SETTING_TABLE,
} from './sys-setting-identity-index.js';
import type { IndexExec } from './partial-index-probe.js';

const MYSQL_URL = process.env.OS_TEST_MYSQL_URL;
const EXPECT_LIVE = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';
const DB = 'os_metadata_protocol_9434';

/**
 * The sentence the `unsupported` arm ends with, immediately before the
 * statement. Pinned here so the extraction below cannot silently start reading
 * the wrong half of the message — if the wording moves, this leg goes red rather
 * than running an empty string and passing.
 */
const STATEMENT_LEAD_IN = 'watch for duplicates with this MySQL statement: ';

if (!MYSQL_URL && EXPECT_LIVE) {
    describe('#9434 live MySQL', () => {
        it('OS_TEST_MYSQL_URL must be set — this runner declared it provisioned a server', () => {
            throw new Error(
                'OS_EXPECT_LIVE_DIALECT_MATRIX=1 without OS_TEST_MYSQL_URL: the live MySQL cell for ' +
                    "the sys_setting degradation report would have been skipped, returning #9434 to zero " +
                    'coverage on the only dialect that can exhibit it.',
            );
        });
    });
}

describe.skipIf(!MYSQL_URL)('#9434 the sys_setting duplicate probe on a LIVE MySQL', () => {
    let conn: mysql.Connection;

    beforeAll(async () => {
        const bootstrap = await mysql.createConnection(MYSQL_URL!);
        await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\``);
        await bootstrap.end();

        conn = await mysql.createConnection(`${MYSQL_URL}`);
        await conn.query(`USE \`${DB}\``);
        // The one session SET `SqlDriver` itself performs on a mysql connection.
        await conn.query(`SET time_zone = '+00:00'`);

        // The table as `platform-objects` declares it, in MySQL's own spelling —
        // the fixture has to quote `key` for the same reason the probe does.
        await conn.query(`DROP TABLE IF EXISTS \`${SYS_SETTING_TABLE}\``);
        await conn.query(
            `CREATE TABLE \`${SYS_SETTING_TABLE}\` (` +
                '`id` VARCHAR(64) PRIMARY KEY, `organization_id` VARCHAR(64) NULL, ' +
                '`namespace` VARCHAR(128) NOT NULL, `key` VARCHAR(128) NOT NULL, ' +
                '`scope` VARCHAR(32) NOT NULL, `user_id` VARCHAR(64) NULL, `value` TEXT)',
        );
        // Two tenant-scope rows for ONE (organization, namespace, key) with the
        // NULL `user_id` that makes the declared index void — the exact shape the
        // operator is being asked to go looking for.
        await conn.query(
            `INSERT INTO \`${SYS_SETTING_TABLE}\` ` +
                '(`id`, `organization_id`, `namespace`, `key`, `scope`, `user_id`, `value`) VALUES ' +
                "('d1','org_jia','lifecycle','retention_overrides','tenant',NULL,'\"v1\"')," +
                "('d2','org_jia','lifecycle','retention_overrides','tenant',NULL,'\"v2\"')," +
                "('u1','org_jia','lifecycle','retention_overrides','user','usr_1','\"v3\"')",
        );
    });

    afterAll(async () => {
        if (!conn) return;
        await conn.query(`DROP DATABASE IF EXISTS \`${DB}\``);
        await conn.end();
    });

    it('the server is NOT on ANSI_QUOTES and IS on ONLY_FULL_GROUP_BY — without this the run proves nothing', async () => {
        const [rows] = await conn.query('SELECT @@session.sql_mode AS sql_mode, VERSION() AS version');
        const mode = String((rows as Array<{ sql_mode: string }>)[0]!.sql_mode);
        // Printed so the CI log carries the measurement, not just the verdict.
        // eslint-disable-next-line no-console
        console.log(
            `[#9434] live MySQL ${(rows as Array<{ version: string }>)[0]!.version} sql_mode=${mode}`,
        );
        expect(mode).not.toContain('ANSI_QUOTES');
        expect(mode).toContain('ONLY_FULL_GROUP_BY');
    });

    it('CONTROL: the bare statement this module used to print is REJECTED — ER_PARSE_ERROR', async () => {
        // The card's measurement, kept live. Without this the green above could
        // mean "MySQL accepts both spellings" rather than "the fix was needed".
        await expect(conn.query(buildSysSettingDuplicateProbeSql())).rejects.toMatchObject({
            code: 'ER_PARSE_ERROR',
        });
    });

    it('the MySQL-spelled statement PARSES, and lists exactly the duplicate group', async () => {
        const [rows] = await conn.query(buildSysSettingDuplicateProbeSqlMysql());
        expect(rows).toEqual([
            {
                organization_id_key: 'org_jia',
                namespace: 'lifecycle',
                key: 'retention_overrides',
                scope: 'tenant',
                user_id_key: '',
                duplicate_rows: 2,
            },
        ]);
    });

    it('END TO END: the statement an operator copies OUT OF THE LOG runs on this server', async () => {
        // What is on trial is the copy-paste, not the builder. A correct builder
        // whose output never reaches the message is the defect itself.
        const messages: string[] = [];
        const logger = { error: (m: string) => messages.push(m), warn: () => {}, info: () => {} };
        // A seam that answers the presence probe and refuses the DDL the way this
        // MySQL does — the module's own `unsupported` classification path.
        const refusing: IndexExec = async (sql: string) => {
            if (/^CREATE UNIQUE INDEX/i.test(sql)) {
                throw new Error("You have an error in your SQL syntax near '(COALESCE'");
            }
            return conn.query(sql) as unknown as Promise<unknown>;
        };

        const result = await ensureSysSettingIdentityIndex(refusing, logger as never);
        expect(result.status).toBe('unsupported');

        const [message] = messages;
        expect(message).toContain(STATEMENT_LEAD_IN);
        const copied = message!.slice(message!.indexOf(STATEMENT_LEAD_IN) + STATEMENT_LEAD_IN.length);
        expect(copied.length).toBeGreaterThan(0);

        // The whole point of the card, measured: paste it, and it runs.
        const [rows] = await conn.query(copied);
        expect((rows as unknown[]).length).toBe(1);
    });

    it('the CREATE INDEX stays refused whatever the quoting — the header verdict this card did NOT touch', async () => {
        // Quoting rescues the SELECT and nothing about the CREATE: MySQL refuses
        // the unparenthesized functional key parts. Measured, so the reasoning
        // left standing in the module header is not merely asserted.
        await expect(
            conn.query(buildSysSettingIdentityIndexSql(SYS_SETTING_IDENTITY_INDEX_NAME)),
        ).rejects.toMatchObject({ code: 'ER_PARSE_ERROR' });

        // …and not because of `key`: the same statement with every identifier
        // quoted MySQL's way is refused too. This is what makes "quoting would
        // not change that verdict" a measurement rather than a guess.
        const quoted = buildSysSettingIdentityIndexSql(SYS_SETTING_IDENTITY_INDEX_NAME)
            .replace(/\bkey\b(?=,)/, '`key`')
            .replace(new RegExp(`\\b${SYS_SETTING_TABLE}\\b(?= \\()`), `\`${SYS_SETTING_TABLE}\``);
        await expect(conn.query(quoted)).rejects.toMatchObject({ code: 'ER_PARSE_ERROR' });
    });
});
