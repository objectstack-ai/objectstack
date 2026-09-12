// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17621 — the seed-tenancy backfill's statements, RUN on a live PostgreSQL.
 *
 * ## The gap this closes
 *
 * #17175 replaced two `WHERE 1 = 0` presence probes with catalog queries and
 * compiled ONE ARM PER DIALECT FAMILY in `read-probe.ts`. Two of the three arms
 * were then executed against something real — SQLite end to end through a real
 * `SqlDriver`, MySQL on the live server in
 * `seed-tenancy-backfill.live-mysql.test.ts`. The PostgreSQL arm was pinned
 * character-for-character as TEXT against four client spellings and ⛔ never
 * executed anywhere, because this package had no live-PG harness, no `pg`
 * dependency, and a CI leg carrying `OS_TEST_MYSQL_URL` alone.
 *
 * ⚠️ A text pin cannot close that gap, and the reason is specific rather than
 * general. The failure this module is fenced against is an arm MIS-COMPILED for
 * one dialect: it raises, the `catch` that exists for the expected miss swallows
 * it, and a data repair silently becomes a no-op. A text pin asserts the
 * characters this repo MEANT to send. Only a server can answer whether those
 * characters parse, resolve, and — the part that matters here — come back as
 * ZERO ROWS rather than as an exception when the table is not there.
 * `to_regclass` returning NULL instead of raising is the entire behavioural
 * claim of the Postgres arm, and it is a claim about PostgreSQL, not about this
 * repo's string concatenation.
 *
 * ## Non-vacuity
 *
 * Two guards, both of which a green run must survive before any assertion here
 * means anything:
 *
 *  1. the suite asserts it is talking to a real **PostgreSQL** server and that
 *     the connection's `search_path` is this file's own schema, printing both,
 *     so a mis-provisioned URL cannot pass as one;
 *  2. every "absent" reading is paired with the CONTROL that makes it a reading:
 *     the fallback statement the catalog arm did NOT run is issued directly and
 *     must be REFUSED. Without it, "answered zero rows" is indistinguishable
 *     from "the probe quietly found nothing to do" — the exact confusion
 *     `readTablePresence` exists to prevent.
 *
 * The MySQL sibling's own non-vacuity guard (the server must not run with
 * `ANSI_QUOTES`) has no counterpart here, on purpose: it exists because MySQL is
 * the dialect on which the ANSI `"identifier"` spelling can silently become a
 * string literal. PostgreSQL is the dialect that spelling is NATIVE to, so no
 * server mode turns this suite vacuous the way `ANSI_QUOTES` would. What can
 * turn it vacuous is a probe that never ran, which is what (2) covers.
 *
 * ## Provisioning
 *
 * Needs `OS_TEST_POSTGRES_URL` (the same variable the driver-sql live matrix
 * uses) and reports a named SKIP without one — never a silent pass. A runner
 * that knows it provisioned the server sets `OS_EXPECT_LIVE_DIALECT_MATRIX=1`,
 * which turns the missing URL into a failure, so a dropped `env:` line cannot
 * quietly return this seam to the no-coverage state #17621 records.
 *
 * ## Isolation — a per-file SCHEMA, and why the resolver is the MySQL-named one
 *
 * Everything runs in its own schema on the `search_path`, created on the spot
 * and dropped in `afterAll`, because the two tables this migration touches have
 * fixed platform names (`_objectstack_sequences`, `sys_organization`) that other
 * live suites on the same CI server also use. `drop schema … cascade` in
 * `afterAll` is what makes a SHARED name destructive rather than merely
 * contended (#10382), and `scripts/check-live-db-isolation.mjs` refuses any live
 * suite in the tree whose name reaches that DDL as a literal.
 *
 * ⚠️ The name comes from `currentLiveMysqlDatabase()` — the MySQL-named resolver
 * — DELIBERATELY, and the name is the only MySQL thing about it. What it
 * computes is `os_lv_<slug>_<12 hex of sha256(repo-relative path)>`, already
 * capped at 63 bytes because that is *PostgreSQL's* identifier limit and not
 * MySQL's 64. Calling it by that name is also what enrols this file in
 * `live-mysql-database.isolation.test.ts`'s population, which is discovered by
 * reading each test file for that exact call — so a dialect-neutral alias here
 * would buy a better name at the price of this file's distinctness never being
 * measured. Renaming the resolver repo-wide is a separate, mechanical change.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import pg from 'pg';
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
import { currentLiveMysqlDatabase } from './live-mysql-database.testkit.js';
import { buildTablePresenceSql, readTablePresence } from './read-probe.js';

const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const EXPECT_LIVE = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';
const SCHEMA = currentLiveMysqlDatabase();
const OBJECT = 'os17621_case';
const FIELD = 'case_number';

/**
 * The row key of `_objectstack_sequences`, spelled the way its only production
 * writer spells it (#12394) — a third independent copy of the derivation, and
 * therefore a pin on it, for the reason the MySQL sibling records at length.
 *
 * The separator is the ASCII unit separator, written as the escape backslash-u
 * 001f and never as a raw control byte — the same discipline the module and the
 * driver both keep.
 */
function sequenceKeyHash(object: string, tenantId: string, field: string, scope: string): string {
  return createHash('sha256')
    .update(`${object}${tenantId}${field}${scope}`)
    .digest('hex');
}

/**
 * Rewrite the `?` placeholders every builder in this module emits into
 * PostgreSQL's `$1, $2, …`.
 *
 * ⛔ NOT a convenience this suite invented for itself. `?` is the binding form
 * the whole module compiles for, on every dialect, because the production seam
 * is `SqlDriver.execute()` reaching knex's `raw(sql, bindings)`, and knex is
 * what re-spells the placeholder per dialect on the way to the wire. `pg` is the
 * raw client underneath knex and speaks only `$n`, so a suite holding a raw `pg`
 * connection has to do the one thing knex would have done — and doing it HERE,
 * with the literal-scanner spelled out, is what lets this file exercise its own
 * statements without a knex dependency (`metadata-protocol` must not depend on a
 * driver).
 *
 * Single-quoted literals are skipped so a `?` inside one is not renumbered; a
 * doubled `''` inside a literal toggles twice and therefore lands correctly.
 * ⛔ There is no dollar-quoting or comment handling because no builder in this
 * module emits either, and a scanner covering forms that never arrive is a
 * scanner nothing tests.
 */
function toPgPlaceholders(sql: string): string {
  let out = '';
  let index = 0;
  let inLiteral = false;
  for (const ch of sql) {
    if (ch === "'") {
      inLiteral = !inLiteral;
      out += ch;
    } else if (ch === '?' && !inLiteral) {
      index += 1;
      out += `$${index}`;
    } else {
      out += ch;
    }
  }
  return out;
}

if (!PG_URL && EXPECT_LIVE) {
  describe('#17621 live PostgreSQL', () => {
    it('OS_TEST_POSTGRES_URL must be set — this runner declared it provisioned a server', () => {
      throw new Error(
        'OS_EXPECT_LIVE_DIALECT_MATRIX=1 without OS_TEST_POSTGRES_URL: the live PostgreSQL cell ' +
          'for the metadata-protocol migrations would have been skipped, returning the ' +
          "read-probe's Postgres arm to the zero-execution state #17621 was filed for — a " +
          'state in which a mis-compiled arm turns a data repair into a silent no-op.',
      );
    });
  });
}

describe.skipIf(!PG_URL)('#17621 seed-tenancy backfill on a LIVE PostgreSQL', () => {
  let client: pg.Client;
  let seam: SeedTenancySeam;

  /** The raw seam, in the shape `SeedTenancySeam` asks for, over a `pg` client. */
  const exec = (sql: string, params?: unknown[]): Promise<unknown> =>
    client.query(toPgPlaceholders(sql), (params ?? []) as unknown[]);

  beforeAll(async () => {
    client = new pg.Client({ connectionString: PG_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    // Everything this suite issues is UNQUALIFIED, exactly as the migration's
    // own statements are — which is the point: `to_regclass` resolves through
    // `search_path`, so setting it here is what makes the arm answer about THIS
    // schema. The driver reaches the same state through knex's `searchPath`.
    await client.query(`SET search_path TO "${SCHEMA}"`);

    seam = { exec, client: 'pg' };
  });

  afterAll(async () => {
    if (!client) return;
    // `search_path` still points at the schema being dropped, so reset first.
    await client.query('SET search_path TO "$user", public');
    await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await client.end();
  });

  const seedFixture = async (): Promise<void> => {
    await client.query(`DROP TABLE IF EXISTS "${SEQUENCES_TABLE}"`);
    await client.query(`DROP TABLE IF EXISTS "${OBJECT}"`);
    await client.query('DROP TABLE IF EXISTS "sys_organization"');
    // Column names and the PRIMARY KEY spelled the way the driver's own
    // `createSequencesTable` spells them. `key_hash` carries the real key for
    // the reason the MySQL sibling records: seeded as a plain column, a repair
    // writing a SECOND row for one logical counter lands quietly as an extra
    // row instead of a unique violation.
    await client.query(
      `CREATE TABLE "${SEQUENCES_TABLE}" (` +
        '"key_hash" VARCHAR(64) NOT NULL PRIMARY KEY, "object" VARCHAR(64), ' +
        '"tenant_id" VARCHAR(64), ' +
        '"field" VARCHAR(64), "scope" VARCHAR(255) NOT NULL DEFAULT \'\', ' +
        '"last_value" INT, "updated_at" TIMESTAMP(3))',
    );
    await client.query(
      `CREATE TABLE "${OBJECT}" (` +
        '"id" VARCHAR(64), "case_number" VARCHAR(64), "organization_id" VARCHAR(64))',
    );
    await client.query('CREATE TABLE "sys_organization" ("id" VARCHAR(64))');
    await client.query(`INSERT INTO "sys_organization" ("id") VALUES ('org_live')`);
    await client.query(
      `INSERT INTO "${SEQUENCES_TABLE}" ("key_hash", "object", "tenant_id", "field", "last_value") ` +
        `VALUES ($1, '${OBJECT}', '${GLOBAL_TENANT}', '${FIELD}', 38), ` +
        `($2, '${OBJECT}', 'org_live', '${FIELD}', 4)`,
      [
        sequenceKeyHash(OBJECT, GLOBAL_TENANT, FIELD, ''),
        sequenceKeyHash(OBJECT, 'org_live', FIELD, ''),
      ],
    );
    // The card's own repro: seeded rows carry NULL, API rows carry the org, and
    // CASE-00001/2 were minted on BOTH sides.
    await client.query(
      `INSERT INTO "${OBJECT}" ("id", "case_number", "organization_id") VALUES ` +
        "('s1','CASE-00001',NULL),('s2','CASE-00002',NULL),('s3','CASE-00003',NULL)," +
        "('a1','CASE-00001','org_live'),('a2','CASE-00002','org_live')",
    );
  };

  it("is pointed at a real PostgreSQL, in this file's own schema — without this the run proves nothing", async () => {
    const { rows } = await client.query<{ version: string; search_path: string }>(
      "SELECT version() AS version, current_setting('search_path') AS search_path",
    );
    const version = String(rows[0]!.version);
    // Printed so the CI log carries the measurement, not just the verdict.
    // eslint-disable-next-line no-console
    console.log(`[#17621] live ${version.split(',')[0]} search_path=${rows[0]!.search_path}`);
    expect(version).toContain('PostgreSQL');
    expect(rows[0]!.search_path).toContain(SCHEMA);
  });

  it('every statement the migration builds PARSES and runs on PostgreSQL', async () => {
    await seedFixture();
    const c = 'pg';
    const statements: Array<[string, string, unknown[]]> = [
      ['presence probe (fallback arm)', buildSequencesPresenceSql(c), []],
      // The statement the boot path actually runs now. It is in this list for
      // the reason every other one is here, and #17621 exists because it was
      // the ONE arm this list could not previously contain.
      ['presence probe (catalog arm)', buildTablePresenceSql(SEQUENCES_TABLE, c) as string, []],
      ['split probe', buildSplitProbeSql(c), [GLOBAL_TENANT, GLOBAL_TENANT]],
      ['organization probe', buildOrganizationProbeSql(c), []],
      ['collision probe', buildCollisionProbeSql(OBJECT, FIELD, c), []],
      ['stamp', buildStampSql(OBJECT, [FIELD], c), ['org_live']],
      ['counter merge', buildCounterMergeSql(c), [38, OBJECT, FIELD, 'org_live']],
      ['global counter delete', buildGlobalCounterDeleteSql(c), [OBJECT, FIELD, GLOBAL_TENANT]],
    ];
    for (const [label, sql, params] of statements) {
      // A failure here names the statement AND its text — the parse error alone
      // does not say which builder produced it.
      await expect(
        exec(sql, params),
        `${label} must run on PostgreSQL — statement: ${sql}`,
      ).resolves.toBeDefined();
    }
  });

  it('[#17621] the catalog presence probe ANSWERS on PostgreSQL — both directions, on the live server', async () => {
    await seedFixture();

    // Present: the fixture created the counter table in this schema, so
    // `to_regclass` resolves it through the search path.
    const present = await readTablePresence((sql: string) => exec(sql), {
      table: SEQUENCES_TABLE,
      client: 'pg',
      fallbackSql: buildSequencesPresenceSql('pg'),
    });
    expect(present).toEqual({ verdict: 'present', probe: 'catalog' });

    // ⭐ Absent: a table this schema does not have. The arm must ANSWER rather
    // than raise — on PostgreSQL that means `to_regclass` evaluating to NULL and
    // the statement returning zero rows. This is the assertion #17175 could pin
    // as text and could not make.
    const absent = await readTablePresence((sql: string) => exec(sql), {
      table: 'os17621_absent_table',
      client: 'pg',
      fallbackSql: 'SELECT 1 FROM os17621_absent_table WHERE 1 = 0',
    });
    expect(absent).toEqual({ verdict: 'absent', probe: 'catalog' });

    // ⛔ And the control that makes the line above mean something: the fallback
    // statement this probe did NOT run is one the server really does refuse, so
    // "answered zero rows" is a reading about the catalog arm and not about a
    // table that happens to exist.
    await expect(exec('SELECT 1 FROM os17621_absent_table WHERE 1 = 0')).rejects.toThrow();
  });

  it('[#17621] the scope is the SEARCH PATH — a same-named relation off it is not this one', async () => {
    // The Postgres counterpart of the MySQL arm's `table_schema = DATABASE()`
    // measurement. An arm written against `pg_class` with no namespace
    // restriction sees every schema on the connection and would answer
    // "present" for a table this connection cannot address unqualified;
    // `to_regclass` resolving through `search_path` is what rules that out, and
    // only a live server can say so.
    const other = `${SCHEMA}_x`;
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${other}"`);
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS "${other}".os17621_elsewhere (id INT)`);

      const verdict = await readTablePresence((sql: string) => exec(sql), {
        table: 'os17621_elsewhere',
        client: 'pg',
        fallbackSql: 'SELECT 1 FROM os17621_elsewhere WHERE 1 = 0',
      });

      expect(verdict.verdict).toBe('absent');
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${other}" CASCADE`);
    }
  });

  it("[#17621] the arm's QUOTED argument matches exactly — a case-folded neighbour is not this table", async () => {
    // `buildTablePresenceSql` quotes the name inside the `to_regclass` literal,
    // and `isProbeableTableName` admits upper-case letters — so this is a
    // reachable spelling, not a hypothetical. Unquoted, `to_regclass` would
    // case-fold and answer "present" for the lower-case neighbour. PostgreSQL is
    // the only one of the three dialects where identifier folding can make a
    // presence probe answer about a DIFFERENT relation, so the claim is checked
    // where it can fail.
    await client.query('DROP TABLE IF EXISTS "os17621_folding"');
    await client.query('CREATE TABLE "os17621_folding" (id INT)');
    try {
      const mixed = await readTablePresence((sql: string) => exec(sql), {
        table: 'OS17621_Folding',
        client: 'pg',
        fallbackSql: 'SELECT 1 FROM "OS17621_Folding" WHERE 1 = 0',
      });
      expect(mixed).toEqual({ verdict: 'absent', probe: 'catalog' });

      const exact = await readTablePresence((sql: string) => exec(sql), {
        table: 'os17621_folding',
        client: 'pg',
        fallbackSql: 'SELECT 1 FROM "os17621_folding" WHERE 1 = 0',
      });
      expect(exact).toEqual({ verdict: 'present', probe: 'catalog' });
    } finally {
      await client.query('DROP TABLE IF EXISTS "os17621_folding"');
    }
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
    const { rows } = await client.query<{ id: string; organization_id: string | null }>(
      `SELECT "id", "organization_id" FROM "${OBJECT}" ORDER BY "id"`,
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.organization_id]));
    expect(byId.s3).toBe('org_live');
    expect(byId.s1).toBeNull();
    expect(byId.s2).toBeNull();

    // The counters were merged at max(last_value) and the `__global__` row retired.
    const counters = await client.query<{ tenant_id: string; last_value: number }>(
      `SELECT "tenant_id", "last_value" FROM "${SEQUENCES_TABLE}" ORDER BY "tenant_id"`,
    );
    expect(counters.rows).toEqual([{ tenant_id: 'org_live', last_value: 38 }]);
  });

  it('is idempotent — a second run finds no split', async () => {
    const second = await backfillSeedTenancy(seam);
    expect(second.status).toBe('no-split');
  });
});
