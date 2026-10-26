/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RelatedList`'s column pruning and its cell placeholder share ONE definition
 * of emptiness (objectui#8459).
 *
 * ## The two sites, and why they are the SAME question
 *
 * `pruneEmpty` drops a column when every one of its cells is empty; the
 * placeholder branch of `makeCell` draws the muted em-dash for one cell. The
 * first is defined in terms of the second — it keeps a column when `.some()`
 * cell is not empty — so a reader who can see a column has been promised it
 * holds something. That promise is only true while both spell "empty" the same
 * way.
 *
 * They did not. `isValueEmpty` trimmed strings and called `[]` empty; the cell
 * branch tested `null | undefined` alone. The gap is exactly those two extra
 * clauses, and it is visible: a column survives because *some other row* has a
 * value, and the empty row then paints a **visually blank cell** — the precise
 * UI the em-dash exists to prevent, drawn by the very function that draws `—`
 * for `null` one branch above.
 *
 * ## Why every case asserts the DOM, not the predicate
 *
 * Both halves of this bug are rendering outcomes: *which column survives* and
 * *what a surviving cell draws*. A predicate-level assertion would have been
 * green with the placeholder branch untouched, since the column list is correct
 * either way — the disagreement only becomes visible one layer down, where the
 * cell is drawn. So each case mounts the real list, lets the real data-table
 * render, and reads real `th` / `td` text.
 *
 * ## Every negative carries a control that rendered BY VALUE
 *
 * "The Note column is absent" is trivially true of a grid that rendered
 * nothing, so the pruning case also asserts that `Product` is present *and*
 * that `Widget` reached a cell. Same for every em-dash assertion: the sibling
 * row in the same column is asserted by its real value.
 *
 * ## What reddens an implementation STRICTLY WORSE than the bug
 *
 * A predicate answering EMPTY for everything prunes every column and satisfies
 * every absence assertion in this file. Two dedicated non-regression axes exist
 * so it cannot pass:
 *
 *  - `0 IS A VALUE` — an all-zero column must survive AND render `0`;
 *  - `AN OBJECT IS A VALUE` — a `location` column must render its coordinates.
 *
 * The second is also the objectui#8376 / objectui#8394 axis: it is red for a
 * wholesale delegation to the display-name authority, which answers EMPTY for
 * any object carrying no name-ish key.
 *
 * ## Why this does not delegate to `DetailSection`'s `hasCellValue`
 *
 * `hasCellValue` calls every non-null object a VALUE, and `typeof [] ===
 * 'object'`. `AN EMPTY ARRAY` below pins the opposite for this surface, because
 * `SelectCellRenderer` paints nothing for `[]` — so delegating would introduce
 * the blank cell this file exists to forbid.
 *
 * ## The viewport is pinned on purpose (objectui#8399)
 *
 * `RelatedList` swaps the whole data-table for an `object-gallery` when
 * `useIsMobile()` is true, and a gallery draws neither `th` headers nor these
 * cells. Every case below would then assert against a surface that never ran
 * the code under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// The real data-table (and its cell renderers) must be registered — this pin
// reads what they DRAW, so `SchemaRenderer` is deliberately NOT mocked.
import '@object-ui/components';
import { RelatedList } from '../RelatedList';

const EM_DASH = '—';

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

/**
 * Mount the list and hand back readers over the RENDERED grid.
 * `cell(row, header)` returns `null` when that column is absent, so a caller
 * can tell "the column was pruned" apart from "the cell drew nothing".
 */
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
  const cell = (rowIndex: number, header: string): string | null => {
    const idx = headers().indexOf(header);
    if (idx < 0) return null;
    const tr = container.querySelectorAll('tbody tr')[rowIndex];
    const td = tr?.querySelectorAll('td')[idx];
    return td ? (td.textContent ?? '') : null;
  };
  return { headers, cell };
}

const TEXT_FIELDS = {
  product: { type: 'text', label: 'Product' },
  note: { type: 'text', label: 'Note' },
};

describe('RelatedList — column pruning and the cell placeholder agree (#8459)', () => {
  it('AN ALL-WHITESPACE COLUMN IS PRUNED — and the grid still rendered by value', async () => {
    const { headers, cell } = await mountGrid(TEXT_FIELDS, [
      { id: '1', product: 'Widget', note: '   ' },
      { id: '2', product: 'Gadget', note: '' },
    ]);

    expect(headers(), 'the all-empty Note column is dropped entirely').not.toContain('Note');
    // Controls — without these, a grid that rendered nothing passes the line above.
    expect(headers(), 'CONTROL: the grid did render columns').toContain('Product');
    expect(cell(0, 'Product'), 'CONTROL: a real value reached a cell').toBe('Widget');
  });

  it('A SURVIVING WHITESPACE-ONLY CELL DRAWS THE EM-DASH', async () => {
    const { headers, cell } = await mountGrid(TEXT_FIELDS, [
      { id: '1', product: 'Widget', note: '   ' },
      { id: '2', product: 'Gadget', note: 'real note' },
    ]);

    expect(headers(), 'the column survives — one row has a value').toContain('Note');
    expect(cell(0, 'Note'), 'the whitespace-only cell draws the placeholder, not blank').toBe(EM_DASH);
    // Control: the same column rendered BY VALUE for the sibling row.
    expect(cell(1, 'Note'), 'CONTROL: the populated cell still renders its value').toBe('real note');
  });

  it('A SURVIVING EMPTY-ARRAY CELL DRAWS THE EM-DASH', async () => {
    const { headers, cell } = await mountGrid(
      {
        product: { type: 'text', label: 'Product' },
        tags: { type: 'select', label: 'Tags', multiple: true, options: [{ value: 'a', label: 'A' }] },
      },
      [
        { id: '1', product: 'Widget', tags: [] },
        { id: '2', product: 'Gadget', tags: ['a'] },
      ],
    );

    expect(headers(), 'the column survives — one row has a tag').toContain('Tags');
    expect(cell(0, 'Tags'), 'the empty array draws the placeholder, not an empty badge row').toBe(EM_DASH);
    // Control, and the NON-EMPTY-ARRAY non-regression axis in one: badges still render.
    expect(cell(1, 'Tags'), 'CONTROL: a populated array still renders its badge').toBe('A');
  });

  it('AN EMPTY STRING AND A NULL DRAW THE SAME EM-DASH', async () => {
    const { headers, cell } = await mountGrid(TEXT_FIELDS, [
      { id: '1', product: 'Widget', note: '' },
      { id: '2', product: 'Gadget', note: null },
      { id: '3', product: 'Gizmo', note: 'real note' },
    ]);

    expect(headers(), 'the column survives — one row has a value').toContain('Note');
    expect(cell(0, 'Note'), "'' draws the placeholder").toBe(EM_DASH);
    expect(cell(1, 'Note'), 'null draws the same placeholder').toBe(EM_DASH);
    expect(cell(2, 'Note'), 'CONTROL: the populated cell still renders its value').toBe('real note');
  });

  it('NON-REGRESSION — 0 IS A VALUE: an all-zero column survives and renders 0', async () => {
    const { headers, cell } = await mountGrid(
      { product: { type: 'text', label: 'Product' }, qty: { type: 'number', label: 'Qty' } },
      [
        { id: '1', product: 'Widget', qty: 0 },
        { id: '2', product: 'Gadget', qty: 0 },
      ],
    );

    // Red for any predicate that answers EMPTY for everything: it prunes this
    // column away, and the assertion below cannot find it.
    expect(headers(), '0 is a value — the column is NOT pruned').toContain('Qty');
    expect(cell(0, 'Qty'), '0 renders as 0, never as the placeholder').toBe('0');
    expect(cell(1, 'Qty'), '0 renders as 0 in every row').toBe('0');
  });

  it('NON-REGRESSION — AN OBJECT IS A VALUE: a location column renders its coordinates', async () => {
    const { headers, cell } = await mountGrid(
      { product: { type: 'text', label: 'Product' }, spot: { type: 'location', label: 'Spot' } },
      [
        { id: '1', product: 'Widget', spot: { latitude: 51.5, longitude: -0.12 } },
        { id: '2', product: 'Gadget', spot: { latitude: 40.7, longitude: -74 } },
      ],
    );

    // Red for a wholesale delegation to the display-name authority, which calls
    // an object with no name-ish key EMPTY — see the docblock.
    expect(headers(), 'an object is a value — the column is NOT pruned').toContain('Spot');
    expect(cell(0, 'Spot'), 'the type-aware renderer draws the object, not the placeholder')
      .toBe('51.5000, -0.1200');
    expect(cell(1, 'Spot'), 'every object row renders by value').toBe('40.7000, -74.0000');
  });
});
