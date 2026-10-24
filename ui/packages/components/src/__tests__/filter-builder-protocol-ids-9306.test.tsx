/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The FilterBuilder dropdown speaks the protocol's operator ids (objectui#9306).
 *
 * The ruling, as amended on the card and with objectui#9559's ruling B
 * governing the existence pair:
 *
 *   1. `defaultOperators` emits the twenty `VIEW_FILTER_OPERATORS` members and
 *      nothing else — plus `exists` / `notExists`, which stay opt-in builder
 *      ids with no protocol member and are NOT folded onto the null checks.
 *   2. A stored filter carrying a camelCase id keeps loading: the spelling is
 *      folded on READ through the spec's `normalizeFilterOperator`, and the
 *      builder writes the canonical id back. A lossless read-side conversion,
 *      ⛔ not a second vocabulary.
 *   3. The corrected mapping, 22 dropdown ids onto the protocol — the table
 *      below is that mapping verbatim, and `contains` / `icontains` stay two
 *      operators (objectui#7379).
 *
 * This file pins each of those at the component. The cross-consumer half — the
 * stored predicate each id produces in every table that reads it — is
 * `filter-builder-protocol-ids-census-9306.test.ts` in `app-shell`, which can
 * see every consumer this package cannot.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  VIEW_FILTER_OPERATORS,
  normalizeFilterOperator,
  type ViewFilterOperator,
} from '@objectstack/spec/ui';
import {
  FilterBuilder,
  FILTER_BUILDER_OPERATORS,
  normalizeFilterBuilderOperator,
  type FilterBuilderOperator,
} from '../custom/filter-builder';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(_: T = true as T): void { /* compile-time only */ }

// The published type IS the protocol's union plus the two opt-in existence
// ids. Fails to compile (`tsc -p tsconfig.test.json`) if a protocol member is
// added upstream and the dropdown does not offer it, or if a camelCase id comes
// back.
expectType<Equal<FilterBuilderOperator, ViewFilterOperator | 'exists' | 'notExists'>>();

/**
 * The amendment's corrected mapping — the dropdown's 22 former ids onto the
 * id the dropdown now draws. `exists` / `notExists` map to THEMSELVES: ruling B
 * (objectui#9559) supersedes the amendment's fold onto `is_not_null` /
 * `is_null`, because on the key-presence drivers that fold would change which
 * records a stored sharing rule matches.
 */
const LEGACY_TO_PROTOCOL: ReadonlyArray<readonly [string, string]> = [
  ['equals', 'equals'],
  ['notEquals', 'not_equals'],
  ['contains', 'contains'],
  ['containsCaseInsensitive', 'icontains'],
  ['notContains', 'not_contains'],
  ['isEmpty', 'is_empty'],
  ['isNotEmpty', 'is_not_empty'],
  ['greaterThan', 'greater_than'],
  ['lessThan', 'less_than'],
  ['greaterOrEqual', 'greater_than_or_equal'],
  ['lessOrEqual', 'less_than_or_equal'],
  ['before', 'before'],
  ['after', 'after'],
  ['between', 'between'],
  ['in', 'in'],
  ['notIn', 'not_in'],
  ['startsWith', 'starts_with'],
  ['endsWith', 'ends_with'],
  ['isNull', 'is_null'],
  ['isNotNull', 'is_not_null'],
  ['exists', 'exists'],
  ['notExists', 'notExists'],
];

