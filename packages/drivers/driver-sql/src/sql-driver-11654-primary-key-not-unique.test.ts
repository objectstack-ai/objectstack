// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11654] A PRIMARY KEY is not a UNIQUE constraint to
 * `introspectUniqueConstraints` — on any dialect, and for any key type.
 *
 * This is the residual cell of the family #11202 opened. That change unified
 * the three arms on *single-column* uniqueness; it deliberately left the
 * primary-key question alone, because the flag it produced was not false, only
 * inconsistent — and its fixture carries no primary key at all, precisely so it
 * measured the composite-vs-single question and nothing else.
 *
 * ## The convention this inherits, and its reason
 *
 * `isUnique` means **a declared single-column UNIQUE constraint**. Primary-key
 * membership is already reported losslessly through a face of its own —
 * `IntrospectedTable.primaryKeys` and `IntrospectedColumn.primaryKey` — so
 * excluding keys from `isUnique` loses no information and leaves the two flags
 * non-overlapping. That is #11202's convention applied one cell over, not a new
 * decision, which is why this file pins the `primaryKeys` face as well: it is
 * the half that makes the exclusion lossless rather than merely narrower.
 *
 * ## What was measured before the fix (2026-08-24, embedded better-sqlite3)
 *
 * The catalogs disagreed. Postgres and MySQL filter on
 * `CONSTRAINT_TYPE = 'UNIQUE'`, which excludes primary keys outright. SQLite
 * iterated `PRAGMA index_list` keyed only on `idx.unique === 1`, never on
 * `origin` — and SQLite materialises a non-INTEGER primary key as a unique
 * auto-index:
 *
 * ```text
 * create table t_text (id varchar(64) primary key, email varchar(64) unique)
 *   PRAGMA index_list(t_text) ->
 *     { name: 'sqlite_autoindex_t_text_2', unique: 1, origin: 'u'  }
 *     { name: 'sqlite_autoindex_t_text_1', unique: 1, origin: 'pk' }
 *   introspectUniqueConstraints -> ['email', 'id']     <-- 'id' is the PRIMARY KEY
 *
 * create table t_int (id integer primary key, note varchar(64))
 *   PRAGMA index_list(t_int) -> []
 *   introspectUniqueConstraints -> []
 * ```
 *
 * So SQLite disagreed with the other two dialects AND with itself: an
 * `INTEGER PRIMARY KEY` is a rowid alias with no auto-index and was never
 * flagged, while a `varchar` key was — the same logical schema producing
 * different `isUnique` flags from the declared type of its key alone.
 *
 * ## The fix filters the INDEX by origin, not the COLUMN by key membership
 *
 * Those are different changes and only one is correct. A column that is the
 * primary key AND separately carries its own unique index really does have a
 * declared single-column unique constraint, and must stay flagged; dropping
 * every primary-key *column* would lose it. `t_pk_and_idx` below is that
 * distinction as a pin — it fails under the wrong sibling implementation and
 * passes under this one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'primary key is not a unique constraint';

/** A varchar primary key plus a real single-column `UNIQUE (email)`. */
const TABLE = 'os11654_pk';

/** `introspectUniqueConstraints` is `protected`; this is the narrowest reach. */
class UniqueProbeDriver extends SqlDriver {
  uniqueConstraints(table: string) {
    return this.introspectUniqueConstraints(table);
  }
}

// ── Half 1: every provisioned dialect answers the same ──────────────────────

