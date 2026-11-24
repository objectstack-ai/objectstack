// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata list on `ObjectGrid` (objectstack#36897, epic objectstack#36890:
 * every type's list is the same table): the adapter between a type's
 * `/meta/:type` rows and the grid.
 *
 * A metadata item is not a record of an object, so the grid is handed what it
 * needs to draw one anyway:
 *
 *  - a REAL schema — {@link metadataListObjectSchema}, one field per column,
 *    declared from the columns, never guessed from the first row (the
 *    `ValueDataSource` default) — answered by {@link MetadataListSource};
 *  - the rows of the current page, already filtered and sorted by
 *    `applyListState` (`metadataListState.ts`), the ONE implementation the
 *    detail's ‹ › order reads too, so the grid's visible order and that order
 *    cannot disagree: the grid is driven in its host mode and never re-sorts;
 *  - for each row only its key (`id`) and its column values. Everything else a
 *    cell needs — the item, its package, lock and diagnostics — the page looks
 *    up by that key (`ObjectGrid` selects by column, so nothing else would
 *    survive on the row).
 *
 * The grid's own personal columns, export, selection and inline edit are off
 * ({@link metadataListGridSchema}); the cells are the page's (`hostCells`).
 */

import { ValueDataSource } from '@object-ui/core';
import type { ObjectGridSchema, TableSortItem } from '@object-ui/types';

import type { ListSort, ListSortKey } from './metadataListState.js';

/** The fictitious object the grid is told it lists; never read or written. */
export function metadataListObjectName(type: string): string {
  return `metadata_list_${type.replace(/[^a-z0-9_]/gi, '_')}`;
}

/** One column the page shows: the list column's key, its header, and its width. */
export interface MetadataGridColumn {
  /** The column's key in the item (`name`, `config.type`, `_holderCount`) or a page column (`__source`). */
  key: string;
  label: string;
  /** A CSS width hint; only a pixel width reaches the grid. */
  width?: string;
  /** Pinned at the table's right edge (the row's controls). */
  pinnedRight?: boolean;
}

/**
 * The grid field each column is drawn under: positional, so a dotted path, a
 * leading underscore or a key spelled like the row id never reaches the grid
 * as a field name.
 */
export function metadataGridField(index: number): string {
  return `c${index}`;
}

/** The pixel width of a `'180px'` hint; a percentage or nothing gives none. */
function pixelWidth(width: string | undefined): number | undefined {
  const m = typeof width === 'string' ? /^(\d+(?:\.\d+)?)px$/.exec(width.trim()) : null;
  return m ? Number(m[1]) : undefined;
}

/**
 * The schema the grid reads for the list: one text field per column, under
 * its column's header. Every cell is drawn by the page, so the type only keeps
 * the grid from treating a column as unknown.
 */
export function metadataListObjectSchema(
  type: string,
  label: string,
  columns: readonly MetadataGridColumn[],
): { name: string; label: string; fields: Record<string, { name: string; type: 'text'; label: string }> } {
  const fields: Record<string, { name: string; type: 'text'; label: string }> = {};
  columns.forEach((c, i) => {
    const name = metadataGridField(i);
    fields[name] = { name, type: 'text', label: c.label };
  });
  return { name: metadataListObjectName(type), label, fields };
}

/** The `ValueDataSource` of the list, answering the declared schema instead of one guessed from a row. */
export class MetadataListSource<T = Record<string, unknown>> extends ValueDataSource<T> {
  private readonly declared: ReturnType<typeof metadataListObjectSchema>;
  constructor(items: T[], declared: ReturnType<typeof metadataListObjectSchema>) {
    super({ items, idField: 'id' });
    this.declared = declared;
  }
  override async getObjectSchema(_objectName: string): Promise<any> {
    return this.declared;
  }
}

/**
 * The grid schema of the list: its columns, sortable only where the list
 * sorts (the API name and the label), and none of the grid's record-list
 * extras — no search box (the page's filter row owns the term), no
 * selection, no inline edit, no export, no column resize or reorder (so no
 * personal column layout is kept), no row actions.
 */
export function metadataListGridSchema(
  type: string,
  columns: readonly MetadataGridColumn[],
  sortKeyOf: (column: MetadataGridColumn) => ListSortKey | undefined,
  pageSize: number,
): ObjectGridSchema {
  return {
    type: 'object-grid',
    objectName: metadataListObjectName(type),
    columns: columns.map((c, i) => {
      const width = pixelWidth(c.width);
      return {
        field: metadataGridField(i),
        label: c.label,
        sortable: sortKeyOf(c) !== undefined,
        resizable: false,
        ...(width ? { width } : {}),
        ...(c.pinnedRight ? { pinned: 'right' as const } : {}),
      };
    }),
    showSearch: false,
    searchableFields: [],
    selection: { type: 'none' },
    editable: false,
    resizable: false,
    reorderableColumns: false,
    pagination: { pageSize },
  };
}

/** The list's sort as the grid's header arrows read it. */
export function gridSortOf(
  sort: ListSort,
  columns: readonly MetadataGridColumn[],
  sortKeyOf: (column: MetadataGridColumn) => ListSortKey | undefined,
): TableSortItem[] {
  const index = columns.findIndex((c) => sortKeyOf(c) === sort.key);
  return index < 0 ? [] : [{ field: metadataGridField(index), order: sort.dir }];
}

/**
 * A header click back to the list's sort: the column's key, the way the grid
 * asked. A cleared sort is the list's default; a column the list does not
 * sort by is not one the grid offers.
 */
export function listSortOfGrid(
  next: readonly TableSortItem[],
  columns: readonly MetadataGridColumn[],
  sortKeyOf: (column: MetadataGridColumn) => ListSortKey | undefined,
): ListSort | null {
  const first = next[0];
  if (!first) return null;
  const index = columns.findIndex((_, i) => metadataGridField(i) === first.field);
  const key = index < 0 ? undefined : sortKeyOf(columns[index]);
  return key ? { key, dir: first.order === 'desc' ? 'desc' : 'asc' } : null;
}

/** The page of `rows` the grid shows (1-based `page`, clamped into range). */
export function pageWindow<T>(rows: readonly T[], page: number, pageSize: number): { page: number; rows: T[] } {
  const last = Math.max(1, Math.ceil(rows.length / pageSize));
  const at = Math.min(Math.max(1, Math.floor(page) || 1), last);
  return { page: at, rows: rows.slice((at - 1) * pageSize, at * pageSize) };
}

/** The page param of the list's address (the list state's own params stay `metadataListState.ts`'s). */
export const LIST_PAGE_PARAM = 'page';
