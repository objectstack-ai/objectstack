// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11627 — the hash-shadow key: carrying a declared UNIQUE index MySQL cannot
 * express over the values themselves.
 *
 * ## The defect
 *
 * On utf8mb4 InnoDB a key part holds at most 3072 bytes (768 characters), so a
 * full-value UNIQUE index over a longer column is INEXPRESSIBLE. Measured on
 * live MySQL 8.0.46 across every exported platform object: 7 of 44 failed
 * `syncSchema` outright (6 `ER_BLOB_KEY_WITHOUT_LENGTH` + 1 `ER_TOO_LONG_KEY`);
 * Postgres 16.13 took all 44. An OAuth access token may legitimately be a
 * multi-KB JWT, so no declared bound can rescue those columns.
 *
 * ## Why a shadow and not a prefix index
 *
 * The maintainer's 2026-08-24 ruling on #11374 chose the hash route and
 * rejected prefix-unique indexes, on measurement: `UNIQUE KEY (token(191))`
 * enforces uniqueness over the PREFIX, so two genuinely distinct tokens that
 * share their first 191 characters collide and the second is refused as
 * `ER_DUP_ENTRY` — on `sys_session.token`, a valid sign-in refused as a
 * duplicate. The prefix-collision test below is the executable form of that
 * distinction: it is the assertion a prefix index would fail.
 *
 * ## What the live cell reads, and what it deliberately does NOT read
 *
 * Every physical claim here is read from `information_schema` in a SEPARATE
 * query — never from the DDL this driver emitted. The emitted DDL is this
 * change's own output; asserting on it would prove only that the driver said
 * what it said. `SUB_PART IS NULL` is the load-bearing one: it is what
 * distinguishes the shadow index from the rejected prefix index, which would
 * report a sub-part.
 *
 * Opt-in, like every live cell in this package:
 *
 *   OS_TEST_MYSQL_URL=mysql://root:root@127.0.0.1:3306/conformance \
 *     pnpm --filter @objectstack/driver-sql test
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { SqlDriver } from '../src/index.js';
import { isHashShadowColumn, HASH_SHADOW_SUFFIX } from './schema-drift.js';
import { MYSQL_CELL, PG_CELL, dialectCell, declareDialectCell } from './live-dialect-matrix.testkit.js';

/** An object with one bounded text field carrying a UNIQUE index over it. */
const uniqueOn = (name: string, maxLength: number | undefined) => ({
  name,
  fields: { v: { type: 'text', ...(maxLength === undefined ? {} : { maxLength }) } },
  indexes: [{ fields: ['v'], unique: true, name: `uniq_${name}_v` }],
});

// ── Dialect-free: the naming contract the differ and the driver share ───────

describe('hash-shadow column naming (#11627)', () => {
  /**
   * The differ and the driver must agree on what a shadow column IS, or the
   * orphan pass proposes dropping the column that carries a live UNIQUE
   * constraint. Two modules, one predicate — asserted here rather than trusted.
   */
  it('is recognised as driver-owned by the drift differ', () => {
    const shadow = (SqlDriver as any).hashShadowColumnFor('uniq_sys_oauth_access_token_token');
    expect(shadow).toBe(`uniq_sys_oauth_access_token_token${HASH_SHADOW_SUFFIX}`);
    expect(isHashShadowColumn(shadow)).toBe(true);
    expect(isHashShadowColumn('token')).toBe(false);
  });

  /**
   * MySQL identifiers cap at 64 characters, and the shadow name is derived from
   * an index name that is itself derived from table + columns. Truncation alone
   * would alias two long index names sharing a prefix onto ONE column — a
   * second constraint silently landing on the first one's shadow. The digest
   * is what makes the overflow branch injective.
   */
  it('stays inside MySQL 64-char identifiers without aliasing long names', () => {
    const a = 'uniq_' + 'x'.repeat(70) + '_alpha';
    const b = 'uniq_' + 'x'.repeat(70) + '_beta';
    const sa = (SqlDriver as any).hashShadowColumnFor(a);
    const sb = (SqlDriver as any).hashShadowColumnFor(b);
    expect(sa.length).toBeLessThanOrEqual(64);
    expect(sb.length).toBeLessThanOrEqual(64);
    expect(sa).not.toBe(sb);
    expect(isHashShadowColumn(sa)).toBe(true);
  });
});

