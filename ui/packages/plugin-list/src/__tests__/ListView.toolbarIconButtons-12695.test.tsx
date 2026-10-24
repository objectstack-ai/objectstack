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
 * cluster. One shape for every list: the triggers live in `ListView`, which
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

/** Raise the Display count to two: density and row numbers off the view's own. */
async function changeTwoDisplaySettings() {
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  const content = await screen.findByTestId('view-settings-content');
  fireEvent.click(within(content).getByTestId('view-settings-density-cycle'));
  fireEvent.click(within(content).getByTestId('display-row-numbers-toggle'));
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

describe('Filter, Sort and Display are icon buttons on every list (objectui#12695)', () => {
  it('wide: no visible label, the names and titles resolve', async () => {
    mount();
    await screen.findByTestId('grid-stub');
    for (const [testId, name] of [
      ['toolbar-filter-trigger', 'Filter'],
      ['toolbar-sort-trigger', 'Sort'],
      ['toolbar-display-trigger', 'Display'],
    ] as const) {
      const btn = screen.getByTestId(testId);
      expect(btn.textContent).toBe('');
      expect(screen.getByRole('button', { name })).toBe(btn);
      expect(btn).toHaveAttribute('title', name);
    }
  });

  it('narrow: Filter and Display draw no label and keep their names', async () => {
    belowSm();
    mount();
    await screen.findByTestId('grid-stub');
    for (const [testId, name] of [
      ['toolbar-filter-trigger', 'Filter'],
      ['toolbar-display-trigger', 'Display'],
    ] as const) {
      const btn = screen.getByTestId(testId);
      expect(btn.textContent).toBe('');
      expect(screen.getByRole('button', { name })).toBe(btn);
    }
  });

  it('the count badge is the only text: Filter 2 · Sort 1 · Display 2', async () => {
    mount({ sort: [{ field: 'name', order: 'asc' }] } as Partial<ListViewSchema>, { initialFilters: TWO_FILTERS });
    await screen.findByTestId('grid-stub');
    await changeTwoDisplaySettings();

    const filter = screen.getByTestId('toolbar-filter-trigger');
    expect(filter.textContent).toBe('2');
    expect(filter).toHaveAccessibleName('Filter, 2 active');
    expect(filter).toHaveAttribute('title', 'Filter');

    const sort = screen.getByTestId('toolbar-sort-trigger');
    expect(sort.textContent).toBe('1');
    expect(screen.getByRole('button', { name: 'Sort' })).toBe(sort);

    const display = screen.getByTestId('toolbar-display-trigger');
    expect(display.textContent).toBe('2');
    expect(screen.getByRole('button', { name: 'Display' })).toBe(display);

    // Everything the cluster says in text is the three counts.
    const cluster = document.querySelector('[data-print-hide]');
    expect(cluster?.textContent).toBe('212');
  });

  it('`compactToolbar: false` draws Filter and Sort in the same icon shape', async () => {
    mount({ compactToolbar: false, sort: [{ field: 'name', order: 'asc' }] } as Partial<ListViewSchema>);
    await screen.findByTestId('grid-stub');
    const filter = screen.getByRole('button', { name: 'Filter' });
    expect(filter.textContent).toBe('');
    expect(filter).toHaveAttribute('title', 'Filter');
    const sort = screen.getByRole('button', { name: 'Sort' });
    expect(sort.textContent).toBe('1');
    expect(sort).toHaveAttribute('title', 'Sort');
  });

  it('CONTROL: each popover still opens from its icon button', async () => {
    mount();
    await screen.findByTestId('grid-stub');

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(await screen.findByText('Filter Records')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Filter Records')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    expect(await screen.findByText('Sort Records')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Sort Records')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    expect(await screen.findByTestId('view-settings-content')).toBeInTheDocument();
  });
});
