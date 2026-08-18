// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9381 — the seed-tenancy backfill's statements, RUN on a live MySQL.
 *
 * ## Why this file exists rather than one more text pin
 *
 * The defect it guards is invisible on the two dialects the rest of the suite
 * runs on. `"identifier"` is correct ANSI on SQLite and PostgreSQL, so a
 * SQLite-only or Postgres-only test passes with the bug fully present. MySQL is
 * the only dialect that can fail — it does not run with `ANSI_QUOTES`, so `"x"`
 * is a STRING LITERAL there — and the module's own header names MySQL as a
 * supported backend. A migration whose statements cannot parse on a backend the
 * module claims is declared ≠ enforced, and the reason it never surfaced is that
 * every call site swallows a migration failure into a warning by design: on
 * MySQL the symptom was a skipped repair in the boot log, not an error.
 *
 * ## Non-vacuity
 *
 * The suite ASSERTS the server is not running with `ANSI_QUOTES` before it
 * asserts anything else. On a server that had it, these statements would parse
 * with the bug present and a green run would mean nothing — the same
 * vacuous-pass hole `live-dialect-matrix.testkit.ts` closes for the timezone
 * axis, and the exact condition #9381's premise step had to rule out.
 *
 * ## Provisioning
 *
 * Needs `OS_TEST_MYSQL_URL` (same variable the driver-sql live matrix uses) and
 * reports a named SKIP without one — never a silent pass. A runner that knows it
 * provisioned the server sets `OS_EXPECT_LIVE_DIALECT_MATRIX=1`, which turns the
 * missing URL into a failure so a dropped `env:` line cannot quietly return this
 * seam to no coverage at all.
 *
 * Everything runs in its OWN database (`os_metadata_protocol_9381`), created on
 * the spot, because two of the three tables this migration touches have fixed
 * platform names (`_objectstack_sequences`, `sys_organization`) that other live
 * suites also use.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import {
  backfillSeedTenancy,
  buildCollisionProbeSql,
  buildCounterMergeSql,
  buildGlobalCounterDeleteSql,
  buildOrganizationProbeSql,
  buildSequencesPresenceSql,
  buildSplitProbeSql,
  buildStampSql,
  GLOBAL_TENANT,
  SEQUENCES_TABLE,
  type SeedTenancySeam,
} from './seed-tenancy-backfill.js';

const MYSQL_URL = process.env.OS_TEST_MYSQL_URL;
const EXPECT_LIVE = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';
const DB = 'os_metadata_protocol_9381';
const OBJECT = 'os9381_case';
const FIELD = 'case_number';

if (!MYSQL_URL && EXPECT_LIVE) {
  describe('#9381 live MySQL', () => {
    it('OS_TEST_MYSQL_URL must be set — this runner declared it provisioned a server', () => {
      throw new Error(
        'OS_EXPECT_LIVE_DIALECT_MATRIX=1 without OS_TEST_MYSQL_URL: the live MySQL cell for ' +
          'the metadata-protocol migrations would have been skipped, returning #9381 to zero ' +
          'coverage on the only dialect that can exhibit it.',
      );
    });
  });
}

