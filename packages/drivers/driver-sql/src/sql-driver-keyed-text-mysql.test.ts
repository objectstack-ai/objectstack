// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11374 — a text-family field that a declared index KEYS ON.
 *
 * ## The defect this pins, and why nothing caught it
 *
 * `createColumn` mapped the whole text family to an unbounded `TEXT`, ignoring
 * the field's declared `maxLength`. MySQL refuses a TEXT/BLOB column in a key
 * without a prefix length, so the `CREATE TABLE` succeeded and the following
 * `ALTER TABLE … ADD [UNIQUE] INDEX` failed — the table landed on disk WITHOUT
 * the constraint it declared, and the object stayed registered-but-broken.
 * Measured on MySQL 8.0.46 before the fix: **36 of the 44 platform objects**
 * failed schema-sync that way, every one with `ER_BLOB_KEY_WITHOUT_LENGTH`, so
 * an auth stack could not stand up its own schema on a driver that
 * `createDefaultDatasourceDriverFactory` maps `mysql`/`mysql2` onto.
 *
 * The reason no gate saw it is the reason this file is HERE, in `driver-sql`,
 * rather than anywhere nearer the platform objects: the required
 * `Temporal Conformance (live PG + MySQL)` job runs `pnpm --filter
 * @objectstack/driver-sql test` with `OS_TEST_MYSQL_URL` set, and every suite in
 * this package builds its tables with an explicit `knex.string()` (VARCHAR) —
 * so the one job with a live MySQL attached never exercised the TEXT mapping at
 * all. A new file in this directory needs no CI change to be covered: the
 * globalSetup creates its per-file database from the same ledger every other
 * live file uses.
 *
 * ## What each half is worth
 *
 * The SQLite block runs everywhere, including Test Core, and pins the emission
 * rule itself (`varchar(maxLength)` for a keyed bounded field, TEXT otherwise).
 * The MySQL block is the one that reds on the pre-fix tree, because SQLite has
 * no keyable-type restriction to violate — which is precisely how a defect that
 * only MySQL can express stayed invisible.
 *
 * Opt-in for the live half — needs a real server:
 *
 *   OS_TEST_MYSQL_URL=mysql://root:root@127.0.0.1:3306/conformance \
 *     pnpm --filter @objectstack/driver-sql test
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { MYSQL_CELL, dialectCell, declareDialectCell } from './live-dialect-matrix.testkit.js';

/**
 * One object whose every text field is keyed, unkeyed, bounded or unbounded on
 * purpose — the four corners of {@link SqlDriver.keyableTextLength}'s decision
 * in one table, so a change to that decision cannot be green in three corners
 * and wrong in the fourth.
 */
const BOUNDED_TABLE = 'os11374_bounded';
const boundedObject = () => ({
  name: BOUNDED_TABLE,
  fields: {
    // keyed + bounded → varchar(n). The shape `sys_user.phone_number` has.
    slug: { type: 'text', maxLength: 64 },
    // keyed + bounded, in a COMPOSITE → same rule, no special case.
    locale: { type: 'text', maxLength: 16 },
    // NOT keyed, bounded → stays TEXT. The row-size guard: `varchar(65000)` on
    // utf8mb4 is 260000 bytes and exceeds MySQL's 65535-byte row limit, so
    // bounding an unkeyed column could make a working table un-creatable.
    body: { type: 'text', maxLength: 65000 },
    // NOT keyed, unbounded → stays TEXT (unchanged behaviour).
    notes: { type: 'text' },
  },
  indexes: [
    { fields: ['slug'], unique: true },
    { fields: ['slug', 'locale'], unique: false },
  ],
});

/** The same object with the keyed column's bound REMOVED — the refusal case. */
const UNBOUNDED_TABLE = 'os11374_unbounded';
const unboundedObject = () => ({
  name: UNBOUNDED_TABLE,
  fields: { token: { type: 'text' } },
  indexes: [{ fields: ['token'], unique: true }],
});

