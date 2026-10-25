/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11094 — the `$empty` operator through this repo's `$`-dialect
 * lowering, and the same filter through both arms of `ValueDataSource`.
 *
 * `@objectstack/spec` 17.6.0 admitted `$empty` to `FILTER_OPERATORS`
 * (objectstack#20446) and lowers the view operators `is_empty` /
 * `is_not_empty` to it (objectstack#20570). Before this card,
 * `convertFiltersToAST` had no arm for it and threw "Unknown filter operator",
 * so an object filter carrying the canonical operator never reached the wire,
 * while `ValueDataSource` was about to execute it. That is the
 * objectui#8976 shape (`$icontains`), one operator over.
 *
 * Three facts are pinned here:
 *
 *   1. the lowering is the inverse of the spec's own `parseFilterAST`, so the
 *      node round-trips through the server's reader to the filter the author
 *      wrote;
 *   2. a flag that is not a boolean is refused in the `INVALID_FILTER` / 400
 *      envelope rather than read for its truthiness;
 *   3. one authored filter selects one row set, whether it reaches
 *      `ValueDataSource` as the object, as the lowered node, or as a stored
 *      view rule.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isFilterAST, parseFilterAST } from '@objectstack/spec/data';
import type { QueryParams } from '@object-ui/types';
import { convertFiltersToAST, toFilterNode, FilterOperatorError } from '../filter-converter';
import { ValueDataSource } from '../../adapters/ValueDataSource';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('objectui#11094 — convertFiltersToAST lowers `$empty`', () => {
  it('`$empty: true` lowers to `is_empty`, and `false` to `is_not_empty`', () => {
    // The `true` in the value slot is the placeholder `$null` and `$exists`
    // already carry: direction comes from the operator NAME.
    expect(convertFiltersToAST({ a: { $empty: true } })).toEqual(['a', 'is_empty', true]);
    expect(convertFiltersToAST({ a: { $empty: false } })).toEqual(['a', 'is_not_empty', true]);
  });

  it('round-trips through the spec\'s own reader to the filter that was written', () => {
    for (const flag of [true, false]) {
      const node = convertFiltersToAST({ a: { $empty: flag } });
      expect(isFilterAST(node)).toBe(true);
      expect(parseFilterAST(node)).toEqual({ a: { $empty: flag } });
    }
  });

  it('composes with a sibling key like every other operator', () => {
    expect(convertFiltersToAST({ a: { $empty: true }, b: 1 })).toEqual([
      'and',
      ['a', 'is_empty', true],
      ['b', '=', 1],
    ]);
  });

  it.each([['yes'], [1], [0], [null], [[]]])(
    'refuses a flag that is not a boolean — `$empty: %j`',
    (flag) => {
      let thrown: unknown;
      try {
        convertFiltersToAST({ a: { $empty: flag } });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(FilterOperatorError);
      // The envelope a refusal is read by, not merely "it threw".
      expect(thrown).toMatchObject({
        code: 'INVALID_FILTER',
        httpStatus: 400,
        operator: '$empty',
        field: 'a',
      });
      expect((thrown as Error).message).toContain('$empty');
    },
  );

  it('the unknown-operator message lists it among the supported operators', () => {
    let message = '';
    try {
      convertFiltersToAST({ a: { $definitelyNotAnOperator: 1 } });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Supported operators:[^.]*\$empty/);
  });
});

/**
 * Rows on which `$empty` and `$null` disagree: a `''` and a `[]`. On a fixture
 * without them the two operators select the same rows, and nothing here could
 * tell an emptiness test from a null test.
 */
const ROWS = [
  { id: 'full', v: 'x' },
  { id: 'blank', v: '' },
  { id: 'list', v: [] },
  { id: 'null', v: null },
  { id: 'missing' },
];

async function selectedIds(filter: unknown): Promise<string[]> {
  const ds = new ValueDataSource({ items: ROWS });
  const result = await ds.find('rows', { $filter: filter as QueryParams['$filter'] });
  return result.data.map((r) => r.id as string);
}

describe('objectui#11094 — one `$empty` filter, one row set, on every path into ValueDataSource', () => {
  it.each([
    [true, ['blank', 'list', 'null', 'missing']],
    [false, ['full']],
  ] as const)('`$empty: %s`', async (flag, expected) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const object = { v: { $empty: flag } };
    const lowered = toFilterNode(object);
    const storedRule = toFilterNode([{ field: 'v', operator: flag ? 'is_empty' : 'is_not_empty' }]);

    expect(await selectedIds(object)).toEqual(expected);
    expect(await selectedIds(lowered)).toEqual(expected);
    expect(await selectedIds(storedRule)).toEqual(expected);
    expect(warn).not.toHaveBeenCalled();
  });

  it('and none of the three is the null test it used to be', async () => {
    expect(await selectedIds({ v: { $null: true } })).toEqual(['null', 'missing']);
    expect(await selectedIds({ v: { $empty: true } })).not.toEqual(['null', 'missing']);
  });
});
