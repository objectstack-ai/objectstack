// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11202] `introspectUniqueConstraints` reports SINGLE-COLUMN uniqueness
 * only, and reports it identically on all three dialects.
 *
 * The three arms used to answer three different questions. SQLite kept unique
 * indexes of exactly one column (`info.length === 1`); Postgres and MySQL
 * returned every member of every composite constraint. `introspectSchema`
 * folds the flat `string[]` into a per-column `isUnique`, so for `UNIQUE
 * (a, b)` the same table read through Postgres claimed `a` alone is unique and
 * `b` alone is unique — a claim the constraint does not make — while through
 * SQLite it claimed neither.
 *
 * The divergence was LATENT until #11161: the Postgres arm's query named an
 * alias that was not in scope, and the bare `catch {}` it carried turned every
 * execution into `[]`. Repairing the query is what put three live answers into
 * conflict for the first time.
 *
 * Maintainer ruling 2026-08-23 (option A→B), verbatim and untranslated:
 * 「10950 不考虑存量，其他接受你的建议」 — narrow the flag to single-column
 * uniqueness now; a composite representation waits for real demand.
 *
 * ## Why this file has two halves
 *
 * The **predicate half** feeds `singleColumnUniqueColumns` the exact row
 * shapes each dialect's query returns. It runs everywhere, which matters
 * because the Postgres and MySQL narrowing is otherwise only measurable on a
 * provisioned live server — the arms now group in JS precisely so the decision
 * is testable without one. What it cannot prove is that the queries really
 * return those rows.
 *
 * The **live half** proves that, end to end, on every provisioned cell, and is
 * declared through `declareDialectCell` so an unprovisioned dialect is a NAMED
 * skip (a red under `OS_EXPECT_LIVE_DIALECT_MATRIX=1`), never a silent pass.
 *
 * ## The interesting assertion is an ABSENCE, so the fixture is proven first
 *
 * "`a` is not flagged" goes green for free on a table whose composite
 * constraint never got created. Every live cell therefore first makes the
 * DATABASE state its own witness: two rows sharing `a` are ACCEPTED (so `a`
 * alone is genuinely not unique — exactly what the flag must not claim), a
 * repeat of the `(a, b)` pair is REJECTED (so the composite constraint exists
 * and is enforced), and a repeat of `email` is REJECTED (so the single-column
 * constraint that must be flagged exists too). If the fixture is not real,
 * that case fails before any absence is asserted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver, singleColumnUniqueColumns } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const MATRIX = 'single-column unique introspection';

/** Composite `UNIQUE (a, b)` plus a single-column `UNIQUE (email)`. */
const TABLE = 'os11202_uniq';

/** `introspectUniqueConstraints` is `protected`; this is the narrowest reach. */
class UniqueProbeDriver extends SqlDriver {
  uniqueConstraints(table: string) {
    return this.introspectUniqueConstraints(table);
  }
}

// ── Half 1: the predicate, on every dialect's real row shape ────────────────

