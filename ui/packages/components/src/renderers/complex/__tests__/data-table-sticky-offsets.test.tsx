/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: pinned leading cells (the checkbox / row-number cell, then the
 * frozen data columns) must stick at the CUMULATIVE MEASURED widths of the
 * cells before them, not at hardcoded 40px estimates. Bug context (titanwind-ehr#418): the
 * table's auto layout collapsed the checkbox column to its ~28px min-content
 * while the row-number cell stuck at `left: 40px`, leaving a ~12px uncovered
 * strip between them where horizontally scrolled cells showed through.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

/**
 * Header-cell widths the mocked layout reports: the leading cell, then the
 * data columns. Since objectui#12423 the checkbox and the row number share
 * that ONE leading cell; 47px (not the 40px estimate) is what proves the
 * offsets are measured.
 */
const HEADER_WIDTHS = [47, 160, 140, 120];

function mockRect(width: number): DOMRect {
  return {
    width, height: 40, top: 0, left: 0, bottom: 40, right: width, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

const originalGetRect = HTMLElement.prototype.getBoundingClientRect;

function renderTable(schema: any) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  if (!DataTable) throw new Error('data-table not registered');
  return render(<DataTable schema={schema} />);
}

const schema = {
  data: [
    { id: '1', code: 'PP-001', product: 'Tower T1', island: 'Welding' },
    { id: '2', code: 'PP-002', product: 'Tower T1', island: 'Welding' },
  ],
  pagination: false,
  searchable: false,
  selectable: true,
  showRowNumbers: true,
  frozenColumns: 1,
  columns: [
    { header: 'Code', accessorKey: 'code', width: 160 },
    { header: 'Product', accessorKey: 'product', width: 140 },
    { header: 'Island', accessorKey: 'island', width: 120 },
  ],
};

describe('data-table sticky offsets follow measured header widths', () => {
  beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.tagName === 'TH' && this.parentElement) {
          const index = Array.prototype.indexOf.call(this.parentElement.children, this);
          return mockRect(HEADER_WIDTHS[index] ?? 100);
        }
        return originalGetRect.call(this);
      },
    );
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('pins the frozen data cell at the measured width of the shared leading cell', () => {
    const { container } = renderTable(schema);

    const headCells = container.querySelectorAll('thead th');
    // The leading (select-all) header sticks at the container edge via `left-0`.
    expect(headCells[0].className).toContain('left-0');
    // First frozen data column sticks right after the MEASURED 47px leading
    // cell (a hardcoded 40px would leave a 7px overlap).
    expect((headCells[1] as HTMLElement).style.left).toBe('47px');

    const bodyCells = document.querySelectorAll('tbody tr')[0].querySelectorAll('td');
    expect(bodyCells[0].className).toContain('left-0');
    // The row number and the checkbox are in that one cell, not two.
    expect(bodyCells[0].querySelector('[role="checkbox"]')).not.toBeNull();
    expect(bodyCells[0]).toHaveTextContent('1');
    expect((bodyCells[1] as HTMLElement).style.left).toBe('47px');
  });

  it('without selection the row-number cell leads, and the frozen cell follows its measured width', () => {
    const { container } = renderTable({ ...schema, selectable: false });
    const headCells = container.querySelectorAll('thead th');
    expect(headCells[0]).toHaveTextContent('#');
    expect(headCells[0].className).toContain('left-0');
    expect((headCells[1] as HTMLElement).style.left).toBe('47px');
    const bodyCells = document.querySelectorAll('tbody tr')[0].querySelectorAll('td');
    expect(bodyCells[0].className).toContain('left-0');
    expect((bodyCells[1] as HTMLElement).style.left).toBe('47px');
  });

  it('keeps non-sticky layout untouched when nothing is frozen', () => {
    const { container } = renderTable({ ...schema, frozenColumns: 0 });
    const headCells = container.querySelectorAll('thead th');
    expect(headCells[0].className).not.toContain('sticky');
    expect(headCells[1].className).not.toContain('sticky');
    expect((headCells[1] as HTMLElement).style.left).toBe('');
  });
});
