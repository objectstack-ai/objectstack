/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29074 / #29057 — the list at phone width.
 *
 * - The bar's controls (Filter, Sort, Display, the phone search and its
 *   field and Clear) are 44 px touch targets below `sm` and keep their
 *   compact size from `sm` up: the `max-sm:` tokens beside the unchanged
 *   desktop ones.
 * - An active sort shows on the phone bar: the Sort trigger, with its level
 *   count, stays there while a sort is active (the Display panel still holds
 *   the builder), and goes while none is or while the search field is open.
 * - `useBelowSm` answers the `sm` media query for the panels' 16 px inset.
 *
 * happy-dom has no viewport and no Tailwind stylesheet: "narrow" mounts the
 * one base rule below `sm`, `.hidden { display: none }`, as
 * `ListView.phoneSortSearch-28911.test.tsx` does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, fireEvent, within, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';
import { PHONE_TOUCH_TARGET, useBelowSm } from '../components/ViewSettingsPopover';

const RECORDS = [{ id: '1', name: 'Acme', stage: 'won' }];

const SCHEMA: ListViewSchema = {
  type: 'list-view',
  objectName: 'account',
  viewType: 'grid',
  fields: ['name', 'stage'],
} as ListViewSchema;

let previousGrid: ReturnType<typeof ComponentRegistry.get>;
let viewportStyle: HTMLStyleElement | null = null;

/** The base (below `sm`) Tailwind rule, and nothing else. */
function belowSm() {
  viewportStyle = document.createElement('style');
  viewportStyle.textContent = '.hidden { display: none; }';
  document.head.appendChild(viewportStyle);
}

function mount(schema: Partial<ListViewSchema> = {}) {
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
      <ListView schema={{ ...SCHEMA, ...schema } as ListViewSchema} dataSource={dataSource as never} />
    </SchemaRendererProvider>,
  );
  return dataSource;
}

const tokens = (el: HTMLElement) => el.className.split(/\s+/);

beforeEach(() => {
  previousGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});

afterEach(() => {
  cleanup();
  viewportStyle?.remove();
  viewportStyle = null;
  vi.unstubAllGlobals();
  if (previousGrid) ComponentRegistry.register('object-grid', previousGrid as any);
});

describe('list bar touch targets below sm (objectstack#29074)', () => {
  it('Filter, Sort, Display and the phone search trigger are 44 px below sm and keep h-7 from sm up', async () => {
    mount();
    await screen.findByTestId('grid-stub');
    for (const id of ['toolbar-filter-trigger', 'toolbar-sort-trigger', 'toolbar-display-trigger', 'phone-search-trigger']) {
      const el = screen.getByTestId(id);
      expect(tokens(el), id).toEqual(expect.arrayContaining(['h-7', 'min-w-7', ...PHONE_TOUCH_TARGET.split(' ')]));
    }
  });

  it('the open phone search field and its Clear are 44 px below sm', async () => {
    mount();
    await screen.findByTestId('grid-stub');
    fireEvent.click(screen.getByTestId('phone-search-trigger'));
    expect(tokens(screen.getByTestId('phone-search-input'))).toEqual(expect.arrayContaining(['h-7', 'max-sm:h-11']));
    expect(tokens(screen.getByTestId('phone-search-clear'))).toEqual(
      expect.arrayContaining(['h-7', 'w-7', 'max-sm:h-11', 'max-sm:w-11']),
    );
  });
});

describe('an active sort shows on the phone bar (objectstack#29057)', () => {
  it('narrow, unsorted: the bar draws no Sort trigger', async () => {
    belowSm();
    mount();
    await screen.findByTestId('grid-stub');
    expect(screen.getByTestId('toolbar-sort-trigger')).not.toBeVisible();
  });

  it('narrow, sorted: the Sort trigger stays on the bar with the level count, and opens the sort builder', async () => {
    belowSm();
    mount({ sort: [{ field: 'name', order: 'asc' }] } as Partial<ListViewSchema>);
    await screen.findByTestId('grid-stub');
    const trigger = screen.getByTestId('toolbar-sort-trigger');
    expect(trigger).toBeVisible();
    expect(trigger).toHaveTextContent('1');
    expect(trigger).toHaveAccessibleName('Sort');

    fireEvent.click(trigger);
    expect(await screen.findByText('Sort Records')).toBeVisible();
  });

  it('narrow, sorted: the open search field takes the Sort trigger slot, which comes back when it folds', async () => {
    belowSm();
    mount({ sort: [{ field: 'name', order: 'asc' }] } as Partial<ListViewSchema>);
    await screen.findByTestId('grid-stub');
    fireEvent.click(screen.getByTestId('phone-search-trigger'));
    expect(screen.getByTestId('toolbar-sort-trigger')).not.toBeVisible();

    fireEvent.keyDown(screen.getByTestId('phone-search-input'), { key: 'Escape' });
    expect(screen.getByTestId('toolbar-sort-trigger')).toBeVisible();
  });

  it('the Display panel still carries the Sort block while the bar shows the indicator', async () => {
    belowSm();
    mount({ sort: [{ field: 'name', order: 'asc' }] } as Partial<ListViewSchema>);
    await screen.findByTestId('grid-stub');
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    const content = await screen.findByTestId('view-settings-content');
    expect(within(content).getByTestId('display-sort')).toBeInTheDocument();
  });
});

describe('useBelowSm', () => {
  function stubMatchMedia(matches: boolean) {
    const query = vi.fn().mockImplementation((q: string) => ({
      matches,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', query);
    return query;
  }

  it('asks the sm media query and answers its match', () => {
    const query = stubMatchMedia(true);
    expect(renderHook(() => useBelowSm()).result.current).toBe(true);
    expect(query).toHaveBeenCalledWith('(max-width: 639.98px)');
  });

  it('is false from sm up', () => {
    stubMatchMedia(false);
    expect(renderHook(() => useBelowSm()).result.current).toBe(false);
  });
});
