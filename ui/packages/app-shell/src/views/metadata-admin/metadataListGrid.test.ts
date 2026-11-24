// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36897 — the adapter between a type's `/meta/:type` rows and
 * `ObjectGrid`: the grid is told a schema declared from the columns (never
 * one guessed from the first row), sorts only where the list sorts, and the
 * header's sort and the list's sort round-trip.
 */

import { describe, expect, it } from 'vitest';

import {
  MetadataListSource,
  gridSortOf,
  listSortOfGrid,
  metadataListGridSchema,
  metadataListObjectSchema,
  pageWindow,
  type MetadataGridColumn,
} from './metadataListGrid';
import type { ListSortKey } from './metadataListState';

const COLUMNS: MetadataGridColumn[] = [
  { key: 'name', label: 'API name', width: '220px' },
  { key: 'label', label: 'Label', width: '30%' },
  { key: 'config.type', label: 'Type' },
  { key: '__controls', label: 'Active', pinnedRight: true },
];
const sortKeyOf = (c: MetadataGridColumn): ListSortKey | undefined =>
  c.key === 'name' ? 'name' : c.key === 'label' ? 'label' : undefined;

describe('metadataListGrid (objectstack#36897)', () => {
  it('answers the schema declared from the columns, not one guessed from the first row', async () => {
    const declared = metadataListObjectSchema('flow', 'Flow', COLUMNS);
    // The first row carries a key no column declares, and lacks a declared one.
    const source = new MetadataListSource([{ id: '0:a', c0: 'a', stray: 1 }], declared);
    const schema = await source.getObjectSchema('anything');
    expect(Object.keys(schema.fields)).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect(schema.fields.c1).toEqual({ name: 'c1', type: 'text', label: 'Label' });
    expect(schema.fields).not.toHaveProperty('stray');
    expect(schema.name).toBe('metadata_list_flow');
  });

  it("turns off the grid's search, selection, inline edit, resize and reorder; sortable only where the list sorts", () => {
    const g = metadataListGridSchema('flow', COLUMNS, sortKeyOf, 50) as any;
    expect(g).toMatchObject({
      showSearch: false,
      searchableFields: [],
      selection: { type: 'none' },
      editable: false,
      resizable: false,
      reorderableColumns: false,
      pagination: { pageSize: 50 },
    });
    expect(g.columns.map((c: any) => c.sortable)).toEqual([true, true, false, false]);
    expect(g.columns[0].width).toBe(220);
    expect(g.columns[1]).not.toHaveProperty('width');
    expect(g.columns[3].pinned).toBe('right');
    expect(g.columns.filter((c: any) => c.pinned)).toHaveLength(1);
  });

  it("round-trips the list's sort through the header's", () => {
    for (const sort of [
      { key: 'name', dir: 'asc' },
      { key: 'name', dir: 'desc' },
      { key: 'label', dir: 'desc' },
    ] as const) {
      expect(listSortOfGrid(gridSortOf(sort, COLUMNS, sortKeyOf), COLUMNS, sortKeyOf)).toEqual(sort);
    }
    // A sort the table has no header for shows no arrow; a cleared or unknown header sort is none.
    expect(gridSortOf({ key: 'updated' as ListSortKey, dir: 'asc' }, COLUMNS, sortKeyOf)).toEqual([]);
    expect(listSortOfGrid([], COLUMNS, sortKeyOf)).toBeNull();
    expect(listSortOfGrid([{ field: 'c2', order: 'asc' }], COLUMNS, sortKeyOf)).toBeNull();
  });

  it('clamps the page into range', () => {
    const rows = Array.from({ length: 53 }, (_, i) => i);
    expect(pageWindow(rows, 2, 50)).toEqual({ page: 2, rows: [50, 51, 52] });
    expect(pageWindow(rows, 9, 50).page).toBe(2);
    expect(pageWindow(rows, 0, 50).page).toBe(1);
    expect(pageWindow(rows, Number.NaN, 50).rows).toHaveLength(50);
    expect(pageWindow([], 3, 50)).toEqual({ page: 1, rows: [] });
  });
});
