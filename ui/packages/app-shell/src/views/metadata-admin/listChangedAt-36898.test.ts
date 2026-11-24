// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36898 — the metadata list's 「修改时间」 and its `changed` sort:
 * a code-shipped item has no time and an empty cell, sorts after every item
 * that has one in both directions, and the detail's ‹ › order
 * (`orderedListNames`) is the order the list draws.
 */

import { describe, it, expect } from 'vitest';
import { compareChangedAt, formatChangedAt } from './listChangedAt';
import {
  applyListState,
  decodeListSort,
  encodeListSort,
  orderedListNames,
  DEFAULT_LIST_STATE,
  type ListRowReader,
  type MetadataListState,
} from './metadataListState';

interface Row {
  name: string;
  at?: string;
}

const ROWS: Row[] = [
  { name: 'shipped_a' },
  { name: 'old', at: '2026-11-01T08:00:00Z' },
  { name: 'new', at: '2026-11-24T10:15:00.000Z' },
  { name: 'shipped_b' },
  { name: 'tie_b', at: '2026-11-10T00:00:00Z' },
  { name: 'tie_a', at: '2026-11-10T00:00:00Z' },
];

const READ: ListRowReader<Row> = {
  name: (row) => row.name,
  label: () => undefined,
  matches: (row, q) => row.name.includes(q),
  source: (row) => (row.at ? 'runtime' : 'artifact'),
  changedAt: (row) => row.at,
};

const sorted = (dir: 'asc' | 'desc'): MetadataListState => ({ ...DEFAULT_LIST_STATE, sort: { key: 'changed', dir } });
const names = (rows: Row[]) => rows.map((row) => row.name);

describe('the `changed` sort (objectstack#36898)', () => {
  it('newest first; ties by name; items without a time last', () => {
    expect(names(applyListState(ROWS, sorted('desc'), READ, 'en-US'))).toEqual([
      'new', 'tie_a', 'tie_b', 'old', 'shipped_a', 'shipped_b',
    ]);
  });

  it('oldest first; items without a time still last', () => {
    expect(names(applyListState(ROWS, sorted('asc'), READ, 'en-US'))).toEqual([
      'old', 'tie_a', 'tie_b', 'new', 'shipped_a', 'shipped_b',
    ]);
  });

  it('the detail ‹ › order is the drawn order, under a filter too', () => {
    for (const state of [sorted('desc'), sorted('asc'), { ...sorted('desc'), query: 'i' }]) {
      expect(orderedListNames(ROWS, state, READ, 'en-US')).toEqual(names(applyListState(ROWS, state, READ, 'en-US')));
    }
  });

  it('a reader with no times sorts by name (control: the time is what moved them)', () => {
    const { changedAt: _ignored, ...noTimes } = READ;
    expect(names(applyListState(ROWS, sorted('desc'), noTimes, 'en-US'))).toEqual([
      'new', 'old', 'shipped_a', 'shipped_b', 'tie_a', 'tie_b',
    ]);
  });

  it('rides the address as `changed` / `-changed`', () => {
    expect(encodeListSort({ key: 'changed', dir: 'desc' })).toBe('-changed');
    expect(decodeListSort('-changed')).toEqual({ key: 'changed', dir: 'desc' });
    expect(decodeListSort('changed')).toEqual({ key: 'changed', dir: 'asc' });
  });

  it('a time that does not parse counts as none', () => {
    expect(compareChangedAt('not a time', '2026-11-01T00:00:00Z', 'desc')).toBeGreaterThan(0);
    expect(compareChangedAt(undefined, undefined, 'asc')).toBe(0);
  });
});

describe('the 「修改时间」 cell text (objectstack#36898)', () => {
  it('an item with a time shows it in the reader\'s locale; one without shows none', () => {
    const at = '2026-11-24T10:15:00.000Z';
    expect(formatChangedAt(at, 'en-US')).toBe(
      new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(Date.parse(at)),
    );
    expect(formatChangedAt(undefined, 'zh-CN')).toBeNull();
    expect(formatChangedAt('garbage', 'zh-CN')).toBeNull();
  });
});
