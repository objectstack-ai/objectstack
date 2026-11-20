/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12695 — the list toolbar draws Filter, Sort and Display as icon
 * buttons at every width, with the count badge as the only text in the
 * cluster. ⚠️ objectstack#35548 redrew them from `sm` up as named text
 * buttons, 「筛选」「排序」「选项」 (Display is now Options), each with its count
 * after the name; below `sm` they stay icons, the label `hidden sm:inline`. One shape for every list: the triggers live in `ListView`, which
 * app object lists, Setup lists and related lists all mount.
 *
 * ## How "wide" and "narrow" are reproduced here
 *
 * happy-dom has no viewport and no Tailwind stylesheet, so with no rule
 * mounted every element is visible: that is the wide case, and the strong one,
 * because a `hidden sm:inline` label span would show up in `textContent`. The
 * narrow case mounts the one base rule below `sm`, `.hidden { display: none }`
 * (as `ListView.toolbarAccessibleNames-12500.test.tsx` does). Sort is itself
 * `hidden sm:inline-flex`, so below `sm` only Filter and Display are drawn.
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
import { openAdvancedFilter, openAdvancedSort } from './conditionPanels';

const RECORDS = [{ id: '1', name: 'Acme', stage: 'won' }];

const TWO_FILTERS = {
  id: 'root',
  logic: 'and',
  conditions: [
    { id: 'c1', field: 'name', operator: 'contains', value: 'a' },
    { id: 'c2', field: 'stage', operator: 'equals', value: 'won' },
  ],
};

const SCHEMA: ListViewSchema = {
  type: 'list-view',
  objectName: 'account',
  viewType: 'grid',
  fields: ['name', 'stage'],
} as ListViewSchema;

let previousGrid: ReturnType<typeof ComponentRegistry.get>;
let narrowStyle: HTMLStyleElement | null = null;

/** The base (below `sm`) Tailwind rule, and nothing else. */
function belowSm() {
  narrowStyle = document.createElement('style');
  narrowStyle.textContent = '.hidden { display: none; }';
  document.head.appendChild(narrowStyle);
}

function mount(schema: Partial<ListViewSchema> = {}, props: Record<string, unknown> = {}) {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: RECORDS, total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'account', fields: {} }),
  };
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView schema={{ ...SCHEMA, ...schema } as ListViewSchema} dataSource={dataSource as never} {...props} />
    </SchemaRendererProvider>,
  );
}

/** Raise the Display count to two: density and inline editing off the view's own. */
async function changeTwoDisplaySettings() {
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  const content = await screen.findByTestId('view-settings-content');
  // Two levels of the Display menu: a row height, then Edit inline under More.
  fireEvent.click(within(content).getByTestId('options-row-row-height'));
  fireEvent.click(await within(content).findByTestId('options-row-height-spacious'));
  fireEvent.click(within(content).getByTestId('options-back'));
  fireEvent.click(within(content).getByTestId('options-row-more'));
  fireEvent.click(await within(content).findByTestId('toolbar-inline-edit-toggle'));
  await waitFor(() => expect(screen.getByTestId('toolbar-display-count')).toHaveTextContent('2'));
  fireEvent.keyDown(content, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('view-settings-content')).toBeNull());
}

beforeEach(() => {
  previousGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});

afterEach(() => {
  cleanup();
  narrowStyle?.remove();
  narrowStyle = null;
  if (previousGrid) ComponentRegistry.register('object-grid', previousGrid as any);
});

describe('Filter, Sort and Options: text buttons from `sm` up, icons below it (objectui#12695, objectstack#35548)', () => {
  const TRIGGERS = [
    ['toolbar-filter-trigger', 'Filter'],
    ['toolbar-sort-trigger', 'Sort'],
    ['toolbar-display-trigger', 'Options'],
  ] as const;

  it('wide: each trigger reads its name, and the names and titles resolve', async () => {
    mount();
    await screen.findByTestId('grid-stub');
    for (const [testId, name] of TRIGGERS) {
      const btn = screen.getByTestId(testId);
      expect(btn.textContent).toBe(name);
      expect(screen.getByRole('button', { name })).toBe(btn);
      expect(btn).toHaveAttribute('title', name);
    }
  });

  it('narrow: the label is `hidden sm:inline` beside an `sm:hidden` icon, and the names hold', async () => {
    belowSm();
    mount();
    await screen.findByTestId('grid-stub');
    for (const [testId, name] of [TRIGGERS[0], TRIGGERS[2]]) {
      const btn = screen.getByTestId(testId);
      const label = Array.from(btn.querySelectorAll('span')).find((el) => el.textContent === name)!;
      expect(label.className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'sm:inline']));
      expect(btn.querySelector('svg')?.getAttribute('class') ?? '').toContain('sm:hidden');
      expect(screen.getByRole('button', { name })).toBe(btn);
    }
  });

  it('the count badge follows the name: Filter 2 · Sort 1 · Options 2', async () => {
    mount({ sort: [{ field: 'name', order: 'asc' }] } as Partial<ListViewSchema>, { initialFilters: TWO_FILTERS });
    await screen.findByTestId('grid-stub');
    await changeTwoDisplaySettings();

    const filter = screen.getByTestId('toolbar-filter-trigger');
    expect(filter.textContent).toBe('Filter2');
    expect(filter).toHaveAccessibleName('Filter, 2 active');
    expect(filter).toHaveAttribute('title', 'Filter');

    const sort = screen.getByTestId('toolbar-sort-trigger');
    expect(sort.textContent).toBe('Sort1');
    expect(screen.getByRole('button', { name: 'Sort' })).toBe(sort);

    const display = screen.getByTestId('toolbar-display-trigger');
    expect(display.textContent).toBe('Options2');
    expect(screen.getByRole('button', { name: 'Options' })).toBe(display);

    // Everything the cluster says in text is the three names and their counts.
    const cluster = document.querySelector('[data-print-hide]');
    expect(cluster?.textContent).toBe('Filter2Sort1Options2');
  });

  it('`compactToolbar: false` draws Filter and Sort in the same shape', async () => {
    mount({ compactToolbar: false, sort: [{ field: 'name', order: 'asc' }] } as Partial<ListViewSchema>);
    await screen.findByTestId('grid-stub');
    const filter = screen.getByRole('button', { name: 'Filter' });
    expect(filter.textContent).toBe('Filter');
    expect(filter).toHaveAttribute('title', 'Filter');
    const sort = screen.getByRole('button', { name: 'Sort' });
    expect(sort.textContent).toBe('Sort1');
    expect(sort).toHaveAttribute('title', 'Sort');
  });

  it('CONTROL: each popover still opens from its trigger', async () => {
    mount();
    await screen.findByTestId('grid-stub');

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(await openAdvancedFilter()).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Filter Records')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    expect(await openAdvancedSort()).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Sort Records')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    expect(await screen.findByTestId('view-settings-content')).toBeInTheDocument();
  });
});
