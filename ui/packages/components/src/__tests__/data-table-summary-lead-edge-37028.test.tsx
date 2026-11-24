/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The summary row's lead on the list page's one left edge (objectstack#37028).
 *
 * The defect: the record count that leads the summary row sat in the first
 * column's cell, after an empty 40px leading (selection) cell, so it started
 * at 40 + 12 = 52px while the select-all box sits 16px in (objectstack#35663).
 *
 * jsdom has no layout, so this pins the row's STRUCTURE that puts the lead on
 * the edge: where a leading cell is drawn, the first column's summary cell
 * spans it and takes the leading cell's 16px inset, so no empty cell precedes
 * the lead; the first column's figure stays in that same cell (it ends at the
 * first column's right edge, objectstack#35548). The geometry itself is
 * measured in `ui/e2e/list-left-edge-35663.spec.ts`.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { renderComponent } from './test-utils';
// Registers the renderers at module scope (objectui#3010/#3021).
import '../renderers';
// `react-page` reaches a dynamic `import('@object-ui/react-runtime')`: pay its load
// at collection, never inside a case's clocked window (`check:test-source-alias`).
import '@object-ui/react-runtime';

const columns = [
  { header: 'Name', accessorKey: 'name' },
  { header: 'Amount', accessorKey: 'amount', align: 'right' },
];
const data = [
  { id: 'r1', name: 'Alpha', amount: 3 },
  { id: 'r2', name: 'Bravo', amount: 4 },
];

const schema = (over: Record<string, unknown>) => ({
  type: 'data-table' as const,
  columns,
  data,
  pagination: false,
  summaryRow: { lead: '2 records', cells: { name: 'Filled 2', amount: '7' } },
  ...over,
}) as any;

const footerCells = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-testid="data-table-summary-row"] tr > td')) as HTMLElement[];
const headerCount = (container: HTMLElement) => container.querySelectorAll('thead tr:first-child > th').length;
const span = (td: HTMLElement) => Number(td.getAttribute('colspan') ?? 1);

describe('the summary row leads on the selection column\'s 16px inset (objectstack#37028)', () => {
  for (const [label, over] of [
    ['selection', { selectable: true }],
    ['selection, frozen first column', { selectable: true, frozenColumns: 1 }],
    ['row numbers only', { showRowNumbers: true }],
  ] as const) {
    it(`${label}: the first cell spans the leading cell and holds the lead and the first column's figure`, () => {
      const { container } = renderComponent(schema(over));
      const cells = footerCells(container);
      const first = cells[0];
      expect(first.getAttribute('data-column-key'), 'an empty cell precedes the lead').toBe('name');
      expect(span(first)).toBe(2);
      expect(first.className).toMatch(/\bpl-4\b/);
      expect(first.querySelector('[data-testid="data-table-summary-lead"]')).toHaveTextContent('2 records');
      expect(first).toHaveAttribute('data-testid', 'data-table-summary-name');
      expect(first).toHaveTextContent('Filled 2');
      // The row still covers every column once: the second column's figure
      // sits under the second column's header.
      expect(cells.reduce((n, td) => n + span(td), 0)).toBe(headerCount(container));
      expect(cells[1].getAttribute('data-column-key')).toBe('amount');
      expect(cells[1]).toHaveTextContent('7');
    });
  }

  it('frozen: the spanning cell is held at the left edge, where the leading cell was', () => {
    const { container } = renderComponent(schema({ selectable: true, frozenColumns: 1 }));
    const first = footerCells(container)[0];
    expect(first.className).toMatch(/\bsticky\b/);
    expect(first.style.left).toBe('0px');
  });

  it('no leading cell: the lead stays in the first column\'s own cell, unspanned', () => {
    const { container } = renderComponent(schema({}));
    const first = footerCells(container)[0];
    expect(first.getAttribute('data-column-key')).toBe('name');
    expect(span(first)).toBe(1);
    expect(first.className).not.toMatch(/\bpl-4\b/);
  });

  it('no lead: the leading cell is drawn empty and each figure keeps its own cell', () => {
    const { container } = renderComponent(schema({ selectable: true, summaryRow: { cells: { amount: '7' } } }));
    const cells = footerCells(container);
    expect(cells[0].getAttribute('data-column-key')).toBeNull();
    expect(cells.every((td) => span(td) === 1)).toBe(true);
    expect(cells.length).toBe(headerCount(container));
  });
});
