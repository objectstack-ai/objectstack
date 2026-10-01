// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21009] The text operators other than the membership pair — `$startsWith`,
 * `$endsWith`, `$icontains` and the staged `$like` / `$ilike` — are REFUSED on a
 * column this driver stores as JSON text, with the `400` the equality family
 * already gets there (#7398), on every dialect alike. A scalar text column is
 * unaffected (the control), and the membership pair keeps answering.
 *
 * ## What each dialect answered before (`origin/main` `7a606a9a3`)
 *
 * Measured through `POST /api/v1/data/:object/query` over a multi-value lookup
 * and a `tags` field, on SQLite and a private PostgreSQL 16.14:
 *
 * | filter on a multi-value column | SQLite                                   | PostgreSQL            |
 * |:--|:--|:--|
 * | `$startsWith: '['`             | every row with a value (the brackets)    | 500 `DATABASE_ERROR`  |
 * | `$startsWith: 'u1'`            | no row, though two rows hold `u1`        | 500 `DATABASE_ERROR`  |
 * | `$endsWith: ']'`               | every row with a value                   | 500 `DATABASE_ERROR`  |
 * | `$icontains: 'U1'`             | the row holding only `u10` too           | 500 `DATABASE_ERROR`  |
 * | `$icontains: '","'`            | every row with two members               | 500 `DATABASE_ERROR`  |
 * | `$like` / `$ilike`             | a substring of the serialization         | 500 `DATABASE_ERROR`  |
 *
 * PostgreSQL's `json` column has no `LIKE` operator, so the filter failed at
 * query time — a `500` for a filter the caller can fix. SQLite answered the
 * serialization, which is a wrong answer rather than a narrow one. Neither
 * dialect ever answered a membership question with these operators, and none is
 * invented for them here: the prescription is `$contains`.
 *
 * ## What this file pins, per dialect cell
 *
 * - Each operator, on a multi-value lookup and on a `tags` column: `INVALID_FILTER`
 *   / `400`, through `find` and `count`. An author's own filter reads the
 *   operator and the field named; any other reads the shared withheld message —
 *   byte for byte the one the equality family reads.
 * - The control: the same operators on a scalar text column answer the rows
 *   they always did.
 * - `$contains` / `$notContains` still answer MEMBERSHIP on the same columns.
 *
 * The SQLite cell always runs; the PostgreSQL and MySQL cells run where
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set — the
 * `Temporal Conformance (live PG + MySQL)` job provisions both — and are a
 * named skip otherwise.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import { jsonColumnOperatorRefusalText } from '@objectstack/core';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import {
  DIALECT_CELLS,
  declareDialectCell,
  LIVE_CELL_TIMEOUT_MS,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/** Issue-prefixed: each live cell owns its table, dropped before and after. */
const OBJECT = 'os21009_text_ops';

/** Diagnostics-only; it never changes which rows a read touches. */
const BYPASS: DriverOptions = { bypassTenantAudit: true };

const FIELDS: Record<string, Record<string, unknown>> = {
  // The scalar control.
  label: { type: 'text' },
  // The ruling's own column: a multi-valued lookup.
  owners: { type: 'lookup', reference: 'os21009_owner', multiple: true },
  // An inherently multi-valued option type, stored the same way.
  tags_: { type: 'tags' },
};

const ROWS = [
  { id: '1', label: 'u1 memo', owners: ['u1', 'u2'], tags_: ['red', 'blue'] },
  { id: '2', label: 'red', owners: ['u10'], tags_: ['redwood'] },
  { id: '3', label: 'about u10', owners: ['u3', 'u1'], tags_: ['blue'] },
  { id: '4', label: 'none', owners: [], tags_: [] },
] as const;

/**
 * The refused operators, each with a comparand its own contract accepts — so a
 * refusal here is always the column-type gate, never a comparand-shape one —
 * and the one that used to match on SQLite where there is one.
 */
const TEXT_REFUSED: ReadonlyArray<readonly [op: string, comparand: string]> = [
  ['$startsWith', '['],
  ['$endsWith', ']'],
  ['$icontains', 'U1'],
  ['$like', '%u1%'],
  ['$ilike', '%U1%'],
];

/** The same operators on the scalar `label` column, and the rows they answer. */
const CONTROL: ReadonlyArray<readonly [op: string, comparand: string, ids: string[]]> = [
  ['$startsWith', 'u1', ['1']],
  ['$endsWith', 'u10', ['3']],
  ['$icontains', 'U1', ['1', '3']],
  ['$like', '%u1%', ['1', '3']],
  ['$ilike', '%U1%', ['1', '3']],
];

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

async function refusalOf(run: () => Promise<unknown>): Promise<WireBearingError> {
  try {
    await run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the driver to refuse this filter, but it resolved');
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, '[#21009] the JSON-column text-operator refusal', declareTextOperatorCell);
}

function declareTextOperatorCell(cell: DialectCell): void {
  describe(`[#21009] SqlDriver — the text operators other than membership are refused on a JSON column (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: Knex;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = driver.getKnex();
      await knexInstance.schema.dropTableIfExists(OBJECT);
      await driver.initObjects([{ name: OBJECT, fields: FIELDS } as never]);
      for (const row of ROWS) {
        await driver.create(OBJECT, { ...row, owners: [...row.owners], tags_: [...row.tags_] }, BYPASS);
      }
    }, LIVE_CELL_TIMEOUT_MS);

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(OBJECT).catch(() => {});
      await driver?.disconnect?.();
    });

    const ids = async (where: FilterCondition): Promise<string[]> => {
      const rows = await driver.find(OBJECT, { where }, BYPASS);
      return rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
    };

    it('stored all four rows — the premise of every answer below', async () => {
      expect(await ids({})).toEqual(['1', '2', '3', '4']);
    });

    for (const field of ['owners', 'tags_']) {
      for (const [op, comparand] of TEXT_REFUSED) {
        it(`${field} ${op}: 400 INVALID_FILTER, the operator and the field named to the author`, async () => {
          const where = markFilterSubtreeProvenance({ [field]: { [op]: comparand } }, 'author') as FilterCondition;
          const err = await refusalOf(() => driver.find(OBJECT, { where }, BYPASS));
          expect(err.code).toBe('INVALID_FILTER');
          expect(err.status).toBe(400);
          expect(err.message).toContain(`Operator "${op}" on field "${field}" WAS NOT APPLIED`);
          expect(err.message).toContain(`{ "${field}": { "$contains": "a" } }`);
        });

        it(`${field} ${op}: any other caller reads the equality family's withheld message, byte for byte`, async () => {
          const where = { [field]: { [op]: comparand } } as FilterCondition;
          for (const run of [
            () => driver.find(OBJECT, { where }, BYPASS),
            () => driver.count(OBJECT, { where }, BYPASS),
          ]) {
            const err = await refusalOf(run);
            expect(err.code).toBe('INVALID_FILTER');
            expect(err.status).toBe(400);
            expect(err.message).toBe(jsonColumnOperatorRefusalText(field, '$in', false).message);
          }
        });
      }
    }

    for (const [op, comparand, expected] of CONTROL) {
      it(`control — label ${op} ${JSON.stringify(comparand)} answers ${JSON.stringify(expected)}`, async () => {
        expect(await ids({ label: { [op]: comparand } } as FilterCondition)).toEqual(expected);
      });
    }

    it('the membership pair still answers on the same columns', async () => {
      expect(await ids({ owners: { $contains: 'u1' } })).toEqual(['1', '3']);
      expect(await ids({ owners: { $notContains: 'u1' } })).toEqual(['2', '4']);
      expect(await ids({ tags_: { $contains: 'red' } })).toEqual(['1']);
      expect(await ids({ $or: [{ owners: { $contains: 'u3' } }, { owners: { $contains: 'u10' } }] })).toEqual(['2', '3']);
    });
  });
}
