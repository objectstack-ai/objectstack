/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4243 — the sort picker stops borrowing the FILTER whitelist, and a
 * header click stops making the view's declared sort unreachable.
 *
 * Two halves of one reported experience, per the maintainer ruling of
 * 2026-08-11 (the narrow fix — ⛔ no new `sortableFields` spec key):
 *
 *   1. `filterableFields` used to be applied to the ONE field set both
 *      builders read, so it doubled as the sort whitelist. A view declaring a
 *      two-level default sort on fields it had not also marked filterable got
 *      a sort panel that listed neither of them and rendered its rows blank —
 *      the declared sort worked on load and could be neither reproduced nor
 *      modified. The base set is now every field, narrowed per builder.
 *   2. One header click replaced the whole sort array, and the declared
 *      multi-level sort was gone for the session. A reset control puts it
 *      back, whole and in declared order.
 *
 * The fixture is the exact shape the card reports: a two-level default sort on
 * `plan_start_date` then `name`, with NEITHER field in `filterableFields`.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';

const objectDef = {
  name: 'projects',
  label: 'Projects',
  fields: {
    name: { type: 'text', label: 'Name' },
    plan_start_date: { type: 'date', label: 'Plan Start Date' },
    status: { type: 'select', label: 'Status' },
    owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
    total_amount: { type: 'formula', label: 'Total Amount' },
  },
};

// Rows matter: with an empty result set ListView renders `DataEmptyState`
// INSTEAD of the grid, and the stub below would never be handed a
// `onSortChange` to fire the header-click half through.
const ROWS = [
  { id: 'p-1', name: 'Alpha', plan_start_date: '2026-01-01', status: 'open', total_amount: 10 },
  { id: 'p-2', name: 'Beta', plan_start_date: '2026-02-01', status: 'done', total_amount: 20 },
];

const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue({ data: ROWS, total: ROWS.length }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue(objectDef),
});

const baseSchema = {
  type: 'list-view',
  objectName: 'projects',
  viewType: 'grid',
  columns: ['name', 'plan_start_date', 'status', 'owner', 'total_amount'],
} as unknown as ListViewSchema;

/** The card's reported shape: a two-level default, neither field filterable. */
const DECLARED_SORT = [
  { field: 'plan_start_date', order: 'asc' },
  { field: 'name', order: 'asc' },
];

let lastGridProps: any = null;
let prevObjectGrid: any;

beforeAll(() => {
  // plugin-grid is not a dependency of plugin-list (that would be a cycle), so
  // the header-sort half is reached through a stub `object-grid` that captures
  // what ListView hands it — the same device ListView.headerSort.test.tsx uses.
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', (props: any) => {
    lastGridProps = props;
    return <div data-testid="grid-stub" />;
  });
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});
beforeEach(() => { lastGridProps = null; });
afterEach(() => { cleanup(); lastGridProps = null; });

async function renderList(overrides: Record<string, unknown>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource as any}>
      <ListView schema={{ ...baseSchema, ...overrides } as ListViewSchema} dataSource={dataSource as any} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
  return dataSource;
}

async function openSortPanel() {
  fireEvent.click(screen.getByRole('button', { name: /^sort/i }));
  await screen.findByText('Sort Records');
}

async function openFilterPanel() {
  fireEvent.click(screen.getByRole('button', { name: /^filter/i }));
  await screen.findByText('Filter Records');
}

/**
 * The popover body around a panel heading.
 *
 * Every query below is scoped through this rather than through `screen`: the
 * toolbar and the pagination bar own comboboxes too, so a global
 * `getAllByRole('combobox')` would silently index into the wrong control the
 * first time either grows one.
 */
function panel(heading: string): HTMLElement {
  const dialog = screen.getByText(heading).closest('[role="dialog"]');
  if (!dialog) throw new Error(`no popover content around "${heading}"`);
  return dialog as HTMLElement;
}

/**
 * The field <Select> triggers inside the sort panel, in row order.
 *
 * SortBuilder renders each row as `[field select, direction select]`, so the
 * field pickers are the even-indexed comboboxes of that panel.
 */
function sortRowTriggers(): HTMLElement[] {
  return within(panel('Sort Records'))
    .getAllByRole('combobox')
    .filter((_, i) => i % 2 === 0);
}

