// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The analytics (cube) face LOWERS the `FilterArray` spelling of `where`, as the
 * analytics `where` door does, through the same `@objectstack/spec` pair —
 * `isFilterAST` gates the shape, `parseFilterAST` lowers it — at the entry of
 * `normalizeFilters`, before the shared comparand doors and the shared lowering.
 * So both spellings of one filter meet the same doors and answer the same rows.
 *
 * Measured on `main` before this door, on the fixture below (`d` holds a value
 * on rows 1 and 2, is null on row 3, and is absent on row 4):
 *
 *   | cube `where`                  | `query()` rows | `generateSql()` echo |
 *   |-------------------------------|----------------|----------------------|
 *   | `{d: 'v1'}`                   | 1              | `WHERE d = 'v1'`     |
 *   | `[['d', '=', 'v1']]`          | 1, 2, 3, 4     | no `WHERE` at all    |
 *
 * `normalizeFilters` read only a non-array object `where`, so the array skipped
 * the doors, the gate and the flatten, and its predicate vanished. Fewer
 * predicates means MORE rows, and a widened aggregate looks exactly like a
 * working one — the silent-widening class this face's gate already refuses for
 * the object spelling. The echo is the control that caught it: an aggregate
 * cannot tell you it read every row, but the echoed SQL can.
 *
 * The three arrival answers are the analytics `where` door's and the engine's:
 * `[]` is no filter; an array `isFilterAST` accepts is lowered; any other array
 * is REFUSED `INVALID_FILTER` / 400 on both exits — never every row.
 */

import { describe, it, expect } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';

const ids = (rows: ReadonlyArray<Record<string, unknown>>) => rows.map((r) => String(r.id)).sort();

/** The echo's WHERE clause alone; `undefined` when the echo carries none. */
const whereOf = (sql: string) => /WHERE (.*?)(?: GROUP BY|$)/.exec(sql)?.[1];

const CUBE = {
  name: 'arr',
  title: 'Arr',
  sql: 'arr_row',
  measures: { count: { label: 'Count', type: 'count', sql: 'id' } },
  dimensions: Object.fromEntries(['id', 'd'].map((n) => [n, { label: n, type: 'string', sql: n }])),
} as unknown as Cube;

/** `d`: a value on 1 and 2, null on 3, absent on 4. */
const ROWS = [{ id: '1', d: 'v1' }, { id: '2', d: 'v2' }, { id: '3', d: null }, { id: '4' }];

async function setup() {
  const driver = new InMemoryDriver({});
  await driver.connect();
  for (const row of ROWS) await driver.create('arr_row', { ...(row as Record<string, unknown>) });
  return new MemoryAnalyticsService({ driver, cubes: [CUBE] });
}

const cubeQuery = (where?: unknown) =>
  ({ cube: 'arr', measures: ['count'], dimensions: ['id'], ...(where === undefined ? {} : { where }) }) as any;

/** The cube's rows and the echo's WHERE, for one `where`. */
async function answer(where?: unknown) {
  const service = await setup();
  return {
    rows: ids((await service.query(cubeQuery(where))).rows),
    echo: whereOf((await service.generateSql(cubeQuery(where))).sql),
  };
}

/** Both exits refuse `where` in the ADR-0112 `INVALID_FILTER` / 400 envelope. */
async function expectRefusedOnBothExits(where: unknown) {
  const service = await setup();
  for (const [exit, run] of [
    ['query', () => service.query(cubeQuery(where))],
    ['generateSql', () => service.generateSql(cubeQuery(where))],
  ] as const) {
    await expect(run(), `${exit}: ${JSON.stringify(where)} must be refused`).rejects.toMatchObject({
      code: 'INVALID_FILTER',
      status: 400,
    });
  }
}