describe.skipIf(!MYSQL_URL)('#9381 seed-tenancy backfill on a LIVE MySQL', () => {
  let conn: mysql.Connection;
  let seam: SeedTenancySeam;

  beforeAll(async () => {
    const bootstrap = await mysql.createConnection(MYSQL_URL!);
    await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\``);
    await bootstrap.end();

    conn = await mysql.createConnection(`${MYSQL_URL}`);
    await conn.query(`USE \`${DB}\``);
    // The one session SET `SqlDriver` itself performs on a mysql connection.
    await conn.query(`SET time_zone = '+00:00'`);

    seam = {
      exec: (sql: string, params?: unknown[]) => conn.query(sql, params ?? []),
      client: 'mysql2',
    };
  });

  afterAll(async () => {
    if (!conn) return;
    await conn.query(`DROP DATABASE IF EXISTS \`${DB}\``);
    await conn.end();
  });

  const seedFixture = async (): Promise<void> => {
    await conn.query(`DROP TABLE IF EXISTS \`${SEQUENCES_TABLE}\``);
    await conn.query(`DROP TABLE IF EXISTS \`${OBJECT}\``);
    await conn.query(`DROP TABLE IF EXISTS \`sys_organization\``);
    // Column names spelled the way the driver's own `createSequencesTable`
    // spells them; `last_value` is quoted here for the same reason the migration
    // has to quote it (see the reserved-word assertion below).
    await conn.query(
      `CREATE TABLE \`${SEQUENCES_TABLE}\` (` +
        '`key_hash` VARCHAR(64), `object` VARCHAR(64), `tenant_id` VARCHAR(64), ' +
        '`field` VARCHAR(64), `scope` VARCHAR(255) NOT NULL DEFAULT \'\', ' +
        '`last_value` INT, `updated_at` DATETIME(3))',
    );
    await conn.query(
      `CREATE TABLE \`${OBJECT}\` (` +
        '`id` VARCHAR(64), `case_number` VARCHAR(64), `organization_id` VARCHAR(64))',
    );
    await conn.query('CREATE TABLE `sys_organization` (`id` VARCHAR(64))');
    await conn.query("INSERT INTO `sys_organization` (`id`) VALUES ('org_live')");
    await conn.query(
      `INSERT INTO \`${SEQUENCES_TABLE}\` (\`key_hash\`, \`object\`, \`tenant_id\`, \`field\`, \`last_value\`) ` +
        `VALUES ('h_global', '${OBJECT}', '${GLOBAL_TENANT}', '${FIELD}', 38), ` +
        `('h_org', '${OBJECT}', 'org_live', '${FIELD}', 4)`,
    );
    // The card's own repro: seeded rows carry NULL, API rows carry the org, and
    // CASE-00001/2 were minted on BOTH sides.
    await conn.query(
      `INSERT INTO \`${OBJECT}\` (\`id\`, \`case_number\`, \`organization_id\`) VALUES ` +
        "('s1','CASE-00001',NULL),('s2','CASE-00002',NULL),('s3','CASE-00003',NULL)," +
        "('a1','CASE-00001','org_live'),('a2','CASE-00002','org_live')",
    );
  };

  it('the server is NOT running with ANSI_QUOTES — without this the run proves nothing', async () => {
    const [rows] = await conn.query('SELECT @@session.sql_mode AS sql_mode, VERSION() AS version');
    const mode = String((rows as Array<{ sql_mode: string }>)[0]!.sql_mode);
    // Printed so the CI log carries the measurement, not just the verdict.
    // eslint-disable-next-line no-console
    console.log(
      `[#9381] live MySQL ${(rows as Array<{ version: string }>)[0]!.version} sql_mode=${mode}`,
    );
    expect(mode).not.toContain('ANSI_QUOTES');
  });

  it('every statement the migration builds PARSES and runs on MySQL', async () => {
    await seedFixture();
    const client = 'mysql2';
    const statements: Array<[string, string, unknown[]]> = [
      ['presence probe', buildSequencesPresenceSql(client), []],
      ['split probe', buildSplitProbeSql(client), [GLOBAL_TENANT, GLOBAL_TENANT]],
      ['organization probe', buildOrganizationProbeSql(client), []],
      ['collision probe', buildCollisionProbeSql(OBJECT, FIELD, client), []],
      ['stamp', buildStampSql(OBJECT, [FIELD], client), ['org_live']],
      ['counter merge', buildCounterMergeSql(client), [38, OBJECT, FIELD, 'org_live']],
      ['global counter delete', buildGlobalCounterDeleteSql(client), [OBJECT, FIELD, GLOBAL_TENANT]],
    ];
    for (const [label, sql, params] of statements) {
      // A failure here names the statement AND its text — the parse error alone
      // does not say which builder produced it.
      await expect(
        conn.query(sql, params),
        `${label} must run on MySQL — statement: ${sql}`,
      ).resolves.toBeDefined();
    }
  });

  it('a multi-autonumber object stamps with one derived table per guard', async () => {
    await seedFixture();
    await conn.query(`ALTER TABLE \`${OBJECT}\` ADD COLUMN \`ticket_no\` VARCHAR(64)`);
    // Two guards in ONE statement: a repeated derived-table alias would be
    // ER_NONUNIQ_TABLE, and the un-wrapped form ER_UPDATE_TABLE_USED.
    await expect(
      conn.query(buildStampSql(OBJECT, [FIELD, 'ticket_no'], 'mysql2'), ['org_live']),
    ).resolves.toBeDefined();
  });

  it('repairs the split end to end, and reports the already-minted duplicates', async () => {
    await seedFixture();
    const warnings: string[] = [];
    const result = await backfillSeedTenancy(seam, {
      warn: (m: string) => warnings.push(m),
      info: () => {},
    } as never);

    expect(result.status).toBe('applied');
    expect(result.organizationId).toBe('org_live');
    expect(result.splits).toEqual([
      { object: OBJECT, field: FIELD, globalLastValue: 38, organizationLastValue: 4 },
    ]);
    // Reported, never renumbered — the two values minted on both sides.
    expect(result.collisions.map((c) => c.value).sort()).toEqual(['CASE-00001', 'CASE-00002']);

    // The movable row moved; the two colliding rows kept their NULL.
    const [rows] = await conn.query(
      `SELECT \`id\`, \`organization_id\` FROM \`${OBJECT}\` ORDER BY \`id\``,
    );
    const byId = Object.fromEntries(
      (rows as Array<{ id: string; organization_id: string | null }>).map((r) => [
        r.id,
        r.organization_id,
      ]),
    );
    expect(byId.s3).toBe('org_live');
    expect(byId.s1).toBeNull();
    expect(byId.s2).toBeNull();

    // The counters were merged at max(last_value) and the `__global__` row retired.
    const [counters] = await conn.query(
      `SELECT \`tenant_id\`, \`last_value\` FROM \`${SEQUENCES_TABLE}\` ORDER BY \`tenant_id\``,
    );
    expect(counters).toEqual([{ tenant_id: 'org_live', last_value: 38 }]);
  });

  it('is idempotent — a second run finds no split', async () => {
    const second = await backfillSeedTenancy(seam);
    expect(second.status).toBe('no-split');
  });
});
