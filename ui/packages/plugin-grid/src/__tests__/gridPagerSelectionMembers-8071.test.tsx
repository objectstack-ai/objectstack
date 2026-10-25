/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The MEMBERS of `object-grid`'s two object-armed toolbar keys — `pagination`
 * and `selection` — pinned at what the RENDERER reads (objectui#8071), under
 * the ONE presence rule both keys were given by objectui#9837 (ruling A-prime,
 * batch #162 item 2): **presence enables; an explicit off wins**.
 *
 * One file for two keys because they are one read. Both are resolved in the
 * single fold that assembles `dataTableSchema`, both land on adjacent props of
 * the same `data-table` node (`pagination` / `pageSize` / `pageSizeOptions`
 * beside `selectable`), and both are the CANONICAL half of a canonical-vs-
 * deprecated pair whose precedence nothing asserted: `pagination` against the
 * flat `pageSize` / `showPagination`, `selection` against `selectable`.
 *
 * ⭐ This file's own history IS the finding objectui#9837 was filed for. As
 * objectui#8071 first pinned them, the two adjacent keys read their own
 * presence in OPPOSITE ways — `pagination` as `!== undefined` (the object's
 * presence alone enabled paging and OVERRULED `showPagination: false`) and
 * `selection` as `?.type` (the object's presence alone did nothing). Those two
 * rows are the ones objectui#9837 flipped, on purpose; they are named here
 * rather than silently rewritten, because a reader who finds the old rule in a
 * CHANGELOG or in a half-migrated page needs to know it was retired and when.
 *
 * ⛔ What a declaration can never publish, which is why each row below is a
 * behaviour rather than a restatement of the registration:
 *
 *   - **An explicit off beats the object's presence, on BOTH keys.**
 *     `showPagination: false` turns paging off beside a written `pagination`
 *     object — `pagination` declares no off switch of its own, so the
 *     deprecated flat boolean is the only one an author has. `type: 'none'`
 *     turns selection off beside anything, including the arm that auto-enables
 *     multi-select when the schema declares bulk actions: an author who writes
 *     `bulkActions: ['approve']` and `selection: { type: 'none' }` gets a grid
 *     with no checkbox in it, the bulk bar they declared can never be reached,
 *     nothing is thrown, and no diagnostic is emitted.
 *   - **Writing the object with no members is how you ask for the feature.**
 *     `selection: {}` enables selection at the default mode; it no longer falls
 *     through to the legacy `selectable` arm. ⚠️ The same clause on
 *     `pagination` is INERT today and deliberately has no row of its own:
 *     paging already defaults ON, so an authored `pagination: {}` and an absent
 *     `pagination` are indistinguishable at the pager. The observable half of
 *     the rule on that key is the explicit off, which is what is pinned.
 *   - **A deprecated key still loses to a canonical one that speaks.**
 *     `selectable: true` beside `selection: { type: 'none' }` is IGNORED, and
 *     the legacy arm is reached only when `selection` is absent entirely.
 *   - **`pageSizeOptions` REPLACES the built-in rows-per-page list, it does not
 *     extend it.** An author who adds `pageSizeOptions: [200]` to offer one
 *     larger step silently deletes 5 / 10 / 20 / 50 / 100 from the selector.
 *     The consequence is the same shape as slice 12's silent style drop: the
 *     control still renders, still works, and simply no longer offers what it
 *     offered yesterday.
 *
 * DIRECTION, predicted before running: every row is RED against the plausible
 * "improvement" of the read site it covers and green as written. The mutation
 * runs behind the objectui#9837 rows are recorded in that card's PR body.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

/** 12 rows, so a `pageSize` of 5 gives three pages and a partial last one. */
const ROWS = Array.from({ length: 12 }, (_, i) => ({
  id: String(i + 1),
  name: `Row ${String(i + 1).padStart(2, '0')}`,
  status: 'open',
}));

function renderGrid(opts: Record<string, unknown>) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'task',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'status', label: 'Status' },
    ],
    data: { provider: 'value', items: ROWS },
    ...opts,
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>,
  );
}

const bodyRows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('tbody tr'));

/** The flat pager's page readout, or `null` when no pager is rendered. */
const pageInfo = () => screen.queryByText(/^Page \d+ of \d+$/);

