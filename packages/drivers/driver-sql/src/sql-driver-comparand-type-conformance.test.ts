// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7872] `driver-sql` held to `FILTER_COMPARAND_TYPE_CASES` — the
 * comparand-type door, both directions, on the compiled-SQL path, across the
 * DRIVER axis (ADR-0053 D-A3).
 *
 * This driver is one of the two independent implementations the door's set was
 * MEASURED from (`isBindableComparand` / `isRenderableTextComparand`, whose
 * type membership is now sourced from the door instead of duplicated — see
 * their [#7872] notes). The refusal direction is therefore doubly guarded
 * here: the door refuses at the platform face, and this driver's own gate
 * still refuses the same types for direct callers, in its own ADR-0112
 * envelope (pinned by `sql-driver-silent-empty-predicate.test.ts` and
 * siblings). This suite pins the door half, so the shared table drives every
 * backend identically.
 *
 * # Why this runs the matrix (#12136, the follow-up #12014 sized)
 *
 * The case-set's own headline is that the six accepted types **compile
 * everywhere** — and until #12136 that sentence was measured on ONE dialect.
 * `check-driver-conformance.mjs`'s dialect axis recorded the consequence
 * exactly: `FILTER_COMPARAND_TYPE` was the only dialect-scored cell with no
 * matrix-routed suite at all, so "everywhere" was a claim the census printed
 * and nothing executed. That is #12014's thesis one level in — a suite whose
 * NAME says conformance while its COVERAGE says SQLite — and it is why the
 * conversion is earned rather than tidy.
 *
 * ## What is per-dialect here, and what deliberately is not
 *
 * The case-set has two directions and only one of them has a dialect:
 *
 *   - `matches` / `compiles` cases hand the door-validated condition to THIS
 *     DRIVER'S execution path, so they are run once per cell. This is the half
 *     "compile everywhere" is about, and the half that was measured on SQLite
 *     alone.
 *   - `door-refusal` cases assert `parseFilterAST` throws BEFORE any driver
 *     runs. `parseFilterAST` is a pure platform function with no dialect in it
 *     — running it once per cell would not measure three things, it would
 *     measure one thing three times and report the repetition as coverage.
 *     They therefore run once, in the dialect-independent block below, which
 *     says so in its own name.
 *
 * # Which cells actually executed, and which did not
 *
 * Recorded here rather than implied, because a matrix that reports OK while
 * finding zero live cells is the failure `declareUnprovisionedCell` exists for
 * (#4646):
 *
 *   - **sqlite** — always runs, embedded.
 *   - **live postgres** — RUN, on PostgreSQL 16.13 (the same version #11456's
 *     `42883` divergence was measured on). All eight executed cases answered
 *     the case-set's row ids, so on this dialect "compile everywhere" is now a
 *     measurement rather than a claim.
 *   - **live mysql** — NOT run: no MySQL server was provisionable in the
 *     container this landed from, so it is a declared SKIP, and the MySQL arm
 *     rests on the compiled-SQL block at the bottom rather than on execution.
 *     Saying so is the point — the cell is skipped BY NAME, and
 *     `OS_EXPECT_LIVE_DIALECT_MATRIX=1` turns that skip into a failure for a
 *     runner that believes it provisioned one. The same disclosure
 *     `sql-driver-text-case-conformance.test.ts` makes for its own MySQL cell.
 *
 * # The compiled-SQL layer, and why it is not redundant with the rows
 *
 * The last block asserts that every accepted comparand type BINDS into a
 * statement on each of the three dialects. On the cells that run, rows are the
 * stronger witness and the binding is a bonus. On the cell that does NOT run,
 * the binding is the only thing this repo can check at all — and it is the
 * layer where a type-level refusal would surface, since a comparand this
 * driver cannot bind throws out of `applyFilters` before any server is
 * reached. knex builds a Postgres or MySQL statement without needing a server
 * to send it to, which is what makes the un-provisioned cell checkable here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import {
  FILTER_COMPARAND_TYPE_CASES,
  FILTER_COMPARAND_TYPE_ROWS,
  parseFilterAST,
  type FilterCondition,
} from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';
import {
  DIALECT_CELLS,
  declareUnprovisionedCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/**
 * Issue-prefixed object name: the live cells share one database with every
 * other suite in this package, so the bare `comparand_conformance` this suite
 * carried while it was SQLite-only would be a collision waiting to be read as
 * a comparand-type failure.
 */
const TABLE = 'os7872_comparand_type';

/** The half of the table that reaches a driver at all — see the head note. */
const EXECUTED_CASES = FILTER_COMPARAND_TYPE_CASES.filter((c) => c.verdict !== 'door-refusal');

/** The half the door settles upstream of every driver. */
const DOOR_REFUSAL_CASES = FILTER_COMPARAND_TYPE_CASES.filter((c) => c.verdict === 'door-refusal');

// ── The driver axis ─────────────────────────────────────────────────────────

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell, 'FILTER_COMPARAND_TYPE_CASES comparand-type door');
    continue;
  }
  declareComparandTypeSweep(cell);
}

function declareComparandTypeSweep(cell: DialectCell): void {
  describe(`[#7872] SqlDriver — comparand-type conformance (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: Knex;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      // `getKnex()` is public API; the older shape of this file reached the
      // `protected` field through `(driver as any).knex`, which erases every
      // member of the driver to get one.
      knexInstance = driver.getKnex();
      // Live cells reuse one database, so the sweep starts from a dropped table.
      await knexInstance.schema.dropTableIfExists(TABLE);
      await knexInstance.schema.createTable(TABLE, (t: Knex.TableBuilder) => {
        t.string('id').primary();
        t.integer('qty');
        t.string('label');
        t.boolean('active');
        // Nullable (knex's default): the `note: null` case is the declared null
        // predicate, and it measures nothing against a NOT NULL column.
        t.string('note');
      });
      await knexInstance(TABLE).insert(FILTER_COMPARAND_TYPE_ROWS.map((r) => ({ ...r })));
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(TABLE).catch(() => {});
      await driver?.disconnect?.();
    });

    const ids = async (where: FilterCondition | undefined): Promise<string[]> => {
      const rows = await driver.find(TABLE, { fields: ['id'], where });
      return rows.map((r: any) => String(r.id)).sort((x, y) => x.localeCompare(y));
    };

    /**
     * The fixture control. Every `matches` case below names row ids, so a cell
     * whose insert silently dropped or coerced a row would answer wrong ids for
     * a reason that has nothing to do with the comparand door.
     */
    it('the fixture really is both rows', async () => {
      expect(await ids(undefined)).toEqual(['1', '2']);
    });

    for (const c of EXECUTED_CASES) {
      if (c.verdict === 'matches') {
        it(c.name, async () => {
          expect(await ids(parseFilterAST(c.filter())), c.note).toEqual([...c.expected]);
        });
      } else {
        it(`${c.name} — executes without refusal`, async () => {
          await expect(ids(parseFilterAST(c.filter()))).resolves.toBeDefined();
        });
      }
    }
  });
}

// ── The door, which has no dialect ──────────────────────────────────────────

/**
 * `parseFilterAST` runs upstream of every driver and is the same function on
 * every cell, so these assertions are declared ONCE rather than once per
 * dialect. Repeating a pure function across three cells would add rows to the
 * report without adding a measurement — the shape this whole axis exists to
 * make visible.
 */
describe('[#7872] the comparand-type door — refused before any dialect is chosen', () => {
  for (const c of DOOR_REFUSAL_CASES) {
    it(`${c.name} — refused at the door, before any SQL compiles`, () => {
      let caught: (Error & { code?: string; status?: number }) | null = null;
      try {
        parseFilterAST(c.filter());
      } catch (e) {
        caught = e as Error & { code?: string; status?: number };
      }
      expect(caught, c.note).not.toBeNull();
      // `code` AND `status`: a refusal outside the ADR-0112 envelope reaches
      // the client as a 500-shaped body for a 400-class mistake.
      expect(caught?.code, c.name).toBe(c.code);
      expect(caught?.status, c.name).toBe(400);
      for (const fragment of c.mustMention) expect(caught?.message).toContain(fragment);
    });
  }
});

// ── "compiles everywhere", at the layer a server is not needed for ──────────

/**
 * Every accepted comparand type BINDS into a statement on each dialect.
 *
 * This is the claim `CASE_SETS` makes about this table in one word, checked on
 * all three dialects including the one no server was provisionable for. It is
 * a real check rather than a restatement: this driver refuses an unbindable
 * comparand from inside `applyFilters` (the `isBindableComparand` gate the
 * door's own set was measured from), which throws while the statement is being
 * BUILT — before any connection exists. So a type that this driver could not
 * bind on `pg` or `mysql2` fails here, with no server involved.
 */
describe('[#7872] every accepted comparand type binds, on every dialect', () => {
  /** A driver that exposes the compiled WHERE without reaching into privates. */
  class CompilerProbeDriver extends SqlDriver {
    compileWhere(where: FilterCondition): string {
      const builder: Knex.QueryBuilder = this.getKnex()(TABLE);
      this.applyFilters(builder, where);
      return builder.toString();
    }
  }

  const probe = (config: SqlDriverConfig) => new CompilerProbeDriver(config);

  const CLIENTS: readonly { id: string; config: SqlDriverConfig }[] = [
    {
      id: 'sqlite',
      config: { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true },
    },
    { id: 'pg', config: { client: 'pg', connection: { host: '127.0.0.1' } } },
    { id: 'mysql', config: { client: 'mysql2', connection: { host: '127.0.0.1' } } },
  ];

  for (const client of CLIENTS) {
    describe(client.id, () => {
      for (const c of EXECUTED_CASES) {
        it(`${c.name} — binds`, () => {
          const sql = probe(client.config).compileWhere(parseFilterAST(c.filter()));
          // A statement, with a `where` in it: `applyFilters` throwing is the
          // failure this block is looking for, and a builder that silently
          // applied NOTHING would render a bare select — which is the quiet
          // way a comparand can be dropped rather than refused.
          expect(sql, `${client.id} rendered no statement for ${c.name}`).toContain(TABLE);
          expect(sql.toLowerCase(), `${client.id} dropped the predicate for ${c.name}`)
            .toContain('where');
        });
      }
    });
  }
});
