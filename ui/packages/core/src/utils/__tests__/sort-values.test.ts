/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3096 — a client-side sort must order by the string the cell shows.
 *
 * The comparators these helpers replace failed in two distinct ways on a
 * relational column: `a < b` between two `$expand`-ed record objects is always
 * false (so the comparator returned a constant and the rows were permuted into
 * a meaningless order), and `String(record)` is `"[object Object]"` (so every
 * row compared equal and the sort silently did nothing). Both are pinned below.
 */
import { describe, it, expect } from 'vitest';
import { compareCellValues, compareSortValues, getSortValue } from '../sort-values.js';

const sortBy = <T,>(rows: T[], read: (row: T) => unknown, labels?: Record<string, string>): T[] =>
  [...rows].sort((a, b) => compareCellValues(read(a), read(b), { labels }));

describe('getSortValue', () => {
  it('reduces an expanded reference record to its display name', () => {
    expect(getSortValue({ id: 'rec_7f3', name: 'Alice' })).toBe('Alice');
    expect(getSortValue({ id: 'rec_001', full_name: 'Bob Lin' })).toBe('Bob Lin');
    expect(getSortValue({ id: 'rec_002', title: 'Q3 Renewal' })).toBe('Q3 Renewal');
  });

  it('maps a raw foreign-key id through the client-resolved label map', () => {
    const labels = { u1: 'Carol', u2: 'Alice' };
    expect(getSortValue('u1', { labels })).toBe('Carol');
    expect(getSortValue(7, { labels: { '7': 'Dave' } })).toBe('Dave');
    // An expanded record still honours a label resolved for the same id.
    expect(getSortValue({ id: 'u2', name: 'stale' }, { labels })).toBe('Alice');
    // No entry → the raw value, never a crash.
    expect(getSortValue('u9', { labels })).toBe('u9');
  });

  it('keeps primitives in their own domain so numbers stay numeric', () => {
    expect(getSortValue(42)).toBe(42);
    expect(getSortValue(true)).toBe(true);
    expect(getSortValue('Alice')).toBe('Alice');
    expect(getSortValue(new Date('2024-03-01T00:00:00Z'))).toBe(Date.parse('2024-03-01T00:00:00Z'));
  });

  it('treats every flavour of empty as one blank value', () => {
    expect(getSortValue(null)).toBeNull();
    expect(getSortValue(undefined)).toBeNull();
    expect(getSortValue('')).toBeNull();
    expect(getSortValue(Number.NaN)).toBeNull();
    // A record with nothing name-like must NOT become the literal "Untitled" —
    // that would bunch unrelated empty records together under "U".
    expect(getSortValue({})).toBeNull();
  });

  it('joins multi-value cells the way they read', () => {
    expect(getSortValue([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }])).toBe('Alice, Bob');
    expect(getSortValue([])).toBeNull();
  });
});

describe('compareSortValues', () => {
  it('sorts blanks last ascending (so callers that negate get them first)', () => {
    expect(compareSortValues(null, 'Alice')).toBe(1);
    expect(compareSortValues('Alice', null)).toBe(-1);
    expect(compareSortValues(null, null)).toBe(0);
  });

  it('compares numbers numerically, not lexicographically', () => {
    expect(compareSortValues(9, 10)).toBeLessThan(0);
    // `numeric: true` extends that to numbers embedded in strings.
    expect(compareSortValues('Item 9', 'Item 10')).toBeLessThan(0);
  });

  it('orders booleans false before true', () => {
    expect(compareSortValues(false, true)).toBeLessThan(0);
    expect(compareSortValues(true, true)).toBe(0);
  });
});

describe('sorting a relational column (the objectui#3096 regression)', () => {
  const rows = [
    { id: '1', owner: { id: 'rec_ccc', name: 'Carol' } },
    { id: '2', owner: { id: 'rec_aaa', name: 'Alice' } },
    { id: '3', owner: { id: 'rec_bbb', name: 'Bob' } },
  ];

  it('orders expanded lookup cells by the label', () => {
    expect(sortBy(rows, (r) => r.owner).map((r) => r.owner.name)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('disagrees with id order whenever the ids are opaque', () => {
    const opaque = [
      { owner: { id: 'rec_9z', name: 'Alice' } },
      { owner: { id: 'rec_1a', name: 'Carol' } },
      { owner: { id: 'rec_4m', name: 'Bob' } },
    ];
    expect(sortBy(opaque, (r) => r.owner).map((r) => r.owner.name)).toEqual([
      'Alice',
      'Bob',
      'Carol',
    ]);
    // The old server-shaped key (bare id) produces a different, meaningless order.
    expect([...opaque].sort((a, b) => a.owner.id.localeCompare(b.owner.id)).map((r) => r.owner.name))
      .toEqual(['Carol', 'Bob', 'Alice']);
  });

  it('does not collapse to a no-op the way String(record) did', () => {
    // Every record stringifies to "[object Object]" — the old RelatedList
    // comparator therefore returned 0 for every pair and left rows untouched.
    const stringified = rows.map((r) => String(r.owner));
    expect(new Set(stringified).size).toBe(1);
    expect(sortBy(rows, (r) => r.owner).map((r) => r.id)).not.toEqual(rows.map((r) => r.id));
  });

  it('orders raw-id cells by the client-resolved labels', () => {
    const idRows = [{ owner: 'u3' }, { owner: 'u1' }, { owner: 'u2' }];
    const labels = { u1: 'Zoe', u2: 'Alice', u3: 'Mallory' };
    expect(sortBy(idRows, (r) => r.owner, labels).map((r) => labels[r.owner as keyof typeof labels]))
      .toEqual(['Alice', 'Mallory', 'Zoe']);
  });
});
