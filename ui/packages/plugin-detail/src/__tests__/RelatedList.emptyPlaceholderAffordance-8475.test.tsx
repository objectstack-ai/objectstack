/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RelatedList`'s hand-rolled placeholder becomes the shared `EmptyValue`
 * (objectui#8475).
 *
 * ## What was wrong, and why it showed up TWICE in one column
 *
 * `makeCell` built its own placeholder — `React.createElement('span', {
 * className: 'text-muted-foreground/50 text-xs italic' }, '—')` — with no
 * `data-slot`, no `aria-label`, and none of the shared component's
 * `select-none` / `no-underline` / `pointer-events-none`.
 *
 * That branch runs FIRST and intercepts the values `isValueEmpty` recognises.
 * Anything it passes through reaches a type-aware cell renderer that has its
 * own empty branch and returns the real `EmptyValue`. Both outcomes are
 * reachable in the SAME column: an empty string takes the hand-rolled branch,
 * while an unparseable datetime is not "empty" to `isValueEmpty` at all and
 * reaches `DateTimeCellRenderer`, which draws the shared one.
 *
 * ⚠️ objectui#8475's body named `DateCellRenderer` for this, quoting `if (date
 * === null || isNaN(date.getTime())) return EmptyValue`. Measured: that line
 * is `DateTimeCellRenderer`'s. `DateCellRenderer`'s only `EmptyValue` branch is
 * `if (!value)`, which `isValueEmpty` has already intercepted, so an
 * unparseable `date` renders a formatted span and never reaches the shared
 * component. The card's conclusion holds; its attribution did not, which is
 * why this case uses `datetime`.
 *
 * So one column could show two cells that read identically to a sighted user
 * while only one of them was announced to a screen reader — and they were not
 * even typographically identical, because the hand-rolled one added `text-xs
 * italic` that the shared component does not have. `THE AGREEMENT` below is
 * that exact pair, in one column, in one render.
 *
 * ## Which cases DISCRIMINATE — MEASURED, not predicted
 *
 * The caricature was RUN, not reasoned about: `EmptyValue` returned
 * unconditionally from `makeCell`, filled cells included. All three cases go
 * red — but only ONE of them through its headline assertion.
 *
 *   - `NON-REGRESSION — a FILLED cell` refuses it directly: it asserts both
 *     that the value is present AND that no placeholder shares that cell.
 *   - `THE DEFECT` and `THE AGREEMENT` go red only because the harness waits
 *     for a real value ("Widget") to reach the table and it never arrives.
 *     That is what the control is for, and it is worth distinguishing: their
 *     headline assertions — "the empty cell has an accessible name", "the two
 *     branches draw the same thing" — are both TRUE of a list that has given
 *     up on values entirely.
 *
 * So `THE AGREEMENT` is a SCOPE DECLARATION about the visual half, kept
 * because it is the only case pinning that the `text-xs italic` treatment is
 * deliberately gone, and labelled rather than quoted as proof of the fix.
 *
 * ## The viewport is pinned on purpose (objectui#8399)
 *
 * `RelatedList` swaps the whole data-table for an `object-gallery` when
 * `useIsMobile()` is true, and a gallery renders none of these cells. Without
 * the pin every case below would assert against a surface that never ran the
 * code under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// The real data-table and its cell renderers must be registered — this pin
// reads what they DRAW, so `SchemaRenderer` is deliberately NOT mocked.
import '@object-ui/components';
import { RelatedList } from '../RelatedList';

/** Desktop. See the docblock — the mobile branch renders no table at all. */
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

function makeDataSource(fields: Record<string, unknown>, rows: any[]) {
  return {
    getObjectSchema: vi.fn(async () => ({ name: 'line', fields })),
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
  };
}

async function mountGrid(fields: Record<string, unknown>, rows: any[]) {
  const { container } = render(
    <RelatedList
      title="Lines"
      type="table"
      api="line"
      objectName="line"
      referenceField="invoice"
      parentId="INV-1"
      dataSource={makeDataSource(fields, rows) as any}
    />,
  );
  await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
  await waitFor(() => expect(container.textContent).toContain('Widget'));

  const headers = () =>
    Array.from(container.querySelectorAll('th')).map((th) => (th.textContent ?? '').trim());

  /** The cell under `header` within ONE row — never a container-wide lookup. */
  const cell = (rowIndex: number, header: string): HTMLElement => {
    const idx = headers().indexOf(header);
    expect(idx, `the ${header} column is present — headers were ${JSON.stringify(headers())}`)
      .toBeGreaterThanOrEqual(0);
    const tr = container.querySelectorAll('tbody tr')[rowIndex];
    expect(tr, `row ${rowIndex} rendered`).toBeTruthy();
    const td = tr.querySelectorAll('td')[idx];
    expect(td, `row ${rowIndex} has a cell under ${header}`).toBeTruthy();
    return td as HTMLElement;
  };
  return { headers, cell };
}

/** The shared placeholder inside ONE element, or null. */
const emptyIn = (el: HTMLElement): HTMLElement | null =>
  el.querySelector('[data-slot="empty-value"]');

const TEXT_FIELDS = {
  product: { type: 'text', label: 'Product' },
  note: { type: 'text', label: 'Note' },
};

describe('RelatedList empty cells use the shared EmptyValue (objectui#8475)', () => {
  it('THE DEFECT — an empty cell carries an accessible name', async () => {
    const { cell } = await mountGrid(TEXT_FIELDS, [
      { id: '1', product: 'Widget', note: '' },
      { id: '2', product: 'Gadget', note: 'a real note' },
    ]);
    const placeholder = emptyIn(cell(0, 'Note'));

    expect(placeholder, 'the empty cell draws the shared placeholder').not.toBeNull();
    expect(placeholder, 'and therefore has an accessible name').toHaveAttribute('aria-label');
    expect(
      (placeholder as HTMLElement).getAttribute('aria-label'),
      'the name is a word, never a naked punctuation mark',
    ).toBe('No value');
    // CONTROL — without this, a list that rendered no values at all passes above.
    expect(within(cell(1, 'Note')).queryByText('a real note'), 'CONTROL: the sibling row rendered by value')
      .not.toBeNull();
  });

  it('NON-REGRESSION — a FILLED cell renders its value and NO placeholder', async () => {
    const { cell } = await mountGrid(TEXT_FIELDS, [
      { id: '1', product: 'Widget', note: '' },
      { id: '2', product: 'Gadget', note: 'a real note' },
    ]);
    const filled = cell(1, 'Note');

    expect(within(filled).queryByText('a real note'), 'the value reaches the cell').not.toBeNull();
    // THE DISCRIMINATING HALF: red for an EmptyValue-everywhere implementation.
    expect(emptyIn(filled), 'a filled cell carries NO placeholder').toBeNull();
  });

  it('THE AGREEMENT — the two branches of ONE column now draw the identical placeholder', async () => {
    // SCOPE DECLARATION about the visual half — see the docblock. This is the
    // pair objectui#8475 described: row 0 takes `makeCell`'s own branch, row 1
    // is not empty to `isValueEmpty` and reaches `DateTimeCellRenderer`, whose
    // own empty branch has always returned the shared component.
    const { cell } = await mountGrid(
      { product: { type: 'text', label: 'Product' }, when: { type: 'datetime', label: 'When' } },
      [
        { id: '1', product: 'Widget', when: '' },
        { id: '2', product: 'Gadget', when: 'not-a-date' },
        { id: '3', product: 'Gizmo', when: '2026-01-15T09:00:00Z' },
      ],
    );
    const handRolledBranch = emptyIn(cell(0, 'When'));
    const rendererBranch = emptyIn(cell(1, 'When'));

    expect(handRolledBranch, "the list's own branch drew a placeholder").not.toBeNull();
    expect(rendererBranch, "CONTROL: the renderer's branch drew one too").not.toBeNull();
    expect(
      (handRolledBranch as HTMLElement).className,
      'two placeholders in ONE column are now typographically identical',
    ).toBe((rendererBranch as HTMLElement).className);
    expect(
      (handRolledBranch as HTMLElement).className,
      'and the retired text-xs italic treatment is gone',
    ).not.toContain('italic');
    // CONTROL — the column really does render real dates, so this is not a
    // column that gave up: a parseable value still reaches the renderer.
    expect(emptyIn(cell(2, 'When')), 'CONTROL: a parseable datetime draws NO placeholder').toBeNull();
  });
});