/** Labels a <Select> offers (Radix renders its items only once opened). */
async function optionsOf(trigger: HTMLElement): Promise<string[]> {
  fireEvent.click(trigger);
  const listbox = await screen.findByRole('listbox');
  const labels = within(listbox)
    .getAllByRole('option')
    .map((o) => o.textContent?.trim() ?? '');
  // Close again so a following open finds exactly one listbox.
  fireEvent.keyDown(listbox, { key: 'Escape' });
  return labels;
}

const lastFindParams = (ds: any) => ds.find.mock.calls[ds.find.mock.calls.length - 1][1];

describe('objectui#4243 part 1 — the sort picker no longer reuses `filterableFields`', () => {
  it('offers a field the view did NOT mark filterable, and renders its declared rows by name', async () => {
    await renderList({ sort: DECLARED_SORT, filterableFields: ['status'] });
    await openSortPanel();

    const rows = sortRowTriggers();
    expect(rows).toHaveLength(2);

    // The dropdown offers every non-relation, materialised field — not the
    // one-element `filterableFields` whitelist. This is the assertion that
    // goes red with the fix reverted: it read `['Status']`.
    expect(await optionsOf(rows[0])).toEqual(['Name', 'Plan Start Date', 'Status']);

    // …and because the fields are now IN the picker, Radix can resolve the
    // rows' selected values to labels. Blank triggers here are the card's
    // "sort rows render with blank field names", verbatim.
    expect(rows[0]).toHaveTextContent('Plan Start Date');
    expect(rows[1]).toHaveTextContent('Name');
  });

  it('withholds a `formula` field — the server refuses to order by one (400)', async () => {
    // No `filterableFields` at all, so the widened base set is the ONLY thing
    // deciding this: before the fix the unwhitelisted set already contained
    // every field, and `Total Amount` was offered here.
    //
    // objectstack `packages/metadata-protocol/src/protocol.ts`
    // `UNMATERIALIZED_SORT_TYPES` — a formula value is computed on read, no
    // driver materialises a column for it, and since objectstack#6994 a sort
    // naming one is a hard 400.
    await renderList({ sort: [{ field: 'name', order: 'asc' }] });
    await openSortPanel();

    const options = await optionsOf(sortRowTriggers()[0]);
    expect(options).not.toContain('Total Amount');
    expect(options).toEqual(['Name', 'Plan Start Date', 'Status']);
  });

  it('keeps a `formula` field the CURRENT sort already uses, so the row can be removed', async () => {
    // Withholding it outright would render a blank row the user cannot edit —
    // the very defect part 1 fixes, re-introduced by the formula rule.
    await renderList({ sort: [{ field: 'total_amount', order: 'asc' }] });
    await openSortPanel();

    const rows = sortRowTriggers();
    expect(await optionsOf(rows[0])).toContain('Total Amount');
    expect(rows[0]).toHaveTextContent('Total Amount');
  });

  it('applies the relational rule to the WIDENED set — and now explains the omission', async () => {
    // Not a control, though it started life labelled as one: reverse
    // verification put it RED, and the reason is worth pinning.
    //
    // The relational exclusion is unchanged, but the HINT that explains it used
    // to be gated by the whitelist too — `Owner` is not in `filterableFields`,
    // so before this change it never entered the loop, nothing was recorded as
    // withheld, and the panel offered `Status` alone with no word about why.
    // The user saw a near-empty picker and no explanation. Now `Owner` reaches
    // the relational rule, is withheld by it, and says so.
    //
    // The green-both-sides control for the relational rule itself is the
    // pre-existing ListView.relationalSort.test.tsx, whose fixture declares no
    // `filterableFields` and is therefore blind to this interaction.
    await renderList({ sort: DECLARED_SORT, filterableFields: ['status'] });
    await openSortPanel();

    expect(await optionsOf(sortRowTriggers()[0])).not.toContain('Owner');
    expect(screen.getByTestId('sort-relational-info')).toHaveAttribute('title', expect.stringMatching(/can only be sorted by the stored ID/i));
  });

  it('INVERTED (objectui#13118) — the FILTER builder no longer honours the retired `filterableFields`', async () => {
    // This row was the CONTROL "the FILTER builder still honours
    // `filterableFields`", and the dropdown offered `['Status']` alone. The
    // spec retired the key (objectstack#24640, ruling C) and no per-view
    // whitelist replaces it, so the filter panel offers every readable field
    // whatever the stored view still carries — no wider than the sort picker's
    // base set, which part 1 above already widened.
    await renderList({ sort: DECLARED_SORT, filterableFields: ['status'] });
    await openFilterPanel();

    // A fresh condition defaults to `fields[0]`: the view's first column, not
    // the retired key's only member.
    const fp = panel('Filter Records');
    fireEvent.click(within(fp).getByRole('button', { name: /add filter/i }));
    const fieldTrigger = within(fp).getByText('Name').closest('button');
    expect(fieldTrigger).not.toBeNull();

    expect(await optionsOf(fieldTrigger as HTMLElement)).toEqual(['Name', 'Plan Start Date', 'Status', 'Owner', 'Total Amount']);
  });
});

