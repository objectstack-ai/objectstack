/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28911 — a phone list offers Sort and its own search.
 *
 * Below `sm` the bar keeps Filter and Display. Sort rides in the Display
 * panel there (the same Sort panel the toolbar popover draws), and the list
 * search is an icon that expands into a field in place. Both follow the same
 * `userActions` flags as the desktop toolbar.
 *
 * ## How "narrow" and "wide" are reproduced here
 *
 * happy-dom has no viewport and no Tailwind stylesheet. The narrow case mounts
 * the one base rule below `sm`, `.hidden { display: none }`, as
 * `ListView.toolbarIconButtons-12695.test.tsx` does. The wide case mounts the
 * three `sm:` rules these controls use, as they apply from `sm` up.
 *
 * Provider-less, so `t()` reads `LIST_DEFAULT_TRANSLATIONS`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
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
let viewportStyle: HTMLStyleElement | null = null;

function mountStyle(css: string) {
  viewportStyle = document.createElement('style');
  viewportStyle.textContent = css;
  document.head.appendChild(viewportStyle);
}

/** The base (below `sm`) Tailwind rule, and nothing else. */
function belowSm() {
  mountStyle('.hidden { display: none; }');
}

/** The rules these controls use, as they apply from `sm` up. */
function fromSm() {
  mountStyle([
    '.hidden { display: none; }',
    '.sm\\:hidden { display: none; }',
    '.sm\\:inline-flex { display: inline-flex; }',
  ].join('\n'));
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

async function openDisplay() {
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  return screen.findByTestId('view-settings-content');
}

/** The size tokens the bar's Filter trigger carries, the phone touch size. */
function sizeTokens(el: HTMLElement) {
  return el.className.split(/\s+/).filter((c) => /^(h|min-w)-/.test(c)).sort();
}

beforeEach(() => {
  previousGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});

afterEach(() => {
  cleanup();
  viewportStyle?.remove();
  viewportStyle = null;
  if (previousGrid) ComponentRegistry.register('object-grid', previousGrid as any);
});

describe('phone list: Sort in the Display panel (objectstack#28911)', () => {
  it('narrow: the bar draws no Sort button; Display carries the Sort panel, and a sort applies to the list', async () => {
    belowSm();
    const onSortChange = vi.fn();
    const ds = mount({}, { onSortChange });
    await screen.findByTestId('grid-stub');

    expect(screen.getByTestId('toolbar-sort-trigger')).not.toBeVisible();

    const content = await openDisplay();
    const block = within(content).getByTestId('display-sort');
    expect(block).toBeVisible();
    expect(within(block).getByText('Sort Records')).toBeVisible();

    ds.find.mockClear();
    fireEvent.click(within(block).getByRole('button', { name: 'Add sort' }));
    await waitFor(() => expect(onSortChange).toHaveBeenCalled());
    expect(onSortChange.mock.lastCall?.[0]).toEqual([expect.objectContaining({ field: 'name', order: 'asc' })]);
    // The list re-fetches under the new sort.
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(JSON.stringify(ds.find.mock.lastCall)).toContain('name');
  });

  it('wide: the Sort button is on the bar and the Display panel draws no Sort block', async () => {
    fromSm();
    mount();
    await screen.findByTestId('grid-stub');

    expect(screen.getByTestId('toolbar-sort-trigger')).toBeVisible();
    const content = await openDisplay();
    expect(within(content).getByTestId('display-sort')).not.toBeVisible();
  });

  it('`userActions.sort: false` withholds Sort on the phone too', async () => {
    belowSm();
    mount({ userActions: { sort: false } } as Partial<ListViewSchema>);
    await screen.findByTestId('grid-stub');

    expect(screen.queryByTestId('toolbar-sort-trigger')).toBeNull();
    const content = await openDisplay();
    expect(within(content).queryByTestId('display-sort')).toBeNull();
  });

  it('`compactToolbar: false` (no Display panel): the Sort button stays on the bar on the phone', async () => {
    belowSm();
    mount({ compactToolbar: false } as Partial<ListViewSchema>);
    await screen.findByTestId('grid-stub');

    expect(screen.queryByTestId('toolbar-display-trigger')).toBeNull();
    const sort = screen.getByTestId('toolbar-sort-trigger');
    expect(sort).toBeVisible();
    expect(sizeTokens(sort)).toEqual(sizeTokens(screen.getByTestId('toolbar-filter-trigger')));
  });
});

describe('phone list: the search icon expands in place (objectstack#28911)', () => {
  it('narrow: an icon at the bar touch size; tapping it opens a focused field that searches the list', async () => {
    belowSm();
    const onSearchChange = vi.fn();
    const ds = mount({}, { onSearchChange });
    await screen.findByTestId('grid-stub');

    expect(screen.getByTestId('search-icon-button')).not.toBeVisible();
    const trigger = screen.getByTestId('phone-search-trigger');
    expect(trigger).toBeVisible();
    expect(trigger).toHaveAccessibleName('Search');
    expect(sizeTokens(trigger)).toEqual(sizeTokens(screen.getByTestId('toolbar-filter-trigger')));

    fireEvent.click(trigger);
    const input = screen.getByTestId('phone-search-input');
    expect(input).toHaveFocus();
    // Expanded in place: the field stands in the bar, not in a popover.
    expect(screen.queryByTestId('search-popover')).toBeNull();
    expect(input.closest('[data-print-hide]')).not.toBeNull();

    ds.find.mockClear();
    fireEvent.change(input, { target: { value: 'acme' } });
    expect(onSearchChange).toHaveBeenLastCalledWith('acme');
    await waitFor(() => expect(JSON.stringify(ds.find.mock.calls)).toContain('acme'));
  });

  it('Enter folds the field back to the icon, which carries the keyword; the clear button empties and folds', async () => {
    belowSm();
    const onSearchChange = vi.fn();
    mount({}, { onSearchChange });
    await screen.findByTestId('grid-stub');

    fireEvent.click(screen.getByTestId('phone-search-trigger'));
    const input = screen.getByTestId('phone-search-input');
    fireEvent.change(input, { target: { value: 'acme' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const folded = screen.getByTestId('phone-search-trigger');
    expect(screen.queryByTestId('phone-search-input')).toBeNull();
    expect(folded).toHaveAccessibleName('Search: acme');
    expect(within(folded).getByTestId('phone-search-active-keyword')).toHaveTextContent('acme');

    fireEvent.click(folded);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onSearchChange).toHaveBeenLastCalledWith('');
    expect(screen.queryByTestId('phone-search-input')).toBeNull();
    expect(screen.getByTestId('phone-search-trigger')).toHaveAccessibleName('Search');
  });

  it('blurring an empty field folds it back', async () => {
    belowSm();
    mount();
    await screen.findByTestId('grid-stub');

    fireEvent.click(screen.getByTestId('phone-search-trigger'));
    fireEvent.blur(screen.getByTestId('phone-search-input'));
    expect(screen.queryByTestId('phone-search-input')).toBeNull();
  });

  it('wide: the phone search draws nothing; the desktop icon opens its popover as before', async () => {
    fromSm();
    mount();
    await screen.findByTestId('grid-stub');

    expect(screen.getByTestId('phone-search-trigger')).not.toBeVisible();
    expect(screen.getByTestId('search-icon-button')).toBeVisible();
  });

  it('`userActions.search: false` withholds the phone search too', async () => {
    belowSm();
    mount({ userActions: { search: false } } as Partial<ListViewSchema>);
    await screen.findByTestId('grid-stub');

    expect(screen.queryByTestId('phone-search-trigger')).toBeNull();
    expect(screen.queryByTestId('search-icon-button')).toBeNull();
  });
});