describe('objectui#9306 — the vocabulary the dropdown draws', () => {
  it('is the twenty protocol members plus the two opt-in existence ids, nothing else', () => {
    const drawn = [...FILTER_BUILDER_OPERATORS].sort();
    expect(drawn).toEqual([...VIEW_FILTER_OPERATORS, 'exists', 'notExists'].sort());
    // Non-vacuity: the protocol set is read, not assumed.
    expect(VIEW_FILTER_OPERATORS.length).toBeGreaterThanOrEqual(20);
  });

  it('draws exactly the right-hand column of the ruling\'s mapping', () => {
    expect([...FILTER_BUILDER_OPERATORS].sort()).toEqual(
      [...new Set(LEGACY_TO_PROTOCOL.map(([, id]) => id))].sort(),
    );
    expect(LEGACY_TO_PROTOCOL).toHaveLength(22);
  });

  it('keeps `contains` and `icontains` two operators (objectui#7379)', () => {
    expect(FILTER_BUILDER_OPERATORS).toContain('contains');
    expect(FILTER_BUILDER_OPERATORS).toContain('icontains');
    expect(normalizeFilterBuilderOperator('icontains')).not.toBe(
      normalizeFilterBuilderOperator('contains'),
    );
  });

  it('keeps `exists` / `notExists` distinct from the null checks (ruling B)', () => {
    expect(normalizeFilterBuilderOperator('exists')).toBe('exists');
    expect(normalizeFilterBuilderOperator('notExists')).toBe('notExists');
    expect(normalizeFilterBuilderOperator('exists')).not.toBe('is_not_null');
    expect(normalizeFilterBuilderOperator('notExists')).not.toBe('is_null');
  });
});

describe('objectui#9306 — the read-side fold, id by id', () => {
  it.each(LEGACY_TO_PROTOCOL)('a stored `%s` is read as `%s`', (legacy, id) => {
    expect(normalizeFilterBuilderOperator(legacy)).toBe(id);
    // …and the id the dropdown draws reads as itself: the fold is idempotent.
    expect(normalizeFilterBuilderOperator(id)).toBe(id);
  });

  it('the ONE local row exists because the spec\'s table lacks it — measured', () => {
    // The dispatch asked for this to be checked, not assumed: if the spec's
    // own normalizer ever folds it, the local row is redundant and goes
    // (objectstack-ai/objectstack#20092).
    expect(normalizeFilterOperator('containsCaseInsensitive')).toBe('containsCaseInsensitive');
    // Control: the spec's normalizer is live — it folds its own alias rows.
    expect(normalizeFilterOperator('greaterOrEqual')).toBe('greater_than_or_equal');
    // Every OTHER legacy id is the spec's fold, not a local one.
    for (const [legacy, id] of LEGACY_TO_PROTOCOL) {
      if (legacy === 'containsCaseInsensitive') continue;
      expect(normalizeFilterOperator(legacy), legacy).toBe(id);
    }
  });

  it('a spelling nothing folds comes back unchanged', () => {
    expect(normalizeFilterBuilderOperator('totally_unknown')).toBe('totally_unknown');
    // An inherited `Object.prototype` name is not a table row — neither the
    // builder's own map (a `Map`, so no prototype) nor the spec's, whose
    // normalizer answers such a key with the prototype's member rather than a
    // string. The builder keeps the spelling rather than store that.
    for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(normalizeFilterBuilderOperator(key), key).toBe(key);
    }
  });
});

/**
 * One stored row per legacy id, on a field whose bucket offers that operator,
 * with a value the row can hold. The existence pair is granted, as
 * `FilterConditionField` grants it — without the grant its row would draw no
 * label, which is the opt-in gate and not this pin's subject.
 */
const FIELDS = [
  { value: 'title', label: 'Title', type: 'text' },
  { value: 'amount', label: 'Amount', type: 'number' },
  { value: 'closed', label: 'Closed', type: 'date' },
  { value: 'stage', label: 'Stage', type: 'select', options: [{ value: 'won', label: 'Won' }] },
];

