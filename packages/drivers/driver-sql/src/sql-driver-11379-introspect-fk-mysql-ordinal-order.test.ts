// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11379] `introspectForeignKeys`' MySQL arm must ORDER BY the key ordinal.
 *
 * ## Why this pin is structural, and why that is the honest shape
 *
 * The card was filed as an OBSERVATION, and it says so up front: it **did not
 * reproduce**. Re-measured here on live MySQL 8.0.46 before this pin was
 * written, with the reporter's own fixture — a key declared out of column
 * sequence, `foreign key (second_col, first_col) references ooo_parent
 * (pa, pb)`, so that "key order" and "column order" are different answers —
 * the arm's query WITHOUT `ORDER BY` returned:
 *
 *     second_col -> pa   (ORDINAL_POSITION 1)
 *     first_col  -> pb   (ORDINAL_POSITION 2)
 *
 * which is key order: the correct answer, unpinned. So a behavioural pin —
 * "the columns come back in ordinal order" — is **vacuous** on this predicate.
 * It passes today, it passes with the fix, and it passes with the fix reverted.
 * A green that cannot go red is not evidence, so this file does not write one,
 * and does not dress one up as a guard.
 *
 * ## What was measured that makes the fix more than cosmetic
 *
 * On the SAME server, in the SAME session, against the SAME view, the sibling
 * `introspectPrimaryKeys` predicate — `CONSTRAINT_NAME = 'PRIMARY'` instead of
 * `REFERENCED_TABLE_NAME IS NOT NULL` — read an out-of-sequence primary key
 * `PRIMARY KEY (shipment_id, carrier_code)` back as:
 *
 *     carrier_code   (ORDINAL_POSITION 2)
 *     shipment_id    (ORDINAL_POSITION 1)
 *
 * i.e. COLUMN order, the wrong answer — reproducing #11101's measurement
 * exactly. `KEY_COLUMN_USAGE` therefore does NOT preserve the ordinal for free
 * on this server: which of the two orders comes back is decided by the WHERE
 * clause, and nothing declares that. The foreign-key predicate is currently on
 * the lucky side of a choice nobody made. That is what the `ORDER BY` removes,
 * and it is why "it did not reproduce" is not a reason to leave it out.
 *
 * ⛔ Deliberately NOT attempted here: proving that some plan shape on some
 * supported MySQL version returns the foreign-key predicate out of ordinal
 * order. That needs a fixture large enough to change the plan, and the card
 * rules it out as beyond what an observation should spend.
 *
 * ## So the pin is on the emitted SQL, and it can go red
 *
 * Removing `ORDER BY ORDINAL_POSITION` from the arm turns the first test in
 * this file red — verified by doing it, not by assuming it. That is the whole
 * claim this file makes, and it is stated no more strongly than that.
 *
 * ⚠️ It is a pin on **this method's** emitted statement, captured at the knex
 * seam — never a grep of the source file for the literal. `sql-driver.ts`
 * contains `ORDER BY ORDINAL_POSITION` three times (`introspectColumnOrder`,
 * this method, and `introspectPrimaryKeys`), so a file-level match would report
 * this arm as fixed while it was still unordered — which is exactly how a live
 * defect gets closed as already-absorbed.
 *
 * The second test pins the other half of the same contract, which lives in TS
 * rather than in SQL: the arm must EMIT the rows in the order the server
 * returned them. A sort, a `Map` keyed by column name, or a regrouping pass
 * inserted into that loop would silently undo the `ORDER BY` above, and unlike
 * the row order itself, that one is fully determined here and really can fail.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

/** One row of `KEY_COLUMN_USAGE` as the MySQL arm's projection aliases it. */
interface FkRow {
  column_name: string;
  referenced_table: string;
  referenced_column: string;
  constraint_name: string;
}

/**
 * A driver that DECLARES MySQL and answers from a canned result set.
 *
 * `isMysql` is derived from `config.client` and from nothing else, and the
 * constructor already keeps `this.config` as the DECLARED target while the knex
 * instance points somewhere else (#6743 — that split is the documented
 * behaviour of this class, not a hole this test opens). So re-declaring the
 * client after construction drives the REAL dispatch through the REAL getter,
 * while the transport stays an in-memory SQLite handle that is never asked to
 * execute anything. No MySQL server, so this pin runs in every CI job rather
 * than only in the provisioned live-matrix one.
 */
