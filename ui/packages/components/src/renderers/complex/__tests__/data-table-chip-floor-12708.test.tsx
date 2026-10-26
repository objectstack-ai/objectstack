/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12708 — a chip column never ellipsizes a single-word value.
 *
 * A column flagged `chips` gets a minimum width of its widest drawn chip,
 * measured once per data load; a text column keeps its width and truncates
 * first. The layout engine is stubbed the way `data-table-auto-width` stubs it:
 * a display element laid out at `max-content` is 10px per character, and every
 * cell keeps 24px around its content (its padding), so a drawn value of N
 * characters needs `N * 10 + 24` px.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

const PX_PER_CHAR = 10;
const INSET = 24;
/** What the stub reports as the per-character width: mutable, to model a re-draw that would read wider. */
let pxPerChar = PX_PER_CHAR;

const originalGetRect = HTMLElement.prototype.getBoundingClientRect;
function rect(width: number): DOMRect {
  return { width, height: 20, top: 0, left: 0, bottom: 20, right: width, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-auto-width-key') || this.parentElement?.hasAttribute('data-auto-width-key')) {
      const natural = (this.textContent ?? '').length * pxPerChar;
      return rect(this.style.width === 'max-content' ? natural : 50);
    }
    if (this.tagName === 'TD' || this.tagName === 'TH') return rect(50 + INSET);
    // A header label's row (`th > div`) spans the cell's content box.
    if (this.parentElement?.tagName === 'TH') return rect(50);
    return originalGetRect.call(this);
  });
});
afterAll(() => { vi.restoreAllMocks(); });

const DataTable = () => ComponentRegistry.get('data-table') as React.ComponentType<{ schema: unknown }>;

/** A chip cell, as `SelectCellRenderer` draws one: a badge holding the label. */
const chip = (value: unknown) => <span className="inline-flex rounded-full border px-2.5">{String(value)}</span>;

function schema(rows: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  return {
    data: rows,
    pagination: false,
    searchable: false,
    columns: [
      { header: 'Title', accessorKey: 'title', width: 80 },
      { header: 'Status', accessorKey: 'status', width: 80, chips: true, cell: chip },
    ],
    ...overrides,
  };
}

const ROWS = [
  { id: '1', title: 'A very long article title', status: 'Published' },
  { id: '2', title: 'Short', status: 'Draft' },
];

function head(container: HTMLElement, name: string): HTMLElement {
  const th = Array.from(container.querySelectorAll('thead th')).find((el) => el.textContent?.trim() === name);
  if (!th) throw new Error(`no header ${name}`);
  return th as HTMLElement;
}

describe('data-table chip columns (objectui#12708)', () => {
  it("a chip column's minimum width equals its widest chip after a data load", () => {
    const Table = DataTable();
    const { container } = render(<Table schema={schema(ROWS)} />);
    // "Published" (9 characters) is the widest chip: 9 * 10 + 24.
    const status = head(container, 'Status');
    expect(status.style.minWidth).toBe(`${9 * PX_PER_CHAR + INSET}px`);
    expect(status.style.width).toBe(`${9 * PX_PER_CHAR + INSET}px`);
    // The header ("Status", 6 characters) is not what sizes it: the floor is the chips'.
    const firstCell = container.querySelectorAll('tbody tr')[0].children[1] as HTMLElement;
    expect(firstCell.style.minWidth).toBe(`${9 * PX_PER_CHAR + INSET}px`);
  });

  it('a text column gives way before a chip column: it keeps its width and truncates', () => {
    const Table = DataTable();
    const { container } = render(<Table schema={schema(ROWS)} />);
    // Both were declared 80px, and both draw content wider than that.
    expect(head(container, 'Title').style.minWidth).toBe('80px');
    expect(head(container, 'Status').style.minWidth).toBe(`${9 * PX_PER_CHAR + INSET}px`);
  });

  it('never lowers a declared width wider than the widest chip', () => {
    const Table = DataTable();
    const wide = schema(ROWS, {
      columns: [{ header: 'Status', accessorKey: 'status', width: 200, chips: true, cell: chip }],
    });
    const { container } = render(<Table schema={wide} />);
    expect(head(container, 'Status').style.minWidth).toBe('200px');
  });

  it('is measured once per data load: a re-render of the same rows keeps the floor, new rows re-measure', () => {
    const Table = DataTable();
    const first = schema(ROWS);
    const { container, rerender } = render(<Table schema={first} />);
    expect(head(container, 'Status').style.minWidth).toBe('114px');

    // The same load, re-drawn: renaming the chip column's header changes what
    // the table drew, so the drawn sizes are read again, and the stub now
    // reads every text twice as wide. The floor does not move, because no
    // data was loaded.
    pxPerChar = PX_PER_CHAR * 2;
    rerender(<Table schema={{ ...first, columns: [first.columns[0], { ...first.columns[1], header: 'State' }] }} />);
    expect(head(container, 'State').style.minWidth).toBe('114px');

    // A new load is measured afresh, at the stub's normal reading ("In Review now", 13 characters).
    pxPerChar = PX_PER_CHAR;
    rerender(<Table schema={schema([{ id: '3', title: 'x', status: 'In Review now' }])} />);
    expect(head(container, 'Status').style.minWidth).toBe(`${13 * PX_PER_CHAR + INSET}px`);
  });

  it('CONTROL: a column without the flag is sized exactly as before', () => {
    const Table = DataTable();
    const plain = schema(ROWS, {
      columns: [{ header: 'Status', accessorKey: 'status', width: 80, cell: chip }],
    });
    const { container } = render(<Table schema={plain} />);
    expect(head(container, 'Status').style.minWidth).toBe('80px');
  });
});