function declarePrimaryKeyUniqueSuite(cell: DialectCell): void {
  describe(`introspectUniqueConstraints — a PRIMARY KEY is not unique — ${cell.label} (#11654)`, () => {
    let driver: UniqueProbeDriver;

    beforeAll(async () => {
      driver = new UniqueProbeDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      // A NON-INTEGER key on purpose: this is the shape SQLite materialises as
      // a unique auto-index, and therefore the only shape on which the three
      // dialects ever disagreed.
      await driver.execute(
        `create table ${TABLE} (
           id varchar(64) not null primary key,
           email varchar(64) not null unique,
           note varchar(64)
         )`,
      );
    });

    afterAll(async () => {
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.disconnect().catch(() => {});
    });

    it('the fixture is real: the key IS enforced and so is the UNIQUE column', async () => {
      // Non-vacuity, asserted against the server rather than the catalog. The
      // interesting assertion below is an ABSENCE, which goes green for free on
      // a table whose key never landed — so prove both constraints exist and
      // are enforced first. Note what this establishes: `id` really is unique
      // in the database. The flag's absence is a statement about what KIND of
      // constraint makes it so, not a claim that duplicates are allowed.
      await driver.execute(`insert into ${TABLE} (id, email) values ('k1', 'e1@example.com')`);

      // The key repeated — REJECTED, so the PRIMARY KEY is enforced.
      await expect(
        driver.execute(`insert into ${TABLE} (id, email) values ('k1', 'e2@example.com')`),
      ).rejects.toThrow();

      // `email` repeated — REJECTED, so the single-column UNIQUE exists too.
      await expect(
        driver.execute(`insert into ${TABLE} (id, email) values ('k2', 'e1@example.com')`),
      ).rejects.toThrow();
    });

    it('reports the UNIQUE column and NOT the primary-key column', async () => {
      const columns = await driver.uniqueConstraints(TABLE);

      expect(columns).toContain('email');
      expect(columns).not.toContain('id');
      expect(columns).not.toContain('note');
      // Exact, so a dialect that starts reporting something extra is caught
      // rather than absorbed by the `not.toContain`s above.
      expect(columns).toEqual(['email']);
    });

    it('`introspectSchema` folds that into `isUnique` — the consumer-visible half', async () => {
      const schema = await driver.introspectSchema();
      const table = schema.tables[TABLE];
      expect(table, `${TABLE} missing from the introspected schema`).toBeDefined();

      const byName = Object.fromEntries(table.columns.map((col) => [col.name, col]));
      expect(byName.email?.isUnique).toBe(true);
      // Falsy, not `false`: `isUnique` is only ever SET to `true`, so asserting
      // `false` would pin a shape the producer does not promise (#11202).
      expect(byName.id?.isUnique).toBeFalsy();
      expect(byName.note?.isUnique).toBeFalsy();
    });

    it('nothing is lost: the `primaryKeys` face still reports the key', async () => {
      // This is what makes the exclusion lossless rather than a narrowing that
      // drops information. A consumer asking "is this column the key?" has an
      // answer that did not move, on both faces.
      const schema = await driver.introspectSchema();
      const table = schema.tables[TABLE];
      expect(table.primaryKeys).toEqual(['id']);

      const byName = Object.fromEntries(table.columns.map((col) => [col.name, col]));
      expect(byName.id?.primaryKey).toBe(true);
      expect(byName.email?.primaryKey).toBeFalsy();
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, declarePrimaryKeyUniqueSuite);
}

// ── Half 2: the SQLite key shapes no other dialect can produce ──────────────

describe('SQLite key materialisation — every key shape answers the same (#11654)', () => {
  let driver: UniqueProbeDriver;

  beforeAll(async () => {
    driver = new UniqueProbeDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    // The card's two tables, verbatim.
    await driver.execute(`create table t_text (id varchar(64) primary key, email varchar(64) unique)`);
    await driver.execute(`create table t_int (id integer primary key, note varchar(64))`);
    // A WITHOUT ROWID table still materialises its key as a `pk`-origin index.
    await driver.execute(
      `create table t_worid (id varchar(64) primary key, email varchar(64) unique) without rowid`,
    );
    // Composite key: two members, so the #11202 width filter already dropped
    // it. Pinned so the origin filter is not credited with it, and so it stays
    // dropped if the width filter is ever reworked.
    await driver.execute(
      `create table t_comp (a varchar(64), b varchar(64), email varchar(64) unique, primary key (a, b))`,
    );
    // The key column ALSO carrying its own unique index (`origin: 'c'`).
    await driver.execute(`create table t_pk_and_idx (id varchar(64) primary key, note varchar(64))`);
    await driver.execute(`create unique index t_pk_and_idx_id_u on t_pk_and_idx (id)`);
  });

  afterAll(async () => {
    await driver.disconnect().catch(() => {});
  });

  it('PRAGMA index_list really reports origin `pk` for a varchar key', async () => {
    // Pins the premise the filter rests on. If SQLite ever stopped tagging the
    // auto-index, the filter would be dead code and should be re-read.
    const rows: any = await driver.execute(`PRAGMA index_list(t_text)`);
    const byOrigin = Object.fromEntries((rows as any[]).map((r) => [r.origin, r]));
    expect(byOrigin.pk, 'no pk-origin auto-index — the premise moved').toBeDefined();
    expect(byOrigin.pk.unique).toBe(1);
    expect(byOrigin.u, 'no u-origin index for UNIQUE(email)').toBeDefined();
  });

  it('an INTEGER key and a varchar key now agree — neither is flagged', async () => {
    // The self-inconsistency this card names: an INTEGER PRIMARY KEY is a rowid
    // alias with no auto-index and was never flagged, while a varchar key was.
    // The same logical schema must not answer differently by key type.
    expect(await driver.uniqueConstraints('t_text')).toEqual(['email']);
    expect(await driver.uniqueConstraints('t_int')).toEqual([]);
  });

  it('a WITHOUT ROWID key is not flagged either', async () => {
    expect(await driver.uniqueConstraints('t_worid')).toEqual(['email']);
  });

  it('a composite key contributes nothing, and its UNIQUE sibling survives', async () => {
    const columns = await driver.uniqueConstraints('t_comp');
    expect(columns).toEqual(['email']);
    expect(columns).not.toContain('a');
    expect(columns).not.toContain('b');
  });

  it('a key column with its OWN unique index stays flagged', async () => {
    // The filter drops pk-ORIGIN INDEXES, not primary-key COLUMNS. `id` here
    // carries a separately declared single-column unique constraint, which is
    // exactly what `isUnique` means — dropping it would be a different, wrong
    // change wearing the same description.
    expect(await driver.uniqueConstraints('t_pk_and_idx')).toEqual(['id']);
  });
});
