// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11324] `introspectForeignKeys`' Postgres arm must correlate its joins on
 * the CONSTRAINT and on the KEY ORDINAL — not on the parent's schema, and not
 * on nothing at all.
 *
 * Two independent defects in one three-view join, both measured on live
 * PostgreSQL 16.13 against the query as it stood after #11201:
 *
 *  1. `ccu.table_schema = tc.table_schema` demanded parent and child share a
 *     schema. `constraint_column_usage` describes the REFERENCED side of a
 *     foreign key — that is why the projection aliases it `referenced_table` —
 *     so its `table_schema` is the PARENT's. A foreign key pointing at another
 *     schema contributed **0 rows** and the table reported having none.
 *  2. The `kcu` ↔ `ccu` join carried no ordinal correlation, so a 2-column key
 *     came back as **4 rows**, the cartesian product of child columns with
 *     parent columns.
 *
 * Both are silent WRONG ANSWERS rather than failures. `[]` reads downstream as
 * *this table has no foreign keys* (the #7332 shape), and the phantom pairs of
 * defect 2 are indistinguishable from the real ones because
 * `IntrospectedForeignKey` is a flat per-column record. Federated-object
 * codegen, the persisted `external_catalog` (ADR-0015) and schema-drift
 * comparison all consume the answer as fact.
 *
 * ## Why every assertion here is preceded by a control
 *
 * Both defects are SHAPE defects, so both fixed shapes are things a fixture can
 * produce by accident: "the cross-schema key is present" goes green for free if
 * the parent was never actually put in another schema, and "exactly 2 records"
 * goes green for free if the composite key was never actually declared over two
 * columns. So each case first re-issues the **pre-fix query verbatim** and
 * requires it to still exhibit the defect — 0 rows for the cross-schema
 * fixture, 4 cartesian rows for the composite one. If a control ever goes
 * green, the fixture stopped reproducing the defect and the assertion beside it
 * is measuring nothing; the control says exactly that in its message.
 *
 * ## Why this file is PG-only
 *
 * Neither defect is expressible on the other two arms. SQLite has no schemas
 * and `PRAGMA foreign_key_list` already reports one row per key column with
 * both sides on it; MySQL's `KEY_COLUMN_USAGE` likewise carries `COLUMN_NAME`
 * and `REFERENCED_COLUMN_NAME` on ONE row, so there is no cross-view join to
 * correlate. The cell list is therefore exactly `pg`, declared through
 * `declareDialectCell` so an unprovisioned run is a NAMED skip (and a red under
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1`), never a silent pass.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '../src/index.js';
import {
  PG_CELL,
  currentLiveSchema,
  declareDialectCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

const MATRIX = 'introspectForeignKeys join correlations';

/** Defect 1 fixture: the child, in this file's own schema. */
const CROSS_CHILD = 'os11324_cross_child';
/** Defect 1 fixture: the parent, deliberately NOT in this file's schema. */
const REMOTE_PARENT = 'os11324_remote_parent';
const FK_CROSS = 'os11324_fk_cross';

/** Defect 2 fixture: a 2-column composite key, declared in column sequence. */
const COMP_PARENT = 'os11324_comp_parent';
const COMP_CHILD = 'os11324_comp_child';
const FK_COMP = 'os11324_fk_comp';

/**
 * Defect 2 fixture, second shape: a composite key declared OUT of column
 * sequence, so "key order" and "column order" are different answers.
 */
const OOO_PARENT = 'os11324_ooo_parent';
const OOO_CHILD = 'os11324_ooo_child';
const FK_OOO = 'os11324_fk_ooo';

/**
 * The Postgres arm's query EXACTLY as it stood before this fix, used as the
 * non-vacuity control for both cases. Kept verbatim (including the join
 * predicates that are the defect) rather than paraphrased: a paraphrase could
 * stop reproducing the defect without anybody noticing, which is the one thing
 * a control must not be able to do.
 */
const PRE_FIX_QUERY = `
  SELECT
    kcu.column_name,
    ccu.table_name AS referenced_table,
    ccu.column_name AS referenced_column,
    tc.constraint_name
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = ?
    AND tc.table_schema = ANY (current_schemas(false))
`;

/** `introspectForeignKeys` is `protected`; this is the narrowest way to reach it. */
class ForeignKeyProbeDriver extends SqlDriver {
  foreignKeys(table: string) {
    return this.introspectForeignKeys(table);
  }
}

function declareJoinCorrelationSuite(cell: DialectCell): void {
  describe(`introspectForeignKeys join correlations — ${cell.label} (#11324)`, () => {
    let driver: ForeignKeyProbeDriver;
    /** This file's own schema (#9350) — the only one on `search_path`. */
    let here: string;
    /** Where the cross-schema parent lives. Created by this file, dropped by it. */
    let far: string;

    beforeAll(async () => {
      driver = new ForeignKeyProbeDriver(cell.config());
      here = currentLiveSchema();
      far = `${here}_far`;
      // Postgres TRUNCATES an over-long identifier silently, which would fold
      // the far schema back onto this file's own and delete the cross-schema
      // condition this suite exists to measure.
      expect(
        far.length,
        `the parent schema name ${far} exceeds Postgres' 63-byte identifier limit and would be ` +
          `silently truncated onto ${here} — shorten the suffix`,
      ).toBeLessThanOrEqual(63);

      await driver.execute(`drop schema if exists "${far}" cascade`);
      await driver.execute(`create schema "${far}"`);

      // Defect 1: parent next door, child here. Only `here` is on `search_path`
      // (the cell's config puts exactly this schema there), and the parent is
      // reached by an explicitly qualified name — so nothing about the fixture
      // depends on the session resolving the far schema.
      await driver.execute(`drop table if exists ${CROSS_CHILD} cascade`);
      await driver.execute(`create table "${far}".${REMOTE_PARENT} (id varchar(64) primary key)`);
      await driver.execute(
        `create table ${CROSS_CHILD} (
           id varchar(64) primary key,
           p varchar(64),
           constraint ${FK_CROSS} foreign key (p) references "${far}".${REMOTE_PARENT} (id)
         )`,
      );

      // Defect 2, in column sequence: (x, y) -> (a, b).
      await driver.execute(`drop table if exists ${COMP_CHILD} cascade`);
      await driver.execute(`drop table if exists ${COMP_PARENT} cascade`);
      await driver.execute(
        `create table ${COMP_PARENT} (a varchar(64), b varchar(64), primary key (a, b))`,
      );
      await driver.execute(
        `create table ${COMP_CHILD} (
           id varchar(64) primary key,
           x varchar(64),
           y varchar(64),
           constraint ${FK_COMP} foreign key (x, y) references ${COMP_PARENT} (a, b)
         )`,
      );

      // Defect 2, OUT of column sequence: the key is (second_col, first_col),
      // so reading the columns in `attnum` order gives a DIFFERENT answer than
      // reading them in key order. Without this shape, "the rows are in key
      // order" is satisfied by any query that happens to return column order.
      await driver.execute(`drop table if exists ${OOO_CHILD} cascade`);
      await driver.execute(`drop table if exists ${OOO_PARENT} cascade`);
      await driver.execute(
        `create table ${OOO_PARENT} (pa varchar(64), pb varchar(64), primary key (pa, pb))`,
      );
      await driver.execute(
        `create table ${OOO_CHILD} (
           id varchar(64) primary key,
           first_col varchar(64),
           second_col varchar(64),
           constraint ${FK_OOO} foreign key (second_col, first_col)
             references ${OOO_PARENT} (pa, pb)
         )`,
      );
    });

    afterAll(async () => {
      await driver.execute(`drop schema if exists "${far}" cascade`).catch(() => {});
      for (const t of [CROSS_CHILD, COMP_CHILD, COMP_PARENT, OOO_CHILD, OOO_PARENT]) {
        await driver.execute(`drop table if exists ${t} cascade`).catch(() => {});
      }
      await driver.disconnect().catch(() => {});
    });

    // ── Defect 1: a cross-schema target ──────────────────────────────────────

    it('control: the fixture really is cross-schema, and the PRE-FIX query drops it', async () => {
      // Part one — the two tables really are in different schemas. A `create
      // schema` that silently landed somewhere else, or a truncated identifier,
      // would leave a same-schema fixture that the OLD query answers correctly.
      const placed: any = await driver.execute(
        `select n.nspname, c.relname
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relname in (?, ?)
          order by c.relname`,
        [CROSS_CHILD, REMOTE_PARENT],
      );
      expect(
        placed.rows.map((r: any) => `${r.nspname}.${r.relname}`),
        `the cross-schema fixture collapsed into one schema — this suite would then be asserting ` +
          `a presence the OLD query also produces`,
      ).toEqual([`${here}.${CROSS_CHILD}`, `${far}.${REMOTE_PARENT}`]);

      // Part two — the constraint exists at all, read straight from the catalog
      // rather than through either query under test.
      const declared: any = await driver.execute(
        `select conname from pg_constraint where conname = ?`,
        [FK_CROSS],
      );
      expect(declared.rows.map((r: any) => r.conname)).toEqual([FK_CROSS]);

      // Part three — the pre-fix predicate, re-issued verbatim, still loses it.
      const preFix: any = await driver.execute(PRE_FIX_QUERY, [CROSS_CHILD]);
      expect(
        preFix.rows,
        `the pre-fix query no longer drops the cross-schema foreign key — the defect this file ` +
          `pins is not being reproduced, so the assertion below proves nothing`,
      ).toEqual([]);
    });

    it('returns a foreign key whose target lives in ANOTHER schema', async () => {
      const foreignKeys = await driver.foreignKeys(CROSS_CHILD);

      // `referencedSchema` is #11377's half of this answer: the parent is off
      // the session's `search_path`, so the (still bare) name arrives
      // qualified. Presence/absence semantics and their own controls are
      // pinned in `sql-driver-11377-introspect-fk-cross-schema-qualification`;
      // this file keeps owning the #11324 fact — the key is RETURNED at all.
      expect(
        foreignKeys,
        `${cell.label}: ${CROSS_CHILD} has a declared foreign key into ${far} and must not be ` +
          `reported as having none`,
      ).toEqual([
        {
          columnName: 'p',
          referencedTable: REMOTE_PARENT,
          referencedColumn: 'id',
          constraintName: FK_CROSS,
          referencedSchema: far,
        },
      ]);
    });

    it('carries the cross-schema key through `introspectSchema`, the in-tree consumer', async () => {
      // The call site at the top of this defect's blast radius: the whole-schema
      // read hangs these keys on the table it listed, and federated codegen,
      // `external_catalog` and drift comparison read them from there.
      const schema = await driver.introspectSchema();

      expect(Object.keys(schema.tables)).toContain(CROSS_CHILD);
      expect(schema.tables[CROSS_CHILD].foreignKeys).toEqual([
        {
          columnName: 'p',
          referencedTable: REMOTE_PARENT,
          referencedColumn: 'id',
          constraintName: FK_CROSS,
          // #11377: the off-path parent arrives qualified — see above.
          referencedSchema: far,
        },
      ]);
    });

    // ── Defect 2: a composite key ────────────────────────────────────────────

    it('control: the composite key is really 2 columns, and the PRE-FIX query returns 4 rows', async () => {
      // Part one — the constraint really spans two columns. A one-column
      // fixture would make "exactly 2 records" unreachable and "correctly
      // paired" trivial.
      const width: any = await driver.execute(
        `select array_length(conkey, 1) as n_child, array_length(confkey, 1) as n_parent
           from pg_constraint where conname = ?`,
        [FK_COMP],
      );
      expect(width.rows[0]).toMatchObject({ n_child: 2, n_parent: 2 });

      // Part two — the pre-fix predicate, re-issued verbatim, still returns the
      // cartesian product including the two phantom pairs.
      const preFix: any = await driver.execute(PRE_FIX_QUERY, [COMP_CHILD]);
      const pairs = preFix.rows
        .map((r: any) => `${r.column_name}->${r.referenced_table}.${r.referenced_column}`)
        .sort();
      expect(
        pairs,
        `the pre-fix query no longer returns the cartesian product for a 2-column key — the ` +
          `defect this file pins is not being reproduced`,
      ).toEqual([
        `x->${COMP_PARENT}.a`,
        `x->${COMP_PARENT}.b`,
        `y->${COMP_PARENT}.a`,
        `y->${COMP_PARENT}.b`,
      ]);
    });

    it('returns exactly 2 correctly-paired records for a 2-column key, not 4', async () => {
      const foreignKeys = await driver.foreignKeys(COMP_CHILD);

      // The exact array, not a `toContainEqual` pair: the defect ADDS rows, so
      // any assertion satisfied by a superset is satisfied by the defect too.
      expect(
        foreignKeys,
        `${cell.label}: (x, y) references ${COMP_PARENT} (a, b) is x->a and y->b — the two ` +
          `cross pairs are phantoms of an uncorrelated join`,
      ).toEqual([
        {
          columnName: 'x',
          referencedTable: COMP_PARENT,
          referencedColumn: 'a',
          constraintName: FK_COMP,
        },
        {
          columnName: 'y',
          referencedTable: COMP_PARENT,
          referencedColumn: 'b',
          constraintName: FK_COMP,
        },
      ]);

      // The pre-fix answer, named — so a future reader can see what red looked
      // like without re-deriving it.
      const pairs = foreignKeys.map((fk) => `${fk.columnName}->${fk.referencedColumn}`);
      expect(pairs).not.toContain('x->b');
      expect(pairs).not.toContain('y->a');
    });

    it('orders a composite key by KEY ordinal, not by column ordinal', async () => {
      // Control — the fixture's key order and column order really do disagree.
      // `first_col` sits before `second_col` in the table while the key is
      // declared `(second_col, first_col)`; if that ever stopped being true,
      // the assertion below would be satisfied by column order as well.
      const shape: any = await driver.execute(
        `select a.attname, a.attnum, k.ord
           from pg_constraint con
           cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
          where con.conname = ?
          order by a.attnum`,
        [FK_OOO],
      );
      expect(
        shape.rows.map((r: any) => `${r.attname}@col${r.attnum}/key${r.ord}`),
        `the out-of-sequence fixture is no longer out of sequence — key order and column order ` +
          `now agree, so this case cannot tell them apart`,
      ).toEqual(['first_col@col2/key2', 'second_col@col3/key1']);

      const foreignKeys = await driver.foreignKeys(OOO_CHILD);

      expect(
        foreignKeys,
        `${cell.label}: (second_col, first_col) references ${OOO_PARENT} (pa, pb) pairs ` +
          `second_col->pa and first_col->pb, in that order — column order would invert both`,
      ).toEqual([
        {
          columnName: 'second_col',
          referencedTable: OOO_PARENT,
          referencedColumn: 'pa',
          constraintName: FK_OOO,
        },
        {
          columnName: 'first_col',
          referencedTable: OOO_PARENT,
          referencedColumn: 'pb',
          constraintName: FK_OOO,
        },
      ]);
    });
  });
}

declareDialectCell(PG_CELL, MATRIX, declareJoinCorrelationSuite);