/**
 * Bounded, but WIDER than a utf8mb4 key part can be. Measured, not assumed:
 * `varchar(768)` takes a unique index and `varchar(769)` is refused with
 * `ER_TOO_LONG_KEY: max key length is 3072 bytes`. This is the shape
 * `sys_oauth_access_token.token` (`maxLength: 1024`) has, and it must land in
 * the SAME refusal as the unbounded case rather than trading one server error
 * for a less legible one.
 */
const TOO_WIDE_TABLE = 'os11374_too_wide';
const tooWideObject = () => ({
  name: TOO_WIDE_TABLE,
  fields: { token: { type: 'text', maxLength: 1024 } },
  indexes: [{ fields: ['token'], unique: true }],
});

/**
 * The same two shapes with a NON-UNIQUE index, which is what still lands in the
 * named refusal after #11627.
 *
 * ⚠️ Why this file grew these: the two objects above declare UNIQUE indexes, and
 * #11627 made a UNIQUE index over an unkeyable column expressible — it is now
 * carried on a hash-shadow column instead of being refused. That is a ruled
 * behaviour change (maintainer, 2026-08-24 on #11374), so the assertions that
 * pinned "unkeyable ⇒ refused" for those objects were pinning a branch that no
 * longer exists for them, and were rewritten rather than deleted or silenced.
 * The refusal itself is NOT gone — it is the disposition for a NON-UNIQUE
 * unkeyable index, where a digest would serve no lookup — so the half of this
 * file that proves the driver never weakens a constraint keeps a live subject.
 */
const UNBOUNDED_NONUNIQUE_TABLE = 'os11374_unbounded_nonuniq';
const unboundedNonUniqueObject = () => ({
  name: UNBOUNDED_NONUNIQUE_TABLE,
  fields: { token: { type: 'text' } },
  indexes: [{ fields: ['token'], unique: false }],
});

const TOO_WIDE_NONUNIQUE_TABLE = 'os11374_too_wide_nonuniq';
const tooWideNonUniqueObject = () => ({
  name: TOO_WIDE_NONUNIQUE_TABLE,
  fields: { token: { type: 'text', maxLength: 1024 } },
  indexes: [{ fields: ['token'], unique: false }],
});

// ── The emission rule, on a dialect every runner has ────────────────────────

describe('keyed text columns take their declared maxLength (#11374)', () => {
  let driver: SqlDriver;

  afterEach(async () => {
    await driver?.disconnect().catch(() => {});
  });

  it('emits varchar(maxLength) for a keyed bounded field and TEXT for the rest', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([boundedObject()]);
    const info: Record<string, { type?: string; maxLength?: number | string }> =
      await (driver as any).knex(BOUNDED_TABLE).columnInfo();

    // SQLite reports the declared type verbatim, which is what we are pinning:
    // the DDL the driver ASKED for, independent of any dialect's enforcement.
    expect(String(info.slug?.type).toLowerCase()).toContain('varchar');
    expect(String(info.slug?.maxLength ?? '')).toBe('64');
    expect(String(info.locale?.type).toLowerCase()).toContain('varchar');
    expect(String(info.locale?.maxLength ?? '')).toBe('16');

    // The two unkeyed columns are untouched by the rule — a bound is emitted
    // because an INDEX needs it, never merely because a field declared one.
    expect(String(info.body?.type).toLowerCase()).toBe('text');
    expect(String(info.notes?.type).toLowerCase()).toBe('text');
  });

  it('leaves a keyed field TEXT when it declares no usable bound', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([unboundedObject(), tooWideObject()]);
    const unbounded: any = await (driver as any).knex(UNBOUNDED_TABLE).columnInfo();
    const tooWide: any = await (driver as any).knex(TOO_WIDE_TABLE).columnInfo();
    expect(String(unbounded.token?.type).toLowerCase()).toBe('text');
    // Bounded, but past the key ceiling: a `varchar(1024)` column would only
    // swap `ER_BLOB_KEY_WITHOUT_LENGTH` for `ER_TOO_LONG_KEY` on MySQL.
    expect(String(tooWide.token?.type).toLowerCase()).toBe('text');
  });
});

// ── The half only a live MySQL can measure ──────────────────────────────────