const FIELD_FOR: Record<string, string> = {
  equals: 'title',
  notEquals: 'title',
  contains: 'title',
  containsCaseInsensitive: 'title',
  notContains: 'title',
  isEmpty: 'title',
  isNotEmpty: 'title',
  greaterThan: 'amount',
  lessThan: 'amount',
  greaterOrEqual: 'amount',
  lessOrEqual: 'amount',
  before: 'closed',
  after: 'closed',
  between: 'closed',
  in: 'stage',
  notIn: 'stage',
  startsWith: 'title',
  endsWith: 'title',
  isNull: 'title',
  isNotNull: 'title',
  exists: 'title',
  notExists: 'title',
};

const VALUE_FOR = (legacy: string): unknown => {
  if (legacy === 'in' || legacy === 'notIn') return ['won'];
  if (legacy === 'between') return ['2026-01-01', '2026-02-01'];
  if (['isEmpty', 'isNotEmpty', 'isNull', 'isNotNull', 'exists', 'notExists'].includes(legacy)) return '';
  if (FIELD_FOR[legacy] === 'amount') return 5;
  if (FIELD_FOR[legacy] === 'closed') return '2026-01-01';
  return 'acme';
};

const STORED = {
  id: 'root',
  logic: 'and' as const,
  conditions: LEGACY_TO_PROTOCOL.map(([legacy]) => ({
    id: `c-${legacy}`,
    field: FIELD_FOR[legacy],
    operator: legacy,
    value: VALUE_FOR(legacy),
  })),
};

function renderStored(value: typeof STORED) {
  const onChange = vi.fn();
  const utils = render(
    <FilterBuilder
      fields={FIELDS as never}
      value={value as never}
      onChange={onChange}
      extraOperators={['exists', 'notExists']}
    />,
  );
  return { ...utils, onChange };
}

/** Each row's operator trigger text, in row order. */
function operatorLabels(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('div.col-span-4:nth-child(2) [role="combobox"]'),
  ).map((e) => e.textContent ?? '');
}

describe('objectui#9306 — a stored camelCase filter loads, and saves back canonical', () => {
  it('loads: every row names its operator, and nothing is written on render', () => {
    const { container, onChange } = renderStored(STORED);
    const labels = operatorLabels(container);
    expect(labels).toHaveLength(22);
    // No blank trigger and no raw id: each stored spelling reads as the
    // operator it is.
    expect(labels.filter((l) => l.trim() === '')).toEqual([]);
    for (const [legacy] of LEGACY_TO_PROTOCOL) expect(labels).not.toContain(legacy);
    expect(labels[LEGACY_TO_PROTOCOL.findIndex(([l]) => l === 'containsCaseInsensitive')])
      .toBe('Contains (ignore case)');
    // Opening a stored filter must not dirty the form that holds it.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('saves back: the author\'s next edit writes every row\'s CANONICAL id, and nothing else moves', () => {
    const { onChange } = renderStored(STORED);
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const written = onChange.mock.calls[0][0] as typeof STORED;

    // The 22 stored rows, then the one the edit added.
    expect(written.conditions).toHaveLength(23);
    LEGACY_TO_PROTOCOL.forEach(([legacy, id], i) => {
      expect(written.conditions[i], legacy).toEqual({
        ...STORED.conditions[i],
        operator: id,
      });
    });
    // Anti-vacuity: the write really rewrote spellings — most rows moved.
    const moved = written.conditions
      .slice(0, 22)
      .filter((c, i) => c.operator !== STORED.conditions[i].operator);
    expect(moved.length).toBe(LEGACY_TO_PROTOCOL.filter(([l, id]) => l !== id).length);
    expect(moved.length).toBeGreaterThanOrEqual(14);
  });

  it('a group already in canonical ids is written back byte-for-byte (no churn)', () => {
    const canonical = {
      ...STORED,
      conditions: STORED.conditions.map((c, i) => ({ ...c, operator: LEGACY_TO_PROTOCOL[i][1] })),
    };
    const { onChange } = renderStored(canonical);
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    const written = onChange.mock.calls[0][0] as typeof STORED;
    expect(written.conditions.slice(0, 22)).toEqual(canonical.conditions);
  });
});