describe('singleColumnUniqueColumns — the one definition of what the flag means (#11202)', () => {
  it('keeps a one-member constraint and drops every member of a composite one', () => {
    expect(
      singleColumnUniqueColumns([
        { constraint: ['pair'], column: 'a' },
        { constraint: ['pair'], column: 'b' },
        { constraint: ['solo'], column: 'email' },
      ]),
    ).toEqual(['email']);
  });

  it('a three-column constraint contributes nothing — width is counted, not assumed to be two', () => {
    expect(
      singleColumnUniqueColumns([
        { constraint: ['triple'], column: 'a' },
        { constraint: ['triple'], column: 'b' },
        { constraint: ['triple'], column: 'c' },
      ]),
    ).toEqual([]);
  });

  it('a column carrying TWO separate single-column constraints is named once', () => {
    expect(
      singleColumnUniqueColumns([
        { constraint: ['by_clause'], column: 'email' },
        { constraint: ['by_index'], column: 'email' },
      ]),
    ).toEqual(['email']);
  });

  it('a column that is BOTH a composite member and single-column unique is still flagged', () => {
    // The composite membership must not veto the standalone constraint: `a`
    // really is unique on its own here, by a constraint of its own.
    expect(
      singleColumnUniqueColumns([
        { constraint: ['pair'], column: 'a' },
        { constraint: ['pair'], column: 'b' },
        { constraint: ['solo_a'], column: 'a' },
      ]),
    ).toEqual(['a']);
  });

  it('an empty answer stays empty — no constraint, nothing flagged', () => {
    expect(singleColumnUniqueColumns([])).toEqual([]);
  });

  describe('the Postgres row shape — identity is (schema, name), not name alone', () => {
    /**
     * The arm's answer spans `current_schemas(false)`, and Postgres auto-names
     * a unique constraint `<table>_<column>_key` — so two same-named tables in
     * two schemas hand back two DIFFERENT constraints under one name. Keyed on
     * the name alone they fuse into an apparent two-member constraint and the
     * genuine single-column unique disappears from the answer. This is the
     * #11201 defect class, one method over.
     */
    it('same constraint name in two schemas stays two constraints', () => {
      const rows = [
        { constraint_schema: 'app', constraint_name: 'orders_email_key', column_name: 'email' },
        { constraint_schema: 'other', constraint_name: 'orders_email_key', column_name: 'email' },
      ];
      const members = rows.map((row) => ({
        constraint: [row.constraint_schema, row.constraint_name],
        column: row.column_name,
      }));
      expect(singleColumnUniqueColumns(members)).toEqual(['email']);

      // The counterfactual: keyed on the name alone, the same rows lose it.
      const nameOnly = rows.map((row) => ({
        constraint: [row.constraint_name],
        column: row.column_name,
      }));
      expect(singleColumnUniqueColumns(nameOnly)).toEqual([]);
    });

    it('a composite constraint in one schema is dropped, its single-column sibling kept', () => {
      const rows = [
        { constraint_schema: 'app', constraint_name: 'os11202_ab', column_name: 'a' },
        { constraint_schema: 'app', constraint_name: 'os11202_ab', column_name: 'b' },
        { constraint_schema: 'app', constraint_name: 'os11202_email', column_name: 'email' },
      ];
      expect(
        singleColumnUniqueColumns(
          rows.map((row) => ({
            constraint: [row.constraint_schema, row.constraint_name],
            column: row.column_name,
          })),
        ),
      ).toEqual(['email']);
    });
  });

  describe('the MySQL row shape — SCREAMING keys, one identity part', () => {
    it('composite members are dropped, the single-column constraint kept', () => {
      const rows = [
        { CONSTRAINT_NAME: 'os11202_ab', COLUMN_NAME: 'a' },
        { CONSTRAINT_NAME: 'os11202_ab', COLUMN_NAME: 'b' },
        { CONSTRAINT_NAME: 'os11202_email', COLUMN_NAME: 'email' },
      ];
      expect(
        singleColumnUniqueColumns(
          rows.map((row) => ({ constraint: [row.CONSTRAINT_NAME], column: row.COLUMN_NAME })),
        ),
      ).toEqual(['email']);
    });
  });

  describe('the SQLite row shape — an index member is not always a column', () => {
    it('a one-term EXPRESSION index contributes nothing, and never a null', () => {
      // `PRAGMA index_info` reports `name: null` for an expression term. The
      // arm used to push that row's `name` straight into a `string[]`.
      const flagged = singleColumnUniqueColumns([
        { constraint: ['os11202_lower_c'], column: null },
      ]);
      expect(flagged).toEqual([]);
      expect(flagged).not.toContain(null);
    });

    it('a column PAIRED with an expression term is not single-column unique', () => {
      // The unnamed member still occupies a slot: `(d, lower(e))` is a
      // two-member index, so `d` alone is not unique and must not be flagged.
      expect(
        singleColumnUniqueColumns([
          { constraint: ['os11202_d_lower_e'], column: 'd' },
          { constraint: ['os11202_d_lower_e'], column: null },
        ]),
      ).toEqual([]);
    });
  });
});

// ── Half 2: end to end, on every provisioned dialect ────────────────────────