declareDialectCell(MYSQL_CELL, 'keyed text columns (#11374)', (cell) => {
  describe('keyed text columns on live MySQL (#11374)', () => {
    let driver: SqlDriver;

    afterEach(async () => {
      for (const t of [BOUNDED_TABLE, UNBOUNDED_TABLE, TOO_WIDE_TABLE, 'os11374_prefix',
        UNBOUNDED_NONUNIQUE_TABLE, TOO_WIDE_NONUNIQUE_TABLE]) {
        await driver?.execute(`drop table if exists ${t}`).catch(() => {});
      }
      await driver?.disconnect().catch(() => {});
    });

    it('creates the declared indexes — the whole defect, in one assertion', async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${BOUNDED_TABLE}`).catch(() => {});

      // Pre-fix this REJECTED with `ER_BLOB_KEY_WITHOUT_LENGTH`, leaving the
      // table on disk without either index.
      await driver.initObjects([boundedObject()]);

      const types = await columnTypes(driver, BOUNDED_TABLE);
      expect(types.slug).toBe('varchar(64)');
      expect(types.locale).toBe('varchar(16)');
      expect(types.body).toBe('text');
      expect(types.notes).toBe('text');

      // Presence is the only proof: the sync degrades some index failures into
      // a log rather than a throw, so "initObjects resolved" is not evidence.
      const indexes = await indexNames(driver, BOUNDED_TABLE);
      expect(indexes).toContain('uniq_os11374_bounded_slug');
      expect(indexes).toContain('idx_os11374_bounded_slug_locale');

      // And it is a REAL unique over the whole value, not a prefix: MySQL
      // reports `sub_part` on a prefixed key part, and null on a full one.
      const [{ SUB_PART: subPart }] = (await rowsOf(
        driver,
        `select sub_part as SUB_PART from information_schema.statistics
          where table_schema = database() and table_name = ? and index_name = ?`,
        [BOUNDED_TABLE, 'uniq_os11374_bounded_slug'],
      )) as any[];
      expect(subPart ?? null).toBeNull();
    });

    it('refuses a NON-UNIQUE unkeyable column by name instead of weakening it', async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${UNBOUNDED_NONUNIQUE_TABLE}`).catch(() => {});

      // Loud, and specifically loud: the raw server error names a column in a
      // table that was just created successfully, which reads as an index
      // quirk rather than an object whose declared index is now absent.
      await expect(driver.initObjects([unboundedNonUniqueObject()])).rejects.toThrow(
        /cannot create index 'idx_os11374_unbounded_nonuniq_token'.*declares no `maxLength`/s,
      );

      // ⛔ The negative half, and the point of the whole disposition: no index
      // was substituted. A prefix index here would have made `initObjects`
      // resolve and left an index that means something else. #11627 did NOT
      // relax this — a hash shadow is offered only to a UNIQUE index, because
      // a digest serves no lookup an ordinary index exists to accelerate.
      expect(await indexNames(driver, UNBOUNDED_NONUNIQUE_TABLE)).toEqual([]);
    });

    it('gives a NON-UNIQUE bound past the key ceiling the same named refusal', async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TOO_WIDE_NONUNIQUE_TABLE}`).catch(() => {});
      await expect(driver.initObjects([tooWideNonUniqueObject()])).rejects.toThrow(
        /cannot create index 'idx_os11374_too_wide_nonuniq_token'.*wider than 768 characters/s,
      );
      expect(await indexNames(driver, TOO_WIDE_NONUNIQUE_TABLE)).toEqual([]);
    });

    /**
     * The UNIQUE half of the same two shapes, after #11627: expressible, and
     * expressed WITHOUT the prefix index this file exists to rule out.
     *
     * This is the assertion that replaced the two refusal pins above for the
     * unique case. It deliberately re-checks `sub_part`, the same discriminator
     * the bounded case uses: the constraint moving onto a shadow column must
     * not quietly become the prefix constraint the ruling rejected.
     */
    it('carries the UNIQUE cases on a hash shadow, still never a prefix index', async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${UNBOUNDED_TABLE}`).catch(() => {});
      await driver.execute(`drop table if exists ${TOO_WIDE_TABLE}`).catch(() => {});

      await driver.initObjects([unboundedObject(), tooWideObject()]);

      for (const [table, index] of [
        [UNBOUNDED_TABLE, 'uniq_os11374_unbounded_token'],
        [TOO_WIDE_TABLE, 'uniq_os11374_too_wide_token'],
      ] as const) {
        expect(await indexNames(driver, table)).toContain(index);
        const rows = (await rowsOf(
          driver,
          `select sub_part as SUB_PART, column_name as COLUMN_NAME, non_unique as NON_UNIQUE
             from information_schema.statistics
            where table_schema = database() and table_name = ? and index_name = ?`,
          [table, index],
        )) as any[];
        expect(rows.length).toBe(1);
        // Whole key part, not a prefix — the rejected route reports a sub_part.
        expect(rows[0].SUB_PART ?? null).toBeNull();
        expect(Number(rows[0].NON_UNIQUE)).toBe(0);
        expect(String(rows[0].COLUMN_NAME)).toContain('__hash');
      }
    });

    /**
     * The measurement that DISQUALIFIED the prefix-index route, kept executable
     * so it cannot be re-argued from intuition.
     *
     * A prefix index is a transparent access-path choice on an ORDINARY index —
     * MySQL narrows with it and rechecks the full value. On a UNIQUE index it is
     * not: the constraint becomes uniqueness of the PREFIX, which is *stricter*
     * than the one the object declared. The failure direction is the surprise —
     * not "two duplicates slip through" but "two genuinely different values are
     * rejected as duplicates". On `sys_session.token` that is a valid sign-in
     * refused with a duplicate-key error.
     */
    it('MEASUREMENT: a prefix-unique index rejects two DIFFERENT values sharing the prefix', async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists os11374_prefix`).catch(() => {});
      await driver.execute(
        `create table os11374_prefix (
           id varchar(64) not null primary key,
           token text,
           unique key uniq_prefix (token(191))
         )`,
      );

      const shared = 'A'.repeat(191);
      const first = `${shared}ZZZZ-tenant-alpha`;
      const second = `${shared}QQQQ-tenant-beta`;
      expect(first).not.toBe(second);

      await driver.execute(`insert into os11374_prefix (id, token) values (?, ?)`, [
        'r1',
        first,
      ] as any);

      await expect(
        driver.execute(`insert into os11374_prefix (id, token) values (?, ?)`, [
          'r2',
          second,
        ] as any),
      ).rejects.toThrow(/Duplicate entry/i);

      // One row, from two distinct tokens: the second was lost to a constraint
      // the object never declared.
      const [{ N: n }] = (await rowsOf(
        driver,
        `select count(*) as N from os11374_prefix`,
      )) as any[];
      expect(Number(n)).toBe(1);
    });
  });
});

async function rowsOf(driver: SqlDriver, sql: string, bindings: unknown[] = []): Promise<unknown[]> {
  const res: any = await driver.execute(sql, bindings as any);
  if (Array.isArray(res) && Array.isArray(res[0])) return res[0];
  return Array.isArray(res) ? res : (res?.rows ?? []);
}

/** `column_type` (with length), lower-cased — `varchar(64)`, `text`. */
async function columnTypes(driver: SqlDriver, table: string): Promise<Record<string, string>> {
  const rows = await rowsOf(
    driver,
    `select column_name, column_type from information_schema.columns
      where table_schema = database() and table_name = ?`,
    [table],
  );
  const out: Record<string, string> = {};
  for (const r of rows as any[]) {
    out[String(r.COLUMN_NAME ?? r.column_name)] = String(
      r.COLUMN_TYPE ?? r.column_type,
    ).toLowerCase();
  }
  return out;
}

/** Non-PRIMARY index names physically present on the table. */
async function indexNames(driver: SqlDriver, table: string): Promise<string[]> {
  const rows = await rowsOf(
    driver,
    `select distinct index_name from information_schema.statistics
      where table_schema = database() and table_name = ? and index_name <> 'PRIMARY'`,
    [table],
  );
  return (rows as any[]).map((r) => String(r.INDEX_NAME ?? r.index_name)).sort();
}
