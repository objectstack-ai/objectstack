/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35883 / objectstack#35884 — the phone's list toolbar and its
 * sort and filter panels.
 *
 * - Below `sm` the list draws one row of pills (Sort, Filter, Search) and no
 *   condition row; a count on Sort and Filter says what is in force.
 * - The panels edit a copy of the list's sort or filter: the list changes only
 *   on 「✓」, through the same write the desktop chips call (`onSortChange`,
 *   `onFilterChange`); 「×」 drops the copy.
 * - An advanced filter (an 「or」 group) is not edited on a phone: the panel
 *   says so.
 * - 「✓」 on an untouched copy writes nothing.
 * - With the on-screen keyboard up (the visual viewport shorter than the
 *   layout one), the sheet stands on the keyboard: its bottom is the
 *   keyboard's top and its height the visible area's, less the top strip.
 *
 * "Below `sm`" is `matchMedia('(max-width: 639.98px)')` answering a match, the
 * one query `useBelowSm` asks. Provider-less, so `t()` reads the English
 * fallbacks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { SortBuilder } from '@object-ui/components';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const RECORDS = [{ id: '1', name: 'Acme', stage: 'won' }];

const SCHEMA: ListViewSchema = {
  type: 'list-view',
  objectName: 'account',
  viewType: 'grid',
  fields: ['name', 'stage'],
} as ListViewSchema;

let previousGrid: ReturnType<typeof ComponentRegistry.get>;

function stubPhone() {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((q: string) => ({
    matches: q === '(max-width: 639.98px)',
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })));
}

function mount(schema: Partial<ListViewSchema> = {}, props: Record<string, unknown> = {}) {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: RECORDS, total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: { name: { type: 'text', label: 'Name' }, stage: { type: 'text', label: 'Stage' } },
    }),
  };
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView schema={{ ...SCHEMA, ...schema } as ListViewSchema} dataSource={dataSource as never} {...props} />
    </SchemaRendererProvider>,
  );
  return dataSource;
}

beforeEach(() => {
  stubPhone();
  previousGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (previousGrid) ComponentRegistry.register('object-grid', previousGrid as any);
});

/** Open the sort panel and add a level on `field` through its field list. */
async function addSortLevel(field: string) {
  fireEvent.click(screen.getByTestId('phone-sort-chip'));
  await screen.findByTestId('phone-sort-panel');
  fireEvent.click(screen.getByTestId('sort-builder-add'));
  fireEvent.click(await screen.findByTestId(`phone-sort-add-fields-item-${field}`));
  // Back on the levels, with the new one listed.
  await waitFor(() => expect(screen.getAllByTestId('sort-builder-row')).toHaveLength(1));
}

describe('phone list toolbar (objectstack#35883)', () => {
  it('one row of pills, no condition row and no View settings button on the bar', async () => {
    mount();
    await screen.findByTestId('grid-stub');
    const bar = screen.getByTestId('phone-list-toolbar');
    expect(within(bar).getByTestId('phone-sort-chip')).toHaveAttribute('data-count', '0');
    expect(within(bar).getByTestId('phone-filter-chip')).toHaveAttribute('data-count', '0');
    expect(within(bar).getByTestId('phone-search-trigger')).toBeInTheDocument();
    expect(screen.queryByTestId('list-condition-row')).toBeNull();
    expect(screen.queryByTestId('toolbar-display-trigger')).toBeNull();
  });

  it('`userActions.sort: false` draws no Sort pill', async () => {
    mount({ userActions: { sort: false } } as Partial<ListViewSchema>);
    await screen.findByTestId('grid-stub');
    expect(screen.queryByTestId('phone-sort-chip')).toBeNull();
  });
});

