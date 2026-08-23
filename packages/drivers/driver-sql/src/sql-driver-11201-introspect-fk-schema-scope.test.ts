// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11201] `introspectForeignKeys` must answer for the table the SESSION
 * resolves — not for every same-named table in the database.
 *
 * The Postgres arm filtered `information_schema.table_constraints` on
 * `tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ?` with no
 * `table_schema` predicate at all. Those views span every schema the session
 * has privilege on, `search_path` notwithstanding, so a table name that exists
 * in more than one schema had all of their foreign keys merged into one answer.
 *
 * That is a WRONG answer, not a missing one, and it is consumed as fact:
 * `introspectSchema` hangs it on the table it just listed, and from there it
 * reaches federated-object codegen, the persisted `external_catalog`
 * (ADR-0015) and schema-drift comparison. The fix is the family's existing
 * pin — `AND tc.table_schema = ANY (current_schemas(false))`, the same one
 * `introspectSchema`'s table listing and `introspectUniqueConstraints` carry.
 *
 * ## Why the collision is realistic rather than contrived
 *
 * The live-dialect isolation (#9350) gives every test FILE in this package its
 * own schema inside ONE database. Same-named tables in sibling schemas are
 * therefore the normal state of a live-PG run here, not an edge case someone
 * has to construct — this file just makes the collision explicit so it can be
 * asserted on.
 *
 * ## Why this file is PG-only
 *
 * SQLite has no schemas, and the MySQL arm of this same method already pins
 * `TABLE_SCHEMA = DATABASE()` — the defect is not expressible on either, so
 * the cell list is exactly `pg`, declared through `declareDialectCell` so an
 * unprovisioned run is a NAMED skip (and a red under
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1`), never a silent pass.
 *
 * ## Why the fixture pins the catalog fact first
 *
 * The interesting assertion here is an ABSENCE — "the other schema's foreign
 * key is not in the answer" — and an absence goes green for free if the
 * fixture never created the collision (a `create schema` that silently landed
 * somewhere else, a DDL statement that did not run). So the first case
 * re-issues the pre-fix predicate verbatim and requires it to see BOTH
 * constraints. If that case ever goes green with one row, the rest of this
 * file is measuring nothing and says so.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '../src/index.js';
import {
  PG_CELL,
  currentLiveSchema,
  declareDialectCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

const MATRIX = 'introspectForeignKeys schema scoping';

/** The COLLIDING name — one in this file's own schema, one next door. */
const TABLE = 'os11201_orders';

/** The referenced table each side points at. Distinct, so the answer is attributable. */
const REF_HERE = 'os11201_ref_here';
const REF_THERE = 'os11201_ref_there';

/** Constraint names, likewise distinct — a PG constraint name is per-schema. */
const FK_HERE = 'os11201_fk_here';
const FK_THERE = 'os11201_fk_there';

/** `introspectForeignKeys` is `protected`; this is the narrowest way to reach it. */
class ForeignKeyProbeDriver extends SqlDriver {
  foreignKeys(table: string) {
    return this.introspectForeignKeys(table);
  }
}

function declareForeignKeyScopeSuite(cell: DialectCell): void {
  describe(`introspectForeignKeys schema scoping — ${cell.label} (#11201)`, () => {
    let driver: ForeignKeyProbeDriver;
    /** This file's own schema (#9350) — the only one on `search_path`. */
    let here: string;
    /** The neighbour. Created by this file, so it is dropped by this file. */
    let there: string;

    beforeAll(async () => {
      driver = new ForeignKeyProbeDriver(cell.config());
      here = currentLiveSchema();
      there = `${here}_alt`;
      // Postgres TRUNCATES an over-long identifier silently, which would fold
      // the neighbour back onto this file's own schema and quietly delete the
      // collision this suite exists to measure.
      expect(
        there.length,
        `the neighbour schema name ${there} exceeds Postgres' 63-byte identifier limit and would ` +
          `be silently truncated — shorten the suffix`,
      ).toBeLessThanOrEqual(63);

      await driver.execute(`drop schema if exists "${there}" cascade`);
      await driver.execute(`create schema "${there}"`);

      // This file's own schema: unqualified DDL lands here, because the cell's
      // config puts exactly this schema on `search_path`.
      await driver.execute(`drop table if exists ${TABLE} cascade`);
      await driver.execute(`drop table if exists ${REF_HERE} cascade`);
      await driver.execute(`create table ${REF_HERE} (id varchar(64) primary key)`);
      await driver.execute(
        `create table ${TABLE} (
           id varchar(64) primary key,
           here_ref varchar(64),
           constraint ${FK_HERE} foreign key (here_ref) references ${REF_HERE} (id)
         )`,
      );

      // The neighbour: same TABLE name, a different foreign key, and NOT on
      // `search_path`. Every name is schema-qualified so nothing depends on the
      // session's resolution while building it.
      await driver.execute(`create table "${there}".${REF_THERE} (id varchar(64) primary key)`);
      await driver.execute(
        `create table "${there}".${TABLE} (
           id varchar(64) primary key,
           there_ref varchar(64),
           constraint ${FK_THERE} foreign key (there_ref) references "${there}".${REF_THERE} (id)
         )`,
      );
    });

    afterAll(async () => {
      await driver.execute(`drop schema if exists "${there}" cascade`).catch(() => {});
      await driver.execute(`drop table if exists ${TABLE} cascade`).catch(() => {});
      await driver.execute(`drop table if exists ${REF_HERE} cascade`).catch(() => {});
      await driver.disconnect().catch(() => {});
    });

    it('the fixture really collides: `search_path` sees one table, the catalog sees two', async () => {
      // Non-vacuity, part one — the session resolves the bare name to THIS
      // schema's table, so a scoped read has exactly one right answer.
      const resolved: any = await driver.execute(
        `select nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.oid = to_regclass(?)`,
        [TABLE],
      );
      expect(resolved.rows[0].nspname).toBe(here);

      // Non-vacuity, part two — the PRE-FIX predicate, re-issued verbatim.
      // Both constraints are visible to it, which is the whole defect.
      const unscoped: any = await driver.execute(
        `select tc.table_schema, tc.constraint_name
           from information_schema.table_constraints as tc
          where tc.constraint_type = 'FOREIGN KEY'
            and tc.table_name = ?
          order by tc.constraint_name`,
        [TABLE],
      );
      expect(
        unscoped.rows.map((r: any) => `${r.table_schema}.${r.constraint_name}`),
        'the neighbour schema did not get its own colliding table — this suite would be ' +
          'asserting an absence that the fixture, not the fix, produced',
      ).toEqual([`${here}.${FK_HERE}`, `${there}.${FK_THERE}`]);
    });

    it('reports ONLY the current schema’s foreign keys', async () => {
      const foreignKeys = await driver.foreignKeys(TABLE);

      // The exact array, not a `toContain`: the defect ADDS a row, so any
      // assertion satisfied by a superset is satisfied by the defect too.
      expect(
        foreignKeys,
        `${cell.label}: a same-named table in ${there} must contribute nothing to ${here}'s answer`,
      ).toEqual([
        {
          columnName: 'here_ref',
          referencedTable: REF_HERE,
          referencedColumn: 'id',
          constraintName: FK_HERE,
        },
      ]);

      // The pre-fix answer, named — so a future reader can see what red looked
      // like without re-deriving it.
      expect(foreignKeys.map((fk) => fk.constraintName)).not.toContain(FK_THERE);
      expect(foreignKeys.map((fk) => fk.referencedTable)).not.toContain(REF_THERE);
    });

    it('carries the scoping through `introspectSchema`, the in-tree consumer', async () => {
      // The call site at the top of this defect's blast radius: the whole-schema
      // read hangs these keys on the table it listed, and every downstream
      // consumer (federated codegen, `external_catalog`, drift comparison)
      // reads them from there rather than calling the arm directly.
      const schema = await driver.introspectSchema();

      expect(Object.keys(schema.tables)).toContain(TABLE);
      expect(schema.tables[TABLE].foreignKeys).toEqual([
        {
          columnName: 'here_ref',
          referencedTable: REF_HERE,
          referencedColumn: 'id',
          constraintName: FK_HERE,
        },
      ]);
    });
  });
}

declareDialectCell(PG_CELL, MATRIX, declareForeignKeyScopeSuite);