// ── The dialects that never refuse must be untouched ────────────────────────

describe('dialects with no key-length ceiling are unchanged (#11627)', () => {
  let driver: SqlDriver;
  afterEach(async () => { await driver?.disconnect().catch(() => {}); });

  /**
   * ⛔ The negative half, and the reason "MySQL syncs now" is not this file's
   * whole assertion. The shadow is selected BY THE SERVER'S ERROR CODE, not by
   * a dialect getter, so a dialect that takes the direct index must keep it and
   * gain no column. A change that applied the shadow everywhere would pass
   * every positive assertion in this file and fail exactly here.
   */
  it('SQLite keeps the direct index and grows no shadow column', async () => {
    driver = new SqlDriver(dialectCell('sqlite').config());
    await driver.initObjects([uniqueOn('os11627_sqlite', 4096)]);
    const info = await (driver as any).knex('os11627_sqlite').columnInfo();
    expect(Object.keys(info)).toContain('v');
    expect(Object.keys(info).filter((c) => isHashShadowColumn(c))).toEqual([]);
  });
});

// ── Live MySQL: the accept transition, the boundary, and the semantics ──────

declareDialectCell(MYSQL_CELL, 'hash-shadow key (#11627)', (cell) => {
  describe('hash-shadow key on live MySQL (#11627)', () => {
    let driver: SqlDriver;
    afterEach(async () => { await driver?.disconnect().catch(() => {}); });

    /** Physical truth, read back from the catalog rather than from our DDL. */
    const catalog = async (table: string) => {
      const knex = (driver as any).knex;
      const cols = await knex
        .select('COLUMN_NAME', 'DATA_TYPE', 'CHARACTER_MAXIMUM_LENGTH', 'EXTRA', 'GENERATION_EXPRESSION')
        .from('information_schema.COLUMNS')
        .where({ TABLE_SCHEMA: knex.client.database(), TABLE_NAME: table });
      const idx = await knex
        .select('INDEX_NAME', 'NON_UNIQUE', 'COLUMN_NAME', 'SUB_PART')
        .from('information_schema.STATISTICS')
        .where({ TABLE_SCHEMA: knex.client.database(), TABLE_NAME: table });
      return { cols, idx };
    };

    /**
     * The accept transition: schema creation MySQL REFUSED before this change
     * now succeeds, and the constraint is carried on a full-width digest.
     */
    it('creates a UNIQUE index over a 1024-char column, on a varbinary(32) shadow', async () => {
      driver = new SqlDriver(cell.config());
      await driver.initObjects([uniqueOn('os11627_wide', 1024)]);

      const { cols, idx } = await catalog('os11627_wide');
      const shadow = cols.find((c: any) => isHashShadowColumn(c.COLUMN_NAME));
      expect(shadow, 'a shadow column must exist').toBeTruthy();
      // The DIGEST WIDTH ACTUALLY STORED — the number the collision bound is
      // computed over. 32 bytes is the FULL SHA-256, deliberately untruncated.
      expect(shadow.DATA_TYPE).toBe('varbinary');
      expect(Number(shadow.CHARACTER_MAXIMUM_LENGTH)).toBe(32);
      expect(String(shadow.EXTRA)).toContain('STORED GENERATED');
      expect(String(shadow.GENERATION_EXPRESSION).toLowerCase()).toContain('sha2');

      // The source column keeps its declared shape: nothing was narrowed to
      // make it keyable, which is the whole point of not using a bound here.
      expect(String(cols.find((c: any) => c.COLUMN_NAME === 'v').DATA_TYPE)).toBe('text');

      const carried = idx.filter((i: any) => isHashShadowColumn(i.COLUMN_NAME));
      expect(carried.length).toBe(1);
      expect(Number(carried[0].NON_UNIQUE)).toBe(0); // genuinely UNIQUE
      // ⛔ The control that separates this from the REJECTED route: a prefix
      // index reports a SUB_PART. The shadow index keys a whole column.
      expect(carried[0].SUB_PART).toBeNull();
    });

    /**
     * The boundary, both sides, read from the catalog: 768 characters is the
     * last width MySQL keys directly (768 x 4 = 3072 bytes exactly), and 769 is
     * the first that needs the shadow. Asserting only the wide case would pass
     * for an implementation that shadowed EVERYTHING.
     */
    it('switches to the shadow at exactly MAX_KEYABLE_VARCHAR_CHARS + 1', async () => {
      driver = new SqlDriver(cell.config());
      await driver.initObjects([uniqueOn('os11627_at', 768), uniqueOn('os11627_over', 769)]);

      const at = await catalog('os11627_at');
      expect(String(at.cols.find((c: any) => c.COLUMN_NAME === 'v').DATA_TYPE)).toBe('varchar');
      expect(at.cols.filter((c: any) => isHashShadowColumn(c.COLUMN_NAME))).toEqual([]);
      expect(at.idx.some((i: any) => i.COLUMN_NAME === 'v' && Number(i.NON_UNIQUE) === 0)).toBe(true);

      const over = await catalog('os11627_over');
      expect(String(over.cols.find((c: any) => c.COLUMN_NAME === 'v').DATA_TYPE)).toBe('text');
      expect(over.cols.filter((c: any) => isHashShadowColumn(c.COLUMN_NAME)).length).toBe(1);
    });

    /**
     * ⛔ The assertion a PREFIX index fails. Two distinct values sharing their
     * first 191 characters must BOTH be accepted — this is the measured
     * behaviour that got prefix-unique rejected by the ruling.
     */
    it('accepts distinct values that share a long prefix, and still rejects real duplicates', async () => {
      driver = new SqlDriver(cell.config());
      await driver.initObjects([uniqueOn('os11627_sem', 1024)]);
      const knex = (driver as any).knex;

      const shared = 'x'.repeat(191);
      await knex('os11627_sem').insert({ id: 'a', v: `${shared}AAA` });
      await knex('os11627_sem').insert({ id: 'b', v: `${shared}BBB` });
      expect((await knex('os11627_sem').whereIn('id', ['a', 'b'])).length).toBe(2);

      // A multi-KB JWT — the value shape that made a bound indefensible.
      await knex('os11627_sem').insert({ id: 'jwt', v: 'J'.repeat(4000) });

      // …and the constraint is real: the same value twice is refused.
      await expect(knex('os11627_sem').insert({ id: 'dup', v: `${shared}AAA` })).rejects.toThrow();
    });

    /**
     * NULL must stay DISTINCT, exactly as under a direct UNIQUE index.
     * `SHA2(NULL)` is NULL, so the shadow is NULL and MySQL does not collide
     * NULLs. Had the expression coalesced NULL to a string, every NULL row
     * would hash identically and the second one would be refused — a silent
     * tightening of the declared constraint.
     */
    it('keeps NULLs distinct, as a direct UNIQUE index would', async () => {
      driver = new SqlDriver(cell.config());
      await driver.initObjects([uniqueOn('os11627_null', 1024)]);
      const knex = (driver as any).knex;
      await knex('os11627_null').insert([{ id: 'n1', v: null }, { id: 'n2', v: null }, { id: 'n3', v: null }]);
      expect((await knex('os11627_null').whereNull('v')).length).toBe(3);
    });

    /**
     * A COMPOSITE unique hashes the tuple, and a tuple containing NULL must
     * conflict with nothing — MySQL's own composite-UNIQUE semantics. `CONCAT`
     * returning NULL for any NULL argument is what delivers that; `CONCAT_WS`
     * would have skipped the NULL and made two different tuples collide.
     */
    it('hashes a composite tuple, keeps any-NULL tuples non-conflicting, and stays injective', async () => {
      driver = new SqlDriver(cell.config());
      const composite = {
        name: 'os11627_comp',
        fields: { a: { type: 'text', maxLength: 1024 }, b: { type: 'text', maxLength: 1024 } },
        indexes: [{ fields: ['a', 'b'], unique: true, name: 'uniq_os11627_comp_ab' }],
      };
      await driver.initObjects([composite]);
      const knex = (driver as any).knex;

      await knex('os11627_comp').insert([{ id: '1', a: 'x', b: 'y' }, { id: '2', a: 'x', b: 'yy' }]);
      // Two rows with a NULL component must coexist.
      await knex('os11627_comp').insert([{ id: 'n1', a: 'x', b: null }, { id: 'n2', a: 'x', b: null }]);
      expect((await knex('os11627_comp').whereNull('b')).length).toBe(2);
      // Separator injectivity: ('xy','') and ('x','y') are different tuples.
      await knex('os11627_comp').insert([{ id: 's1', a: 'xy', b: '' }, { id: 's2', a: 'x', b: 'y2' }]);
      // …and the composite constraint still bites.
      await expect(knex('os11627_comp').insert({ id: 'dup', a: 'x', b: 'y' })).rejects.toThrow();
    });

    /**
     * The digest stored is the one this repo can independently recompute — the
     * check that the constraint is over SHA-256 of the value and not over some
     * server-side variant of it.
     */
    it('stores the full SHA-256 of the value, byte for byte', async () => {
      driver = new SqlDriver(cell.config());
      await driver.initObjects([uniqueOn('os11627_digest', 1024)]);
      const knex = (driver as any).knex;
      const value = 'token-' + 'z'.repeat(900);
      await knex('os11627_digest').insert({ id: 'd', v: value });
      const shadowCol = (SqlDriver as any).hashShadowColumnFor('uniq_os11627_digest_v');
      const [row] = await knex('os11627_digest').select(shadowCol).where({ id: 'd' });
      const stored: Buffer = row[shadowCol];
      expect(stored.length).toBe(32);
      expect(stored.toString('hex')).toBe(createHash('sha256').update(value).digest('hex'));
    });

    /**
     * ⛔ NON-UNIQUE indexes are deliberately NOT shadowed. An index over a
     * digest serves no lookup the planner can reach for `WHERE col = ?`, so
     * creating one would trade a loud refusal for a table that syncs, costs
     * writes on every row, and accelerates nothing. This asserts the refusal is
     * still a refusal — the scope limit is a decision, not an omission.
     */
    it('leaves a non-unique unkeyable index refused rather than shadowing it', async () => {
      driver = new SqlDriver(cell.config());
      const nonUnique = {
        name: 'os11627_nonuniq',
        fields: { v: { type: 'text', maxLength: 1024 } },
        indexes: [{ fields: ['v'], unique: false, name: 'idx_os11627_nonuniq_v' }],
      };
      await expect(driver.initObjects([nonUnique])).rejects.toThrow(
        /hash-shadow|cannot create index|BLOB\/TEXT/i,
      );
    });
  });
});

