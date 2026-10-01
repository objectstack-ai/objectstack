// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21163] An autonumber prefix carrying a `LIKE` metacharacter seeds its
 * counter from the data table's MAX — cold, and on the #5495 re-seed — on every
 * dialect, SQLite included.
 *
 * # The defect
 *
 * `scanMaxNumericTail` is the one read of "the highest counter already stored
 * under this prefix". It anchors the scan with `escapeLikePrefix(prefix) + '%'`,
 * which escapes `\`, `%` and `_` with a backslash — and then compiled the
 * predicate through Knex's `where(col, 'like', …)`, which declares NO `ESCAPE`
 * clause on any dialect. Postgres and MySQL read a backslash as the default
 * `LIKE` escape, so they were right by default. SQLite has no escape character
 * unless one is declared, so `SO\_%` asked for the literal three characters
 * `S`,`O`,`\` followed by any one character — and matched nothing. Measured on
 * better-sqlite3 at `cb45469e` (this file's fixtures, before the fix):
 *
 * | format | stored | cold create issued | re-seed after rows 2..30 land |
 * |:---|:---|:---|:---|
 * | `SO_{0000}` | `SO_0007` | `SO_0001` | refused: UNIQUE constraint failed |
 * | `SO%{0000}` | `SO%0007` | `SO%0001` | refused: UNIQUE constraint failed |
 * | `SO\{0000}` | `SO\0007` | `SO\0001` | refused: UNIQUE constraint failed |
 * | `{region}-{0000}`, region `north_east` | `north_east-0007` | `north_east-0001` | — |
 * | `SO-{0000}` (control) | `SO-0007` | `SO-0008` | `SO-0031` |
 *
 * The `{region}` row is why this is not an exotic-format problem: the prefix is
 * RENDERED, so a `_` arrives from data as readily as from the format — and
 * snake_case is this platform's spelling for machine names.
 *
 * Cold, the counter starts under numbers already stored, so a later issue
 * collides with them. On the re-seed path the scan answers 0, the forward-only
 * re-seed cannot move the counter, and every retry collides again until the
 * retry budget is spent: the #5495 storm, back for that format.
 *
 * # What is asserted
 *
 * The number the create issued, on a cold bootstrap over a stored row and on
 * the create that follows a bypass write landing ABOVE a warm counter — read
 * back from the stored row through the driver's own `findOne`, by an id the
 * test chose. Not from `create`'s return value: on MySQL that is not the row.
 * Knex does not support `.returning()` there, so `create` hands back the insert
 * id (measured on a live MySQL 8.0.46: `0`, with the row stored correctly), and
 * an assertion on it fails every case, controls included, whatever the scan
 * does. The stored row is the one reading every cell can make.
 *
 * Per dialect cell: SQLite always runs; live Postgres and MySQL
 * run where provisioned (the `Temporal Conformance (live PG + MySQL)` job runs
 * this whole package against both) and are declared un-run otherwise. On those
 * two the backslash was already the default escape, so their cells pin that
 * DECLARING it changed nothing there — they passed before the fix and must
 * pass after it.
 *
 * The plain prefix is the control on every cell: it has nothing to escape, so
 * it was right before and after, and a fix that broke the scan wholesale would
 * redden it too.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os21163_like_escape';
const SEQUENCES_TABLE = '_objectstack_sequences';

interface PrefixCase {
  /** Suite label. */
  label: string;
  /** The declared format. */
  format: string;
  /** The stored value for counter `n` under this format. */
  render: (n: number) => string;
  /** True when the rendered prefix carries a character `escapeLikePrefix` escapes. */
  escaped: boolean;
}

const pad4 = (n: number) => String(n).padStart(4, '0');

const STATIC_PREFIX_CASES: readonly PrefixCase[] = [
  { label: '`_` in the prefix', format: 'SO_{0000}', render: (n) => `SO_${pad4(n)}`, escaped: true },
  { label: '`%` in the prefix', format: 'SO%{0000}', render: (n) => `SO%${pad4(n)}`, escaped: true },
  { label: '`\\` in the prefix', format: 'SO\\{0000}', render: (n) => `SO\\${pad4(n)}`, escaped: true },
  { label: 'a plain prefix (control)', format: 'SO-{0000}', render: (n) => `SO-${pad4(n)}`, escaped: false },
];

const objectWith = (format: string) =>
  ({
    name: TABLE,
    fields: {
      region: { type: 'string' },
      so_no: { type: 'autonumber', format, unique: true },
      title: { type: 'string' },
    },
  }) as any;

function suite(cell: DialectCell) {
  describe(`sql-driver — autonumber prefix LIKE escape (${cell.label}) [#21163]`, () => {
    let driver: SqlDriver;

    const knex = () => (driver as any).knex;

    /** Drop the data table and this object's counter rows, so every test starts COLD. */
    const reset = async () => {
      await knex().schema.dropTableIfExists(TABLE);
      await knex()(SEQUENCES_TABLE)
        .where('object', TABLE)
        .del()
        .catch(() => {});
    };

    /** Land rows by a path that bypasses `fillAutoNumberFields`, as a seed replay does. */
    const bypassInsert = async (values: string[], region: string | null = null) => {
      await knex()(TABLE).insert(
        values.map((v) => ({ id: `bypass-${v}`, region, so_no: v, title: 'seed replay' })),
      );
    };

    let seq = 0;

    /** Create one row and answer the autonumber it was STORED with (see the header). */
    const issue = async (data: Record<string, unknown>): Promise<unknown> => {
      const id = `issued-${++seq}`;
      await driver.create(TABLE, { id, ...data });
      const row = await driver.findOne(TABLE, { where: { id } });
      expect(row, `row ${id} was not stored`).not.toBeNull();
      return row!.so_no;
    };

    beforeEach(async () => {
      driver = new SqlDriver(cell.config());
      await reset();
    });

    afterEach(async () => {
      await reset();
      await driver.disconnect();
    });

    for (const c of STATIC_PREFIX_CASES) {
      const role = c.escaped ? 'red before the fix on SQLite' : 'control';

      it(`${c.label}: a COLD bootstrap seeds from the stored MAX (${role})`, async () => {
        await driver.initObjects([objectWith(c.format)]);
        await bypassInsert([c.render(7)]);

        expect(await issue({ title: 'first issued' })).toBe(c.render(8));
      });

      it(`${c.label}: the #5495 re-seed moves a warm counter past rows a bypass write landed (${role})`, async () => {
        await driver.initObjects([objectWith(c.format)]);

        // Warm the counter on an EMPTY table, so this test does not depend on
        // the cold scan above: there is nothing for the bootstrap to find.
        expect(await issue({ title: 'warm' })).toBe(c.render(1));

        // Rows 2..30 land above the counter. Nothing tells the sequence.
        await bypassInsert(Array.from({ length: 29 }, (_, i) => c.render(i + 2)));

        expect(await issue({ title: 'after the seeds' })).toBe(c.render(31));
      });
    }

    it('a `_` that arrives from DATA through `{field}` interpolation seeds from the stored MAX (red before the fix on SQLite)', async () => {
      await driver.initObjects([objectWith('{region}-{0000}')]);
      await bypassInsert(['north_east-0007'], 'north_east');

      expect(await issue({ region: 'north_east', title: 'first issued' })).toBe('north_east-0008');
    });
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'autonumber prefix LIKE escape (#21163)', suite);
}
