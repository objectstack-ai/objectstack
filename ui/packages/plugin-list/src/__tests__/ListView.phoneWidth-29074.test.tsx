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
 * - (The phone bar's own Sort trigger is gone since objectstack#35878: Sort
 *   is the resident condition row's chip at every width.)
 * - `useBelowSm` answers the `sm` media query for the panels' 16 px inset.
 *
 * happy-dom has no viewport and no Tailwind stylesheet, so the size tokens are
 * read from the class list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, fireEvent, cleanup } from '@testing-library/react';
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
  vi.unstubAllGlobals();
  if (previousGrid) ComponentRegistry.register('object-grid', previousGrid as any);
});

describe('list bar touch targets below sm (objectstack#29074)', () => {
  it('Filter, Sort, Display and the phone search trigger are 44 px below sm and keep h-7 from sm up', async () => {
    mount();
    await screen.findByTestId('grid-stub');
    for (const id of ['toolbar-display-trigger', 'phone-search-trigger']) {
      const el = screen.getByTestId(id);
      expect(tokens(el), id).toEqual(expect.arrayContaining(['h-7', 'min-w-7', ...PHONE_TOUCH_TARGET.split(' ')]));
    }
    // Filter and Sort are the condition row's since objectstack#35878: 24 px
    // from `sm` up, the same 44 px below it.
    for (const id of ['condition-add-filter', 'condition-sort']) {
      expect(tokens(screen.getByTestId(id)), id).toEqual(expect.arrayContaining(['h-6', ...PHONE_TOUCH_TARGET.split(' ')]));
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