function declareSingleColumnUniqueSuite(cell: DialectCell): void {
  describe(`introspectUniqueConstraints — single-column only — ${cell.label} (#11202)`, () => {
    let driver: UniqueProbeDriver;

    beforeAll(async () => {
      driver = new UniqueProbeDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      // No primary key on purpose: SQLite materialises a non-INTEGER primary
      // key as a unique auto-index that `PRAGMA index_list` reports, while the
      // Postgres and MySQL arms filter on `CONSTRAINT_TYPE = 'UNIQUE'` and so
      // never see primary keys at all. Keeping keys out of the fixture makes
      // this suite measure the composite-vs-single question and nothing else.
      await driver.execute(
        `create table ${TABLE} (
           a varchar(64) not null,
           b varchar(64) not null,
           email varchar(64) not null,
           note varchar(64),
           constraint os11202_ab unique (a, b),
           constraint os11202_email unique (email)
         )`,
      );
    });

    afterAll(async () => {
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.disconnect().catch(() => {});
    });

    it('the fixture is real: `a` alone is NOT unique, the pair IS, and `email` IS', async () => {
      // Non-vacuity, asserted against the server rather than the catalog: an
      // absence assertion below is worthless if the constraints never landed.
      await driver.execute(`insert into ${TABLE} (a, b, email) values ('x', '1', 'e1@example.com')`);

      // Two rows sharing `a` — ACCEPTED. This is the fact the flag must not
      // contradict: `a` is not unique on its own.
      await driver.execute(`insert into ${TABLE} (a, b, email) values ('x', '2', 'e2@example.com')`);

      // The PAIR repeated — REJECTED, so the composite constraint is enforced.
      await expect(
        driver.execute(`insert into ${TABLE} (a, b, email) values ('x', '1', 'e3@example.com')`),
      ).rejects.toThrow();

      // `email` repeated — REJECTED, so the single-column constraint exists.
      await expect(
        driver.execute(`insert into ${TABLE} (a, b, email) values ('y', '9', 'e1@example.com')`),
      ).rejects.toThrow();
    });

    it('reports the single-column unique column and NEITHER member of the composite one', async () => {
      const columns = await driver.uniqueConstraints(TABLE);

      expect(columns).toContain('email');
      expect(columns).not.toContain('a');
      expect(columns).not.toContain('b');
      expect(columns).not.toContain('note');
      // Exact, so a dialect that starts reporting something extra is caught
      // rather than absorbed by the three `not.toContain`s above.
      expect(columns).toEqual(['email']);
    });

    it("`introspectSchema` folds that into `isUnique` — the consumer-visible half", async () => {
      const schema = await driver.introspectSchema();
      const table = schema.tables[TABLE];
      expect(table, `${TABLE} missing from the introspected schema`).toBeDefined();

      const byName = Object.fromEntries(table.columns.map((col) => [col.name, col]));
      expect(byName.email?.isUnique).toBe(true);
      // Falsy, not `false`: the flag is only ever SET to `true`, so a
      // non-unique column carries `undefined` and asserting `false` would pin
      // a shape the producer does not emit.
      expect(byName.a?.isUnique).toBeFalsy();
      expect(byName.b?.isUnique).toBeFalsy();
      expect(byName.note?.isUnique).toBeFalsy();
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, MATRIX, declareSingleColumnUniqueSuite);
}

// ── SQLite-only: the member shapes no other dialect can produce ─────────────

describe('SQLite expression indexes — a unique index member that is not a column (#11202)', () => {
  const EXPR_TABLE = 'os11202_expr';
  let driver: UniqueProbeDriver;

  beforeAll(async () => {
    driver = new UniqueProbeDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.execute(
      `create table ${EXPR_TABLE} (c varchar(64), d varchar(64), e varchar(64), f varchar(64))`,
    );
    // One-term expression index: a single member carrying no column name.
    await driver.execute(`create unique index os11202_lower_c on ${EXPR_TABLE} (lower(c))`);
    // Column + expression: two members, so `d` is not unique on its own.
    await driver.execute(`create unique index os11202_d_lower_e on ${EXPR_TABLE} (d, lower(e))`);
    // A plain single-column unique index, so this suite has a positive too.
    await driver.execute(`create unique index os11202_f on ${EXPR_TABLE} (f)`);
  });

  afterAll(async () => {
    await driver.disconnect().catch(() => {});
  });

  it('PRAGMA index_info really reports a null name for an expression term', async () => {
    // Pins the premise the arm's null-handling rests on. If SQLite ever named
    // these members, the handling would be dead code and should be re-read.
    const info: any = await driver.execute(`PRAGMA index_info(os11202_lower_c)`);
    const rows = Array.isArray(info) ? info : [];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBeNull();
  });

  it('flags only the plain single-column index — no nulls, no expression terms', async () => {
    const columns = await driver.uniqueConstraints(EXPR_TABLE);
    expect(columns).toEqual(['f']);
    expect(columns).not.toContain(null);
    expect(columns).not.toContain('d');
  });
});
