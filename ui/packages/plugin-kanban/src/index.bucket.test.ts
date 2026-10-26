/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Unit tests for `bucketCardsIntoColumns` — the single site that distributes
 * flat `data` + `groupBy` into per-column card arrays. Guards #2792: records
 * whose group value matches no declared column must NOT vanish; they land in
 * the trailing "Uncategorized" lane so the visible card total reconciles with
 * the record count.
 */
import { describe, it, expect, vi } from 'vitest';
import { bucketCardsIntoColumns, KANBAN_UNCOLUMNED_ID } from './index';

const columns = [
  { id: 'todo', title: 'To Do' },
  { id: 'in_progress', title: 'In Progress' },
];

describe('bucketCardsIntoColumns', () => {
  it('distributes matching records into their columns', () => {
    const data = [
      { id: '1', title: 'A', status: 'todo' },
      { id: '2', title: 'B', status: 'in_progress' },
    ];
    const result = bucketCardsIntoColumns(columns, data, 'status', undefined, 'Uncategorized');
    expect(result).toHaveLength(2);
    expect(result[0].cards.map((c: any) => c.id)).toEqual(['1']);
    expect(result[1].cards.map((c: any) => c.id)).toEqual(['2']);
  });

  it('matches by column id only (case-insensitively), never by title (objectui#10069)', () => {
    // FLIPPED: this row used to assert that a record storing the column TITLE
    // ('In Progress') landed in that column. Ruling A retired the title key,
    // so that record is now swept into "Uncategorized", while a case-variant
    // of the id still matches — the id comparison keeps its case folding.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = [
      { id: '1', title: 'A', status: 'In Progress' },
      { id: '2', title: 'B', status: 'IN_PROGRESS' },
    ];
    const result = bucketCardsIntoColumns(columns, data, 'status', undefined, 'Uncategorized');
    expect(result.find((c) => c.id === 'in_progress')!.cards.map((c: any) => c.id)).toEqual(['2']);
    expect(result.find((c) => c.id === KANBAN_UNCOLUMNED_ID)!.cards.map((c: any) => c.id)).toEqual(['1']);
    warn.mockRestore();
  });

  it('surfaces off-column records in an Uncategorized lane instead of dropping them (#2792)', () => {
    const data = [
      { id: '1', title: 'Matches', status: 'todo' },
      { id: '2', title: 'Off-column', status: 'done' }, // 'done' is no column
      { id: '3', title: 'Also off', status: 'archived' },
    ];
    const result = bucketCardsIntoColumns(columns, data, 'status', undefined, 'Uncategorized');

    // Every record is visible: the whole board's cards equal the input count.
    const total = result.reduce((n, col) => n + col.cards.length, 0);
    expect(total).toBe(data.length);

    const fallback = result.find((c) => c.id === KANBAN_UNCOLUMNED_ID);
    expect(fallback).toBeDefined();
    expect(fallback!.title).toBe('Uncategorized');
    expect(fallback!.cards.map((c: any) => c.id).sort()).toEqual(['2', '3']);
    expect(result[result.length - 1].id).toBe(KANBAN_UNCOLUMNED_ID); // trailing
  });

  it('treats empty / null group values as uncategorized rather than losing them', () => {
    const data = [
      { id: '1', title: 'No status', status: null },
      { id: '2', title: 'Empty', status: '' },
    ];
    const result = bucketCardsIntoColumns(columns, data, 'status', undefined, 'Uncategorized');
    const fallback = result.find((c) => c.id === KANBAN_UNCOLUMNED_ID);
    expect(fallback!.cards.map((c: any) => c.id).sort()).toEqual(['1', '2']);
  });

  it('adds no Uncategorized lane when every record matches a column', () => {
    const data = [{ id: '1', title: 'A', status: 'todo' }];
    const result = bucketCardsIntoColumns(columns, data, 'status', undefined, 'Uncategorized');
    expect(result.find((c) => c.id === KANBAN_UNCOLUMNED_ID)).toBeUndefined();
    expect(result).toHaveLength(2);
  });

  it('preserves static per-column cards alongside distributed data', () => {
    const withStatic = [
      { id: 'todo', title: 'To Do', cards: [{ id: 'static-1', title: 'Pinned' }] },
    ];
    const data = [{ id: '1', title: 'A', status: 'todo' }];
    const result = bucketCardsIntoColumns(withStatic, data, 'status', undefined, 'Uncategorized');
    expect(result[0].cards.map((c: any) => c.id)).toEqual(['static-1', '1']);
  });

  it('returns columns as-is (cover-mapped) when there is no groupBy', () => {
    const withCards = [{ id: 'todo', title: 'To Do', cards: [{ id: '1', title: 'A' }] }];
    const result = bucketCardsIntoColumns(withCards, undefined, undefined, undefined, 'Uncategorized');
    expect(result).toHaveLength(1);
    expect(result[0].cards).toHaveLength(1);
    expect(result.find((c) => c.id === KANBAN_UNCOLUMNED_ID)).toBeUndefined();
  });

  it('maps the cover image field onto cards (including uncategorized ones)', () => {
    const data = [
      { id: '1', title: 'A', status: 'todo', avatar: 'https://img/a.png' },
      { id: '2', title: 'B', status: 'gone', avatar: { url: 'https://img/b.png' } },
    ];
    const result = bucketCardsIntoColumns(columns, data, 'status', 'avatar', 'Uncategorized');
    expect(result.find((c) => c.id === 'todo')!.cards[0].coverImage).toBe('https://img/a.png');
    expect(result.find((c) => c.id === KANBAN_UNCOLUMNED_ID)!.cards[0].coverImage).toBe('https://img/b.png');
  });
});