describe('phone sort panel: 「✓」 applies, 「×」 discards (objectstack#35884)', () => {
  it('a level added in the panel changes nothing until 「✓」, then sorts through onSortChange', async () => {
    const onSortChange = vi.fn();
    mount({}, { onSortChange });
    await screen.findByTestId('grid-stub');

    await addSortLevel('name');
    expect(onSortChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('phone-sort-chip')).toHaveAttribute('data-count', '0');

    fireEvent.click(screen.getByTestId('phone-sort-panel-apply'));
    await waitFor(() => expect(onSortChange).toHaveBeenCalledTimes(1));
    expect(onSortChange.mock.calls[0][0]).toEqual([expect.objectContaining({ field: 'name', order: 'asc' })]);
    await waitFor(() => expect(screen.getByTestId('phone-sort-chip')).toHaveAttribute('data-count', '1'));
    expect(screen.getByTestId('phone-sort-chip-count')).toHaveTextContent('1');
  });

  it('「×」 drops the panel\'s change: no write, the count stays', async () => {
    const onSortChange = vi.fn();
    mount({}, { onSortChange });
    await screen.findByTestId('grid-stub');

    await addSortLevel('name');
    fireEvent.click(screen.getByTestId('phone-sort-panel-close'));
    // Closed (the sheet may stay mounted for its slide-out).
    await waitFor(() => {
      const panel = screen.queryByTestId('phone-sort-panel');
      expect(panel === null || panel.getAttribute('data-state') === 'closed').toBe(true);
    });
    expect(onSortChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('phone-sort-chip')).toHaveAttribute('data-count', '0');

    // Opened again, the panel starts from the list's sort, not the dropped copy.
    fireEvent.click(screen.getByTestId('phone-sort-chip'));
    await waitFor(() => expect(screen.getByTestId('phone-sort-panel')).toHaveAttribute('data-state', 'open'));
    expect(screen.queryAllByTestId('sort-builder-row')).toHaveLength(0);
  });
});

describe('phone filter panel (objectstack#35884)', () => {
  it('with no filter: a sentence and one 「Add filter」 button', async () => {
    mount();
    await screen.findByTestId('grid-stub');
    fireEvent.click(screen.getByTestId('phone-filter-chip'));
    const empty = await screen.findByTestId('phone-filter-empty');
    expect(within(empty).getByTestId('phone-filter-add')).toHaveTextContent('Add filter');
    // The phone panel offers no advanced filter step.
    fireEvent.click(within(empty).getByTestId('phone-filter-add'));
    await screen.findByTestId('phone-filter-step-fields');
    expect(screen.queryByTestId('phone-filter-step-open-advanced')).toBeNull();
  });

  it('an 「or」 group is not edited on a phone: the panel says so', async () => {
    mount({}, {
      initialFilters: {
        id: 'root',
        logic: 'or',
        conditions: [
          { id: 'a', field: 'name', operator: 'contains', value: 'Ac' },
          { id: 'b', field: 'stage', operator: 'contains', value: 'wo' },
        ],
      },
    });
    await screen.findByTestId('grid-stub');
    fireEvent.click(screen.getByTestId('phone-filter-chip'));
    expect(await screen.findByTestId('phone-filter-advanced-notice')).toHaveTextContent(
      'This view uses an advanced filter. Change it on a computer.',
    );
  });
});

