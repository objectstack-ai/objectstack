/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `formatTitleTemplate` judges a placeholder EMPTY the way
 * `recordDisplayValueAt` does: trim, then empty (objectui#10446).
 *
 * ## The defect
 *
 * The template renderer tested each placeholder's raw value against `null`,
 * `undefined` and `''` on its own. A whitespace-only value passed that test, so
 * it counted as RESOLVED and was emitted. The whitespace collapse that runs
 * afterwards then removed the value but not the separator the empty-placeholder
 * pass would have stripped with it: `{contract_no} - {name}` with a blank
 * `name` rendered `HT-2026-003 -`. `getRecordDisplayName`'s `titleFormat` rung
 * returns that string, so every resolver-backed surface showed it.
 *
 * `recordDisplayValueAt`, the objectui#8350 emptiness authority, trims and calls
 * the same value empty. The two now share one implementation of that rule
 * rather than two spellings of it.
 *
 * ## What is pinned
 *
 * - THE CARD, at both doors the card measured: `formatTitleTemplate` and
 *   `getRecordDisplayName`.
 * - A real value is unchanged (the control: the fix must not drop values).
 * - Agreement, value by value: a placeholder is dropped exactly when
 *   `recordDisplayValueAt` calls its field empty, and otherwise renders what
 *   that function returns. The template has a second, always-resolved
 *   placeholder so an empty first one shows as its separator being stripped,
 *   not merely as whitespace that the final trim would hide.
 */

import { describe, it, expect } from 'vitest';
import { formatTitleTemplate, getRecordDisplayName, recordDisplayValueAt } from '../record-title';

const TEMPLATE = '{contract_no} - {name}';

describe('formatTitleTemplate — a whitespace-only placeholder is empty (#10446)', () => {
  it('THE CARD — the blank `name` drops with its separator', () => {
    expect(formatTitleTemplate(TEMPLATE, { contract_no: 'HT-2026-003', name: '   ' })).toBe('HT-2026-003');
  });

  it("THE CARD — `getRecordDisplayName`'s titleFormat rung renders the same", () => {
    expect(
      getRecordDisplayName(
        { titleFormat: TEMPLATE },
        { id: 'c3', contract_no: 'HT-2026-003', name: '   ' },
      ),
    ).toBe('HT-2026-003');
  });

  it('CONTROL — a real value is unchanged, at both doors', () => {
    const record = { id: 'c4', contract_no: 'HT-2026-003', name: 'Acme' };
    expect(formatTitleTemplate(TEMPLATE, record)).toBe('HT-2026-003 - Acme');
    expect(getRecordDisplayName({ titleFormat: TEMPLATE }, record)).toBe('HT-2026-003 - Acme');
  });

  it('a blank LEADING placeholder drops with its separator too', () => {
    expect(formatTitleTemplate(TEMPLATE, { contract_no: '  ', name: 'Acme' })).toBe('Acme');
  });
});

describe('formatTitleTemplate — a placeholder is empty exactly when `recordDisplayValueAt` says so (#10446)', () => {
  const values: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ["''", ''],
    ['spaces', '   '],
    ['no-break spaces', '  '],
    ['padded value', '  Acme  '],
    ['0', 0],
    ['false', false],
    ['expanded lookup with a name', { id: 'a1', name: 'Acme' }],
    ['expanded lookup with a blank name', { id: 'a1', name: '   ' }],
    ['bare lookup payload', { id: 'a1' }],
  ];

  for (const [label, v] of values) {
    it(`${label}`, () => {
      const shown = recordDisplayValueAt({ v }, 'v');
      const expected = shown === undefined ? 'K' : `${shown} - K`;
      expect(formatTitleTemplate('{v} - {k}', { v, k: 'K' })).toBe(expected);
    });
  }
});
