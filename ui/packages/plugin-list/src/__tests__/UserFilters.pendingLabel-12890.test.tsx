/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12890 — a user-filter chip with no authored label must not draw the
 * machine key while the object definition is still loading.
 *
 * THE DEFECT. An unlabelled chip (`{ field: 'category' }`) takes its label from
 * the object definition. `ListView` holds that definition at `null` until
 * `getObjectSchema` answers, and every chip draw site fell back to the field
 * key meanwhile, so a zh-CN viewer read `category` and then saw it replaced by
 * `分类`.
 *
 * WHAT IS PINNED:
 * - PENDING: no draw site that names a chip — the dropdown chip (in the bar
 *   and in the "More" overflow), the text control's placeholder, the remote
 *   picker's search prompt and the toggle chip — draws the key; a skeleton
 *   stands in where a label would be.
 * - ARRIVAL (through `ListView`, zh): once the definition answers, the chip
 *   draws the field's translated label.
 * - CONTROL: an authored label is drawn while pending.
 * - SETTLED: without the pending signal the key is still the last resort.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { ListView } from '../ListView';
import { UserFilters } from '../UserFilters';

const objectDef = {
  name: 'pkg',
  label: 'Package',
  fields: {
    id: { name: 'id', type: 'text' },
    title: { name: 'title', type: 'text', label: 'Title' },
    category: {
      name: 'category',
      type: 'select',
      label: 'Category',
      options: [
        { value: 'app', label: 'App' },
        { value: 'lib', label: 'Library' },
      ],
    },
  },
};

afterEach(cleanup);

/** Every text a viewer can read in the bar: rendered text plus placeholders. */
function drawnText(): string {
  const root = document.body;
  const placeholders = Array.from(root.querySelectorAll('[placeholder]')).map(
    (el) => el.getAttribute('placeholder') ?? '',
  );
  return [root.textContent ?? '', ...placeholders].join(' | ');
}

describe('a user-filter chip never draws the field key while the definition is pending (objectui#12890)', () => {
  it('PENDING: no draw site draws the key of an unlabelled chip', () => {
    render(
      <UserFilters
        config={{
          element: 'dropdown',
          fields: [
            { field: 'category' },
            { field: 'title', type: 'text' },
            { field: 'owner_ref', type: 'user' },
            { field: 'region' },
          ],
        } as never}
        objectDef={null}
        objectDefPending
        data={[]}
        onFilterChange={vi.fn()}
        maxVisible={3}
      />,
    );

    // The chips, each with a skeleton where its name would be.
    for (const field of ['category', 'title', 'owner_ref']) {
      expect(screen.getByTestId(`filter-badge-${field}`).textContent).not.toContain(field);
      expect(screen.getByTestId(`filter-label-pending-${field}`)).toBeTruthy();
    }
    // The text control's placeholder.
    fireEvent.click(screen.getByTestId('filter-badge-title'));
    expect(screen.getByTestId('filter-text-title').getAttribute('placeholder')).not.toContain('title');
    // The remote picker's search prompt.
    fireEvent.click(screen.getByTestId('filter-badge-owner_ref'));
    expect(screen.getByTestId('filter-lookup-owner_ref')).toBeTruthy();
    // The overflow chip, inside "More".
    fireEvent.click(screen.getByTestId('user-filters-more'));
    expect(screen.getByTestId('filter-badge-region').textContent).not.toContain('region');

    const text = drawnText();
    for (const field of ['category', 'title', 'owner_ref', 'region']) {
      expect(text).not.toContain(field);
    }
  });

  it('PENDING: the deprecated toggle chip does not draw the key either', () => {
    render(
      <UserFilters
        config={{ element: 'toggle', fields: [{ field: 'category' }] } as never}
        objectDefPending
        onFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('filter-toggle-category').textContent).not.toContain('category');
    expect(screen.getByTestId('filter-label-pending-category')).toBeTruthy();
  });

  it('CONTROL: an authored label is drawn while the definition is pending', () => {
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'category', label: 'Kind' }] } as never}
        objectDef={null}
        objectDefPending
        data={[]}
        onFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('filter-badge-category').textContent).toContain('Kind');
    expect(screen.queryByTestId('filter-label-pending-category')).toBeNull();
  });

  it('SETTLED: without the pending signal the key is the last resort, as before', () => {
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'category' }] } as never}
        objectDef={null}
        data={[]}
        onFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('filter-badge-category').textContent).toContain('category');
  });

  it('ARRIVAL (ListView, zh): the skeleton gives way to the translated label', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dataSource = {
      find: vi.fn(async () => ({ data: [], total: 0 })),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => {
        await gate;
        return objectDef;
      }),
    } as any;
    const schema = {
      type: 'list-view',
      objectName: 'pkg',
      viewType: 'grid',
      columns: ['title'],
      userFilters: { element: 'dropdown', fields: [{ field: 'category' }] },
    };
    render(
      <I18nProvider
        config={{
          defaultLanguage: 'zh',
          detectBrowserLanguage: false,
          resources: { zh: { crm: { fields: { pkg: { category: '分类' } } } } },
        }}
      >
        <SchemaRendererProvider dataSource={dataSource}>
          <ListView schema={schema as never} dataSource={dataSource} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    // Pending: the chip exists, nameless.
    const badge = await screen.findByTestId('filter-badge-category');
    expect(badge.textContent).not.toContain('category');
    expect(screen.getByTestId('filter-label-pending-category')).toBeTruthy();

    await act(async () => release());
    await waitFor(() =>
      expect(screen.getByTestId('filter-badge-category').textContent).toContain('分类'),
    );
    expect(screen.queryByTestId('filter-label-pending-category')).toBeNull();
  });
});
