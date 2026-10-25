/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * [#6455] The toolbar sort picker LISTS a platform-refused field it must never
 * PERSIST.
 *
 * #6108 gave the picker the served sortability signal (objectstack#10235
 * ruling A) for the RENDER leg — "should this control be offered?" — and kept
 * one deliberate exception: a field the CURRENT sort already names stays
 * listed, because that is the only way a user can REMOVE a sort the server
 * refuses outright. Withholding it unconditionally renders a blank row nobody
 * can delete.
 *
 * The picker then rendered and emitted from the SAME array. So an edit to a
 * DIFFERENT part of the sort — a second key, a direction, a reset — re-emitted
 * the refused entry, and the host stored it (then through
 * `persistViewPatch({ sort })`, the toolbar's view write, retired in
 * objectui#12504; today on the user's own list state): a personalization write
 * storing a column the platform answers `400 INVALID_SORT` for, written by a
 * user who never touched that row.
 *
 * ## What each test is holding down
 *
 * The two halves pull in opposite directions on one array, so neither half is
 * assertable alone: "the leak is closed" is trivially satisfied by a picker
 * that lists nothing, and "the entry is still listed" is trivially satisfied
 * by the leak. Every fix-direction test below therefore sits beside a control
 * that the naive fix (filtering the array the picker renders from) would fail:
 *
 *  - LEAK (fix direction) — an unrelated edit, and a reset, write a payload
 *    with the refused entry gone.
 *  - LISTED + REMOVABLE (control) — the refused entry is still offered while
 *    in use, and removing it persists the removal.
 *  - UNCHANGED (control) — a sort with nothing refused in it persists exactly
 *    as before, and a deployment that serves NO projection is untouched.
 *
 * The host is modelled as `ObjectView` writes it — `onSortChange` → a
 * `persistSort({ sort })` spy (the console's `persistListSort`, the user's own
 * list state) — so what these tests read is the payload that reaches stored
 * state, not an intermediate array.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { attachObjectSortability } from '@object-ui/core';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';

const objectDef = {
  name: 'crm_opportunity',
  label: 'Opportunity',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'currency', label: 'Amount' },
    // The refused column. A plain stored `text` field, so no type read
    // anywhere refuses it — the refusal is the platform's and only the
    // platform's, which is what makes it the right cell for this card.
    remote_status: { type: 'text', label: 'Remote Status' },
  },
};

/**
 * The served projection: the platform's own resolver (`@objectstack/spec/api`
 * — the one the REST layer serves from), with `remote_status` set to the
 * refusal a deployment past objectstack#10235 answers with. AGREEMENT over
 * hardcoding for every other cell.
 */
function servedProjection() {
  const resolved = resolveObjectSortability(objectDef) as { fields: Record<string, any> };
  const fields: Record<string, any> = { ...resolved.fields };
  // Sanity on the base the refusal is measured against: if the resolver ever
  // stopped offering these two, the controls below would be measuring nothing.
  expect(fields.name).toEqual({ sortable: true });
  expect(fields.amount).toEqual({ sortable: true });
  fields.remote_status = { sortable: false };
  return { fields };
}

const makeDataSource = (opts: { servesSignal?: boolean } = {}) => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => {
    const schema = JSON.parse(JSON.stringify(objectDef));
    if (opts.servesSignal !== false) attachObjectSortability(schema, servedProjection());
    return schema;
  }),
});

const baseSchema: ListViewSchema = {
  type: 'list-view',
  objectName: 'crm_opportunity',
  viewType: 'grid',
  columns: ['name', 'amount', 'remote_status'] as any,
};

/**
 * Render, open the sort popover, and hand back the host's write spy.
 *
 * The spy is cleared once the popover is open, so every assertion below reads
 * the write caused by THE interaction it performs and not by anything the
 * mount happened to emit.
 */
async function openSortPopover(
  sort: Array<{ field: string; order: 'asc' | 'desc' }>,
  dsOpts: { servesSignal?: boolean } = {},
) {
  const dataSource = makeDataSource(dsOpts);
  // The host, spelled as `ObjectView` spells it: `onSortChange: persistListSort`,
  // which stores `{ sort }` on the user's own list state.
  const persistSort = vi.fn();
  render(
    <SchemaRendererProvider dataSource={dataSource as any}>
      <ListView
        schema={{ ...baseSchema, sort } as any}
        dataSource={dataSource as any}
        onSortChange={(next: any) => persistSort({ sort: next })}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /^sort/i }));
  await screen.findByText('Sort Records');
  persistSort.mockClear();
  return { persistSort };
}

