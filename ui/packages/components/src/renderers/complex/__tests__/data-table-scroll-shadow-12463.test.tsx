/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12463 — the table's own scroll box, its sticky columns, and the
 * right-edge scroll shadow.
 *
 * The box is the bounded scroller for both axes (`flex-1 min-h-0
 * overflow-auto`); the leading cell and the first data column stick on the
 * left, the right-pinned (row-actions) column on the right; a shadow is drawn
 * while `scrollLeft + clientWidth < scrollWidth` and gone at the far right.
 *
 * jsdom does no layout, so the box's scroll geometry is stubbed on the
 * element and a `scroll` event re-reads it, which is what the browser does.
 * The layout itself (rows scrolling under a sticky header, the footer in
 * view) was read in a real browser and is reported on the pull request.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

const HEADER_WIDTHS = [40, 160, 140, 120, 64];

const originalGetRect = HTMLElement.prototype.getBoundingClientRect;

function rect(width: number): DOMRect {
  return { width, height: 40, top: 0, left: 0, bottom: 40, right: width, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

function renderTable(schema: Record<string, unknown>) {
  const DataTable = ComponentRegistry.get('data-table') as React.ComponentType<{ schema: unknown }>;
  if (!DataTable) throw new Error('data-table not registered');
  return render(<DataTable schema={schema} />);
}

const ROWS = Array.from({ length: 50 }, (_, i) => ({
  id: String(i + 1), code: `C-${i + 1}`, product: `P-${i + 1}`, island: `I-${i + 1}`, act: '',
}));

const baseSchema = {
  data: ROWS,
  pagination: false,
  searchable: false,
  showRowNumbers: true,
  frozenColumns: 1,
  columns: [
    { header: 'Code', accessorKey: 'code', width: 160 },
    { header: 'Product', accessorKey: 'product', width: 140 },
    { header: 'Island', accessorKey: 'island', width: 120 },
    // The auto-pinned row-actions column, as `ObjectGrid` hands it down.
    { header: 'Actions', accessorKey: 'act', className: 'sticky right-0 z-10 bg-background border-l', cellClassName: 'sticky right-0 z-10 bg-background border-l' },
  ],
};

/** Stub the scroll geometry a browser would report for the box (a 12px vertical scrollbar). */
function setGeometry(box: HTMLElement, g: { scrollLeft: number; scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(box, 'scrollWidth', { configurable: true, value: g.scrollWidth });
  Object.defineProperty(box, 'clientWidth', { configurable: true, value: g.clientWidth });
  Object.defineProperty(box, 'offsetWidth', { configurable: true, value: g.clientWidth + 12 });
  Object.defineProperty(box, 'clientHeight', { configurable: true, value: 600 });
  Object.defineProperty(box, 'offsetHeight', { configurable: true, value: 600 });
  box.scrollLeft = g.scrollLeft;
  act(() => { fireEvent.scroll(box); });
}

describe('data-table scroll box, sticky columns and right-edge shadow (objectui#12463)', () => {
  beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.tagName === 'TH' && this.parentElement) {
        const index = Array.prototype.indexOf.call(this.parentElement.children, this);
        return rect(HEADER_WIDTHS[index] ?? 100);
      }
      return originalGetRect.call(this);
    });
  });
  afterAll(() => { vi.restoreAllMocks(); });

  it('the box is the bounded scroller for both axes, with the header sticky inside it', () => {
    const { getByTestId, container } = renderTable(baseSchema);
    const box = getByTestId('data-table-scroll-box');
    expect(box).toHaveClass('flex-1', 'min-h-0', 'overflow-auto');
    // Its parent is the flex column that hands it the bounded height.
    expect(box.parentElement).toHaveClass('flex', 'flex-col', 'flex-1', 'min-h-0');
    expect(container.querySelector('thead')).toHaveClass('sticky', 'top-0');
    expect(box.querySelectorAll('tbody tr')).toHaveLength(50);
    // The never-visible static inset shadow is gone; the overlay replaces it.
    expect(box.className).not.toMatch(/shadow-\[inset/);
  });

  it('pins the leading cell and the first data column left, and the actions column right', () => {
    const { container } = renderTable(baseSchema);
    const cells = Array.from(container.querySelectorAll('tbody tr')[0].children) as HTMLElement[];
    expect(cells[0]).toHaveClass('sticky');
    expect(cells[1]).toHaveClass('sticky');
    expect(cells[1].style.left).toBe('40px');
    expect(cells[2]).not.toHaveClass('sticky');
    expect(cells[cells.length - 1]).toHaveClass('sticky', 'right-0');
    const headCells = Array.from(container.querySelectorAll('thead th')) as HTMLElement[];
    expect(headCells[headCells.length - 1]).toHaveClass('sticky', 'right-0');
  });

  it('draws the shadow at the seam before the pinned column while columns remain, none at the end', () => {
    const { getByTestId, queryByTestId } = renderTable(baseSchema);
    const box = getByTestId('data-table-scroll-box');
    // Nothing overflows yet: no shadow.
    expect(queryByTestId('data-table-scroll-shadow-right')).toBeNull();

    setGeometry(box, { scrollLeft: 0, scrollWidth: 1400, clientWidth: 700 });
    const shadow = getByTestId('data-table-scroll-shadow-right');
    expect(shadow).toHaveClass('pointer-events-none', 'absolute');
    expect(shadow).toHaveAttribute('aria-hidden', 'true');
    // Clear of the box's 12px vertical scrollbar, plus the pinned actions
    // header (64): the seam where the content slides under the pinned column.
    expect(shadow.style.right).toBe('76px');
    expect(shadow.style.bottom).toBe('0px');
    // A sibling of the box, not a child: it must not scroll with the content.
    expect(shadow.parentElement).toBe(box.parentElement);

    setGeometry(box, { scrollLeft: 300, scrollWidth: 1400, clientWidth: 700 });
    expect(queryByTestId('data-table-scroll-shadow-right')).not.toBeNull();

    setGeometry(box, { scrollLeft: 700, scrollWidth: 1400, clientWidth: 700 });
    expect(queryByTestId('data-table-scroll-shadow-right')).toBeNull();
  });

  it('a grouped sub-table (disableInnerScroll) has no own scroller and draws no shadow', () => {
    const { getByTestId, queryByTestId } = renderTable({ ...baseSchema, disableInnerScroll: true });
    const box = getByTestId('data-table-scroll-box');
    expect(box).toHaveClass('overflow-visible');
    expect(box).not.toHaveClass('overflow-auto');
    setGeometry(box, { scrollLeft: 0, scrollWidth: 1400, clientWidth: 700 });
    expect(queryByTestId('data-table-scroll-shadow-right')).toBeNull();
  });
});