describe('object-grid `pagination`: presence enables, an explicit off wins (objectui#8071, objectui#9837)', () => {
  it('`pageSize` sizes the page — the member, not the row total', async () => {
    const { container } = renderGrid({ pagination: { pageSize: 5 } });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());
    expect(bodyRows(container)).toHaveLength(5);
    expect(pageInfo()).toHaveTextContent('Page 1 of 3');
  });

  it('`pagination.pageSize` WINS over the deprecated flat `pageSize`', async () => {
    // Both authored, disagreeing. A grid that read the flat key would show all
    // twelve rows on one page and render no pager at all.
    const { container } = renderGrid({ pagination: { pageSize: 5 }, pageSize: 100 });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());
    expect(bodyRows(container)).toHaveLength(5);
    expect(pageInfo()).toHaveTextContent('Page 1 of 3');
  });

  it('an explicit `showPagination: false` turns paging OFF beside the OBJECT', async () => {
    // ⭐ FLIPPED by objectui#9837. Until that ruling this row asserted the
    // opposite — the object's presence overruled the boolean, which made
    // `showPagination: false` unreachable the moment `pagination` was written:
    // a block that could not turn off the thing it names (objectui#9819).
    // `pagination` has no off member of its own, so the deprecated flat
    // boolean is the only off an author has, and it now wins.
    const { container } = renderGrid({
      pagination: { pageSize: 5 },
      showPagination: false,
    });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());
    expect(bodyRows(container)).toHaveLength(12);
    expect(pageInfo(), 'the explicit off must beat the object\'s presence').toBeNull();
  });

  it('CONTROL — the SAME off with no `pagination` object behaves identically', async () => {
    // The other half of the row above, and under objectui#9837 the point is
    // that the two halves AGREE: `showPagination: false` is honoured whether
    // or not the object is beside it. Without this row, "no pager rendered" is
    // consistent with a grid that reads neither key.
    const { container } = renderGrid({ pageSize: 5, showPagination: false });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());
    expect(bodyRows(container)).toHaveLength(12);
    expect(pageInfo()).toBeNull();
  });

  it('CONTROL — the same object WITHOUT the off still pages', async () => {
    // Non-vacuity for the two rows above: the fixture they turn off is one
    // that pages when the off is absent, so "no pager" is the boolean's doing
    // and not the fixture's.
    const { container } = renderGrid({ pagination: { pageSize: 5 }, showPagination: true });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());
    expect(bodyRows(container)).toHaveLength(5);
    expect(pageInfo()).toHaveTextContent('Page 1 of 3');
  });

  it('`pageSizeOptions` REPLACES the built-in rows-per-page list', async () => {
    renderGrid({ pagination: { pageSize: 5, pageSizeOptions: [5, 200] } });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());

    const trigger = screen.getAllByRole('combobox')[0];
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const offered = await waitFor(() => {
      const options = screen.getAllByRole('option').map((o) => o.textContent);
      expect(options.length, 'the rows-per-page dropdown never opened').toBeGreaterThan(0);
      return options;
    });
    // Exactly the authored members — the built-in 10 / 20 / 50 / 100 are GONE.
    expect(offered).toEqual(['5', '200']);
  });

  it('CONTROL — with no `pageSizeOptions` the built-in list is what is offered', async () => {
    renderGrid({ pagination: { pageSize: 5 } });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());

    const trigger = screen.getAllByRole('combobox')[0];
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const offered = await waitFor(() => {
      const options = screen.getAllByRole('option').map((o) => o.textContent);
      expect(options.length, 'the rows-per-page dropdown never opened').toBeGreaterThan(0);
      return options;
    });
    expect(offered).toEqual(['5', '10', '20', '50', '100']);
  });
});

describe('object-grid `selection`: presence enables, an explicit off wins (objectui#8071, objectui#9837)', () => {
  const paged = { pagination: { pageSize: 5 } };

  it('`multiple` renders per-row checkboxes AND the select-all header', async () => {
    renderGrid({ ...paged, selection: { type: 'multiple' } });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());
    // 5 rows on the page + the header select-all.
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
  });

  it('`single` renders per-row checkboxes and NO select-all header', async () => {
    renderGrid({ ...paged, selection: { type: 'single' } });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  });

  it('the OBJECT\'s presence enables selection with no `type` member written', async () => {
    // ⭐ FLIPPED by objectui#9837. Until that ruling the read was
    // `schema.selection?.type`, so this fixture fell straight through to the
    // legacy arms and the written object meant NOTHING — the opposite of what
    // its neighbour `pagination` taught, with nothing said either way.
    // The default mode is multiple: 5 rows on the page + the select-all header.
    renderGrid({ ...paged, selection: {} });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
  });

  it('CONTROL — the same schema WITHOUT the object renders no checkbox at all', async () => {
    // Non-vacuity for the row above: this grid declares no `selectable`, no
    // `bulkActions` and no `selection`, so every checkbox counted above is the
    // written object's doing.
    renderGrid({ ...paged });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('`none` is an explicit OFF that beats the bulk-action auto-enable', async () => {
    // `bulkActions` alone auto-enables multi-select (the row below proves it),
    // so this is the member deciding against a declaration that asks for the
    // opposite — and the author is told nothing.
    renderGrid({ ...paged, selection: { type: 'none' }, bulkActions: ['approve'] });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('CONTROL — the same schema WITHOUT the member auto-enables multi-select', async () => {
    renderGrid({ ...paged, bulkActions: ['approve'] });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
  });

  it('`none` also beats the deprecated `selectable: true`', async () => {
    renderGrid({ ...paged, selection: { type: 'none' }, selectable: true });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('CONTROL — with no `selection` object the deprecated `selectable` IS honoured', async () => {
    renderGrid({ ...paged, selectable: true });
    await waitFor(() => expect(screen.getByText('Row 01')).toBeInTheDocument());
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
  });
});