class MysqlFkEmissionProbe extends SqlDriver {
  /** Every statement the arm handed to knex, in order. */
  readonly emitted: { sql: string; bindings: unknown }[] = [];

  constructor(private readonly rows: FkRow[]) {
    super({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    (this.config as { client?: string }).client = 'mysql2';

    const knex = this.knex as unknown as Record<string, unknown>;
    // knex defines `raw` as non-writable (but configurable), so a plain
    // assignment throws — the swap has to go through `defineProperty`.
    Object.defineProperty(knex, 'raw', {
      configurable: true,
      value: (sql: unknown, bindings: unknown) => {
        this.emitted.push({ sql: String(sql), bindings });
        // mysql2 hands knex back `[rows, fields]`; the arm reads `result[0]`.
        return [this.rows, []];
      },
    });
  }

  foreignKeys(table: string) {
    return this.introspectForeignKeys(table);
  }

  /** The one statement this method emitted. Fails loudly if it was not one. */
  soleStatement(): string {
    expect(
      this.emitted.length,
      'introspectForeignKeys emitted no statement, or more than one — the ' +
        'capture below would be measuring nothing. Did the dialect dispatch ' +
        'stop reaching the MySQL arm?',
    ).toBe(1);
    return this.emitted[0]!.sql;
  }
}

/**
 * The reporter's fixture, as rows: `(second_col, first_col)` referencing
 * `(pa, pb)` — a key declared out of column sequence, so key order and column
 * order are different answers and an accidental sort is visible.
 */
const OUT_OF_SEQUENCE_ROWS: FkRow[] = [
  {
    column_name: 'second_col',
    referenced_table: 'ooo_parent',
    referenced_column: 'pa',
    constraint_name: 'fk_ooo',
  },
  {
    column_name: 'first_col',
    referenced_table: 'ooo_parent',
    referenced_column: 'pb',
    constraint_name: 'fk_ooo',
  },
];

describe('introspectForeignKeys (MySQL) orders a composite key by the ordinal (#11379)', () => {
  let probe: MysqlFkEmissionProbe | undefined;

  afterEach(async () => {
    await (probe as unknown as { knex?: { destroy(): Promise<void> } } | undefined)?.knex?.destroy();
    probe = undefined;
  });

  it('emits ORDER BY ORDINAL_POSITION on the KEY_COLUMN_USAGE read', async () => {
    probe = new MysqlFkEmissionProbe(OUT_OF_SEQUENCE_ROWS);
    await probe.foreignKeys('ooo_child');

    const sql = probe.soleStatement();

    // Control first: the captured statement really is the foreign-key read of
    // this method, not some other statement that happened past the seam. Without
    // this, the assertion below could go green on the wrong query — the
    // file-level-grep failure mode, one layer in.
    expect(sql).toMatch(/information_schema\.KEY_COLUMN_USAGE/i);
    expect(sql).toMatch(/REFERENCED_TABLE_NAME IS NOT NULL/i);
    expect(sql).not.toMatch(/CONSTRAINT_NAME\s*=\s*'PRIMARY'/i);

    // The pin: the ordinal clause is in THIS statement, and it comes after the
    // predicate that identifies it, so it cannot be satisfied by a clause that
    // belongs to a different read.
    expect(sql).toMatch(/REFERENCED_TABLE_NAME IS NOT NULL[\s\S]*ORDER BY\s+ORDINAL_POSITION/i);
  });

  it('emits the rows in the order the server returned them', async () => {
    probe = new MysqlFkEmissionProbe(OUT_OF_SEQUENCE_ROWS);
    const keys = await probe.foreignKeys('ooo_child');

    // `IntrospectedForeignKey` is a flat per-column record with no ordinal
    // field, so ORDERED SIBLING ROWS is the only way a composite key is
    // expressed (#11324). Re-sorting or regrouping in the arm would undo the
    // `ORDER BY` above without touching the SQL.
    expect(keys.map((k) => `${k.columnName} -> ${k.referencedTable}.${k.referencedColumn}`)).toEqual([
      'second_col -> ooo_parent.pa',
      'first_col -> ooo_parent.pb',
    ]);
    expect(keys.every((k) => k.constraintName === 'fk_ooo')).toBe(true);
  });
});