// ── Postgres is the control: it never refused, so nothing may change ────────

declareDialectCell(PG_CELL, 'hash-shadow key (#11627)', (cell) => {
  describe('Postgres control (#11627)', () => {
    let driver: SqlDriver;
    afterEach(async () => { await driver?.disconnect().catch(() => {}); });

    /**
     * Postgres took all 44 platform objects before this change and must take
     * them after, with its physical schema byte-identical — no shadow column,
     * and the UNIQUE index still on the value itself. This is the assertion
     * that catches a change which "fixed MySQL" by degrading everyone.
     */
    it('keeps the direct UNIQUE index on the value and grows no shadow column', async () => {
      driver = new SqlDriver(cell.config());
      await driver.initObjects([uniqueOn('os11627_pg', 1024)]);
      const knex = (driver as any).knex;
      const cols = await knex
        .select('column_name')
        .from('information_schema.columns')
        .where({ table_name: 'os11627_pg' });
      expect(cols.map((c: any) => c.column_name).filter((c: string) => isHashShadowColumn(c))).toEqual([]);
      const idx = await knex.raw(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'os11627_pg'`,
      );
      const defs = (idx.rows ?? []).map((r: any) => String(r.indexdef)).join('\n');
      expect(defs).toMatch(/UNIQUE INDEX .*uniq_os11627_pg_v.*\(v\)/i);
    });
  });
});