/**
 * The sort payload that reached stored view state, minus `SortBuilder`'s
 * synthetic row `id` — which is a React key, never part of the contract.
 */
function persistedSort(spy: ReturnType<typeof vi.fn>) {
  expect(spy).toHaveBeenCalled();
  const last = spy.mock.calls[spy.mock.calls.length - 1][0] as { sort: any[] };
  return last.sort.map((item: any) => ({ field: item.field, order: item.order }));
}

/** Labels offered by the sort field <Select> (Radix renders them on open). */
async function sortFieldOptions(): Promise<string[]> {
  const combos = screen.getAllByRole('combobox');
  fireEvent.click(combos[0]);
  const listbox = await screen.findByRole('listbox');
  return within(listbox)
    .getAllByRole('option')
    .map((option) => option.textContent?.trim() ?? '');
}

/**
 * The X on one builder row. Scoped through the row's own "Sort by" / "Then by"
 * label, so it is that row's control and not whichever icon button the
 * toolbar happens to render first; the two <Select>s in the row are
 * `role="combobox"`, which leaves exactly one button inside it.
 */
function removeSortRow(label: 'Sort by' | 'Then by') {
  const row = screen.getByText(label).parentElement as HTMLElement;
  fireEvent.click(within(row).getByRole('button'));
}

/** "Add sort" — an edit to a DIFFERENT part of the sort than the refused row. */
function addSortRow() {
  fireEvent.click(screen.getByRole('button', { name: /add sort/i }));
}

describe('ListView sort picker — what it lists is not what it persists (#6455)', () => {
  it('drops the platform-refused entry from the write an UNRELATED edit causes', async () => {
    // A view stored before the signal existed: its sort names a column the
    // platform now answers `400 INVALID_SORT` for.
    const { persistSort } = await openSortPopover([
      { field: 'remote_status', order: 'asc' },
    ]);

    // The user adds a second sort key. They never touched the refused row.
    addSortRow();

    // The write carries the edit the user made — and nothing else. Before this
    // card it carried `remote_status` too, straight into `persistSort`.
    expect(persistedSort(persistSort)).toEqual([{ field: 'name', order: 'asc' }]);
  });

  it('keeps the refused entry LISTED while it is the current sort', async () => {
    // The control the naive fix — filtering the array the picker renders from
    // — fails. Without this the refused row renders blank and unremovable,
    // which is a worse defect than the leak.
    await openSortPopover([{ field: 'remote_status', order: 'asc' }]);

    expect(await sortFieldOptions()).toEqual(['Name', 'Amount', 'Remote Status']);
  });

  it('persists the REMOVAL when the user deletes the refused row', async () => {
    const { persistSort } = await openSortPopover([
      { field: 'remote_status', order: 'asc' },
    ]);

    removeSortRow('Sort by');

    // Listed, removable, and the removal reaches stored view state — the whole
    // point of keeping the entry visible.
    expect(persistedSort(persistSort)).toEqual([]);
  });

  it('leaves a sort with nothing refused in it exactly as it was', async () => {
    const { persistSort } = await openSortPopover([
      { field: 'amount', order: 'asc' },
    ]);

    addSortRow();

    // Both entries survive, in order: the filter is identity over a sort the
    // platform will order by.
    expect(persistedSort(persistSort)).toEqual([
      { field: 'amount', order: 'asc' },
      { field: 'name', order: 'asc' },
    ]);
  });

  it('drops the refused entry from a "reset to default" write too', async () => {
    // The third door onto the same stored `sort`. Reset restores the view's
    // DECLARED array whole — so a view whose declared sort names a refused
    // column would re-persist it on every reset.
    const { persistSort } = await openSortPopover([
      { field: 'remote_status', order: 'asc' },
    ]);

    // Diverge from the declared sort first: the reset control is deliberately
    // disabled while the active sort already equals the default.
    addSortRow();
    fireEvent.click(screen.getByTestId('sort-reset-default'));

    // The declared sort, minus what the platform refuses.
    expect(persistedSort(persistSort)).toEqual([]);
  });

  it('changes nothing where the deployment serves NO projection', async () => {
    // `undefined` is "no signal served", not "nothing is sortable": a
    // deployment older than objectstack#10235, or an inline/mock data source.
    // There is no verdict to filter by, so the pre-#10235 behaviour stands —
    // this is the pre-#6455 payload, byte for byte.
    const { persistSort } = await openSortPopover(
      [{ field: 'remote_status', order: 'asc' }],
      { servesSignal: false },
    );

    addSortRow();

    expect(persistedSort(persistSort)).toEqual([
      { field: 'remote_status', order: 'asc' },
      { field: 'name', order: 'asc' },
    ]);
  });
});