describe('phone panels: an untouched 「✓」 writes nothing (objectstack#35884)', () => {
  it('sort: 「✓」 with no change does not call onSortChange', async () => {
    const onSortChange = vi.fn();
    mount({}, { onSortChange });
    await screen.findByTestId('grid-stub');
    fireEvent.click(screen.getByTestId('phone-sort-chip'));
    await screen.findByTestId('phone-sort-panel');
    fireEvent.click(screen.getByTestId('phone-sort-panel-apply'));
    await waitFor(() => {
      const panel = screen.queryByTestId('phone-sort-panel');
      expect(panel === null || panel.getAttribute('data-state') === 'closed').toBe(true);
    });
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it('filter: 「✓」 on the advanced-filter notice does not call onFilterChange', async () => {
    const onFilterChange = vi.fn();
    mount({}, {
      onFilterChange,
      initialFilters: {
        id: 'root',
        logic: 'or',
        conditions: [
          { id: 'a', field: 'name', operator: 'contains', value: 'Ac' },
          { id: 'b', field: 'stage', operator: 'contains', value: 'wo' },
        ],
      },
    });
    await screen.findByTestId('grid-stub');
    onFilterChange.mockClear();
    fireEvent.click(screen.getByTestId('phone-filter-chip'));
    await screen.findByTestId('phone-filter-advanced-notice');
    fireEvent.click(screen.getByTestId('phone-filter-panel-apply'));
    await waitFor(() => {
      const panel = screen.queryByTestId('phone-filter-panel');
      expect(panel === null || panel.getAttribute('data-state') === 'closed').toBe(true);
    });
    expect(onFilterChange).not.toHaveBeenCalled();
  });
});

describe('phone panels and the on-screen keyboard (objectstack#35884)', () => {
  /** A `visualViewport` whose height the test moves, as a keyboard would. */
  function stubVisualViewport(height: number) {
    const viewport = Object.assign(new EventTarget(), { height, offsetTop: 0, width: 390, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    return viewport;
  }

  it('stands on the keyboard while it is up, and fills the screen again once it goes', async () => {
    const full = window.innerHeight;
    const viewport = stubVisualViewport(full);
    mount();
    await screen.findByTestId('grid-stub');
    fireEvent.click(screen.getByTestId('phone-filter-chip'));
    const panel = await screen.findByTestId('phone-filter-panel');
    expect(panel, 'CONTROL: no keyboard, no inset').not.toHaveAttribute('data-keyboard-inset');

    // The keyboard comes up: 300 px of the layout viewport are covered.
    viewport.height = full - 300;
    viewport.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(panel).toHaveAttribute('data-keyboard-inset', '300'));
    expect(panel.style.bottom).toBe('300px');
    expect(panel.style.height).toBe(`${full - 300 - 40}px`);
    expect(panel.style.maxHeight).toBe(`${full - 300 - 40}px`);

    // It goes down: the sheet's own height again.
    viewport.height = full;
    viewport.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(panel).not.toHaveAttribute('data-keyboard-inset'));
    expect(panel.style.bottom).toBe('');
    expect(panel.style.height).toBe('');
  });
});

describe('SortBuilder, stacked layout (objectstack#35884)', () => {
  const FIELDS = [
    { value: 'name', label: 'Name' },
    { value: 'amount', label: 'Amount' },
  ];

  it('each level is two lines, the field over its direction', () => {
    render(<SortBuilder layout="stacked" fields={FIELDS} value={[{ id: 'a', field: 'name', order: 'desc' }]} />);
    const row = screen.getByTestId('sort-builder-row');
    expect(within(row).getByTestId('sort-builder-row-field')).toHaveTextContent('Name');
    expect(within(row).getByTestId('sort-builder-row-direction')).toHaveTextContent('Z → A');
  });

  it('a finger on the handle moves a level: dropped over the first, the second leads', () => {
    const onChange = vi.fn();
    render(
      <SortBuilder
        layout="stacked"
        fields={FIELDS}
        value={[{ id: 'a', field: 'name', order: 'asc' }, { id: 'b', field: 'amount', order: 'desc' }]}
        onChange={onChange}
      />,
    );
    const rows = screen.getAllByTestId('sort-builder-row');
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({ top: i * 56, height: 56, bottom: i * 56 + 56, left: 0, right: 300, width: 300, x: 0, y: i * 56, toJSON: () => ({}) });
    });
    const handle = within(rows[1]).getByTestId('sort-builder-handle');
    fireEvent.pointerDown(handle, { pointerType: 'touch', pointerId: 1, clientY: 84 });
    fireEvent.pointerMove(handle, { pointerType: 'touch', pointerId: 1, clientY: 10 });
    fireEvent.pointerUp(handle, { pointerType: 'touch', pointerId: 1, clientY: 10 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].map((level: { field: string }) => level.field)).toEqual(['amount', 'name']);
  });
});