describe('objectui#4243 part 2 — reset to the view\'s declared sort', () => {
  it('restores the two-level default, in declared order, after a header click flattened it', async () => {
    const ds = await renderList({ sort: DECLARED_SORT, filterableFields: ['status'] });
    await waitFor(() => expect(typeof lastGridProps?.onSortChange).toBe('function'));

    // One header click — the card's trigger.
    await act(async () => {
      lastGridProps.onSortChange([{ field: 'status', order: 'desc' }]);
    });
    await waitFor(() => {
      expect(lastFindParams(ds).$orderby).toEqual([{ field: 'status', order: 'desc' }]);
    });

    await openSortPanel();
    const reset = screen.getByTestId('sort-reset-default');
    expect(reset).toBeEnabled();
    fireEvent.click(reset);

    // The whole declared array is back — both levels, in the declared order.
    // Restoring only the first level, or merely clearing the sort, fails here.
    await waitFor(() => {
      expect(lastFindParams(ds).$orderby).toEqual([
        { field: 'plan_start_date', order: 'asc' },
        { field: 'name', order: 'asc' },
      ]);
    });
    expect(sortRowTriggers()).toHaveLength(2);
  });

  it('is disabled while the active sort already IS the declared one', async () => {
    // Discoverable (the ruling asks for that) but inert — it says "you are at
    // the default" rather than vanishing and raising the question again.
    await renderList({ sort: DECLARED_SORT, filterableFields: ['status'] });
    await openSortPanel();

    expect(screen.getByTestId('sort-reset-default')).toBeDisabled();
  });

  it('is hidden when the view declares no sort — there is no default to return to', async () => {
    // A bare `queryByTestId(...)` toBeNull() here would be green on the
    // unfixed code too, for the empty reason that no such control exists at
    // all. The contrast is what makes it an assertion: SAME header click, one
    // fixture declaring a sort and one not, opposite outcomes.
    await renderList({ filterableFields: ['status'] });
    await waitFor(() => expect(typeof lastGridProps?.onSortChange).toBe('function'));
    await act(async () => {
      lastGridProps.onSortChange([{ field: 'status', order: 'desc' }]);
    });

    await openSortPanel();
    // Even with an ad-hoc sort active — i.e. one that DIFFERS from the (empty)
    // declaration — nothing was made unreachable, and a control under this
    // label that merely cleared the sort would be a second, differently-named
    // way to do what removing the rows already does.
    expect(screen.queryByTestId('sort-reset-default')).toBeNull();

    cleanup();
    // `lastGridProps` still points at the unmounted tree's props, and its
    // `onSortChange` is a live closure over dead state — the `waitFor` below
    // would pass on the stale value and drive the wrong component. Only the
    // full-suite run exposed it; in isolation the timing happened to hide it.
    lastGridProps = null;

    // Same click, a view that DOES declare a sort: the control is there.
    await renderList({ sort: DECLARED_SORT, filterableFields: ['status'] });
    await waitFor(() => expect(typeof lastGridProps?.onSortChange).toBe('function'));
    await act(async () => {
      lastGridProps.onSortChange([{ field: 'status', order: 'desc' }]);
    });

    await openSortPanel();
    expect(screen.getByTestId('sort-reset-default')).toBeEnabled();
  });

  it('CONTROL — the header click itself still replaces the whole sort array', async () => {
    // The ruling adds a way back; it does not change the click's semantics.
    const ds = await renderList({ sort: DECLARED_SORT, filterableFields: ['status'] });
    await waitFor(() => expect(typeof lastGridProps?.onSortChange).toBe('function'));

    await act(async () => {
      lastGridProps.onSortChange([{ field: 'status', order: 'desc' }]);
    });

    await waitFor(() => {
      expect(lastFindParams(ds).$orderby).toEqual([{ field: 'status', order: 'desc' }]);
    });
  });
});