describe('the cube face lowers the FilterArray spelling of `where`', () => {
  it("the card's row: [['d','=','v1']] answers the object spelling's rows, and the echo carries its WHERE", async () => {
    const array = await answer([['d', '=', 'v1']]);
    const object = await answer({ d: 'v1' });
    // Soft, so a red run reports BOTH halves of the card's reading — the rows
    // and the echo — rather than stopping at the first.
    expect.soft(array.rows).toEqual(['1']);
    expect.soft(array.rows).toEqual(object.rows);
    expect.soft(array.echo).toBe("d = 'v1'");
    expect.soft(array.echo).toBe(object.echo);
  });

  // Each row is one FilterArray spelling next to the FilterCondition it lowers
  // to. Both are fed to the face; they must answer the same rows and echo the
  // same WHERE — the array meets the comparand doors, the shared lowering and
  // the vocabulary gate exactly as the object spelling does.
  const SPELLINGS: Array<[string, unknown, unknown, string[]]> = [
    ['a bare comparison', ['d', '=', 'v1'], { d: 'v1' }, ['1']],
    ['a flat list (implicit AND)', [['d', '!=', 'v1'], ['d', '!=', 'v2']], { $and: [{ d: { $ne: 'v1' } }, { d: { $ne: 'v2' } }] }, ['3', '4']],
    ['an "and" group', ['and', ['id', '!=', '1'], ['d', 'in', ['v1', 'v2']]], { $and: [{ id: { $ne: '1' } }, { d: { $in: ['v1', 'v2'] } }] }, ['2']],
    ['an "or" group', ['or', ['d', '=', 'v1'], ['d', '=', 'v2']], { $or: [{ d: 'v1' }, { d: 'v2' }] }, ['1', '2']],
    // A negative-polarity leaf: the shared lowering puts the NULL escape
    // around it on this spelling as on the other.
    ['a negative-polarity leaf', [['d', '!=', 'v1']], { d: { $ne: 'v1' } }, ['2', '3', '4']],
    // The null predicate takes its direction from the operator NAME.
    ['is_null', [['d', 'is_null']], { d: { $null: true } }, ['3', '4']],
    ['is_not_null', [['d', 'is_not_null']], { d: { $null: false } }, ['1', '2']],
  ];
  for (const [label, array, object, expected] of SPELLINGS) {
    it(`${label}: ${JSON.stringify(array)} answers ${JSON.stringify(object)}'s rows and echo`, async () => {
      const a = await answer(array);
      const o = await answer(object);
      expect(a.rows).toEqual(expected);
      expect(a.rows).toEqual(o.rows);
      expect(a.echo).toBeDefined();
      expect(a.echo).toBe(o.echo);
    });
  }

  it('CONTROL: `[]` is "no filter" — every row and no WHERE, as with no `where` at all', async () => {
    const empty = await answer([]);
    const none = await answer();
    expect(empty.rows).toEqual(['1', '2', '3', '4']);
    expect(empty.rows).toEqual(none.rows);
    expect(empty.echo).toBeUndefined();
    expect(none.echo).toBeUndefined();
  });
});

describe('an array the face cannot lower is refused on both exits — never every row', () => {
  // Not a FilterArray at all: `isFilterAST` refuses the shape before
  // `parseFilterAST`'s lenient fallback can read it.
  const NOT_LOWERABLE: Array<[string, unknown]> = [
    ['the infix join', [['d', '=', 'v1'], 'or', ['d', '=', 'v2']]],
    ['an operator outside the vocabulary', [['d', 'sounds_like', 'v1']]],
    ['a list of scalars', [1, 2, 3]],
    ['a cube-style entry list', [{ member: 'd', operator: 'equals', values: ['v1'] }]],
  ];
  for (const [label, where] of NOT_LOWERABLE) {
    it(`${label}: ${JSON.stringify(where)}`, async () => {
      await expectRefusedOnBothExits(where);
    });
  }

  // Lowerable, but the lowered condition carries what the shared doors or this
  // face's gate refuse — refused as the object spelling of the same condition
  // is (the CONTROL half of each row).
  const REFUSED_AS_OBJECT: Array<[string, unknown, unknown]> = [
    ['a scalar "in" comparand', [['d', 'in', 'v1']], { d: { $in: 'v1' } }],
    ['an undefined comparand', [['d', '=', undefined]], { d: undefined }],
    ['an operator this face does not compile', [['d', 'starts_with', 'v']], { d: { $startsWith: 'v' } }],
  ];
  for (const [label, array, object] of REFUSED_AS_OBJECT) {
    it(`${label}: ${JSON.stringify(array)} is refused, as ${JSON.stringify(object)} is`, async () => {
      await expectRefusedOnBothExits(array);
      await expectRefusedOnBothExits(object);
    });
  }
});
