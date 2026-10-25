/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `TableColumn.foreignKey` — the cell wrapper draws no `title` tooltip on a
 * column whose raw value is a referenced record's id (objectui#13377).
 *
 * The producer (`ObjectGrid`) draws the record's name through `cell` and sets
 * the flag; the wrapper's tooltip was `String(cellValue)`, so hovering beside
 * the drawn name showed the id. Pinned three ways in one file: the flagged
 * column has no tooltip; an ordinary column in the same table keeps its own;
 * and the SAME column with the flag absent (or `false`) carries the id, which
 * proves the flag is what withholds it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { TableColumnSchema } from '@object-ui/types/zod';
import '../data-table';

const RAW_ID = 'CASE-ID-13377';
const DRAWN = 'Printer jam';
const CONTROL = 'KA-0025';
const ROWS = [{ id: '1', title: CONTROL, source_case: RAW_ID }];

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

/** `foreignKey` undefined ⇒ the key is ABSENT from the column, not `false`. */
function renderTable(foreignKey: boolean | undefined) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  if (!DataTable) throw new Error('data-table not registered');
  return render(
    <DataTable
      schema={{
        type: 'data-table',
        data: ROWS,
        columns: [
          { header: 'Title', accessorKey: 'title' },
          // The producer's shape: it draws the record's name through `cell`.
          {
            header: 'Source Case',
            accessorKey: 'source_case',
            cell: () => DRAWN,
            ...(foreignKey === undefined ? {} : { foreignKey }),
          },
        ],
        pagination: false,
        searchable: false,
      }}
    />,
  );
}

/** The body cell under the header `label`. */
function cellUnder(label: string): HTMLElement {
  const headers = Array.from(document.querySelectorAll('thead th'));
  const index = headers.findIndex((th) => (th.textContent ?? '').trim() === label);
  expect(index, `CONTROL: a "${label}" header rendered`).toBeGreaterThanOrEqual(0);
  const cell = document.querySelector('tbody tr')?.children[index] as HTMLElement | undefined;
  expect(cell?.tagName, `CONTROL: the "${label}" body cell exists`).toBe('TD');
  return cell!;
}

describe('data-table — `foreignKey: true` draws no tooltip carrying the raw id (objectui#13377)', () => {
  it('the foreign-key cell has no `title`; the ordinary cell keeps its value as its tooltip', () => {
    renderTable(true);
    expect(
      cellUnder('Title').querySelector('[title]')?.getAttribute('title'),
      'CONTROL: an ordinary cell keeps its tooltip',
    ).toBe(CONTROL);
    const ref = cellUnder('Source Case');
    expect(ref.textContent, 'CONTROL: the producer drew the name').toContain(DRAWN);
    expect(ref.querySelector('[title]'), 'the foreign-key cell carries no tooltip').toBeNull();
    expect(document.body.innerHTML, 'the raw id is nowhere in the DOM').not.toContain(RAW_ID);
  });

  it('withholds only the tooltip: Ctrl+C still copies the raw value (unlike `masked`)', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderTable(true);
    fireEvent.keyDown(cellUnder('Source Case'), { key: 'c', ctrlKey: true });
    expect(writeText.mock.calls.map((call) => call[0])).toEqual([RAW_ID]);
  });
});

describe('data-table — the flag ABSENT keeps the tooltip (objectui#13377 control)', () => {
  it('absent: the cell carries the raw value as its tooltip, as before', () => {
    renderTable(undefined);
    expect(cellUnder('Source Case').querySelector('[title]')?.getAttribute('title')).toBe(RAW_ID);
  });

  it('`foreignKey: false` is the same as absent', () => {
    renderTable(false);
    expect(cellUnder('Source Case').querySelector('[title]')?.getAttribute('title')).toBe(RAW_ID);
  });
});

describe('`foreignKey` survives the zod mirror (objectui#13377)', () => {
  it('a parsed column keeps the flag instead of stripping it', () => {
    const parsed = TableColumnSchema.parse({ header: 'Source Case', accessorKey: 'source_case', foreignKey: true });
    expect(parsed.foreignKey).toBe(true);
    expect(TableColumnSchema.safeParse({ header: 'A', accessorKey: 'a', foreignKey: 'yes' }).success).toBe(false);
  });
});
