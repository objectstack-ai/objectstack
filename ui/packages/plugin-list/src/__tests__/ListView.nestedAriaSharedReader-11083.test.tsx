/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list region maps its nested `aria` bag through the shared reader
 * (objectui#11083).
 *
 * `ListView` used to map `schema.aria` inline, one key at a time. It now
 * spreads `resolveInlineAriaProps` from `@object-ui/react` and keeps only what
 * is its own: the `region` default role, and the `aria.live` key objectui's
 * `ListViewSchema` adds to the spec's bag. The label's string and locale-map
 * arms are pinned by `ListView.ariaLabelInlineLocale.test.tsx`, and the legacy
 * `label` fold with `live` by `ListView.test.tsx`; this file pins the other two
 * keys and the default.
 *
 * Locale channel: `LocalizationProvider` drives `useDisplayLocale()`'s first
 * limb, the same channel the inline-locale file uses.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

afterEach(cleanup);

/**
 * A partial stub carrying only the members this path calls, crossing the
 * published `DataSource` contract explicitly (objectui#7912).
 */
const mockDataSource = {
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

function renderListView(aria: unknown, locale = 'en') {
  const schema = {
    type: 'list-view',
    objectName: 'accounts',
    viewType: 'grid',
    columns: ['name'],
    ...(aria === undefined ? {} : { aria }),
  } as ListViewSchema;

  return render(
    <LocalizationProvider value={{ locale }}>
      <SchemaRendererProvider dataSource={mockDataSource as unknown as DataSource}>
        <ListView schema={schema} />
      </SchemaRendererProvider>
    </LocalizationProvider>,
  );
}

/** The list region is the root node ListView renders. */
const regionEl = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe('ListView nested aria bag through the shared reader (objectui#11083)', () => {
  it('ariaDescribedBy renders aria-describedby on the list region', () => {
    const { container } = renderListView({ ariaLabel: 'Accounts', ariaDescribedBy: 'hint-1' });
    expect(screen.getByRole('region', { name: 'Accounts' })).toBe(regionEl(container));
    expect(regionEl(container).getAttribute('aria-describedby')).toBe('hint-1');
  });

  it('an authored role replaces the region default', () => {
    const { container } = renderListView({ ariaLabel: 'Accounts', role: 'group' });
    expect(screen.getByRole('group', { name: 'Accounts' })).toBe(regionEl(container));
    expect(screen.queryByRole('region', { name: 'Accounts' })).toBeNull();
  });

  it('with no aria bag the region default still applies, with no name or description', () => {
    const { container } = renderListView(undefined);
    expect(regionEl(container).getAttribute('role')).toBe('region');
    expect(regionEl(container).hasAttribute('aria-label')).toBe(false);
    expect(regionEl(container).hasAttribute('aria-describedby')).toBe(false);
  });

  it('an empty authored role falls back to the region default instead of an empty attribute', () => {
    // The shared reader leaves an empty role out, so the default applies. The
    // inline mapping this replaced wrote `role=""`, which names no role.
    const { container } = renderListView({ ariaLabel: 'Accounts', role: '' });
    expect(regionEl(container).getAttribute('role')).toBe('region');
    expect(screen.getByRole('region', { name: 'Accounts' })).toBe(regionEl(container));
  });

  it('a locale-map ariaLabel under zh renders the zh entry', () => {
    const { container } = renderListView({ ariaLabel: { en: 'Accounts', 'zh-CN': '客户' } }, 'zh-CN');
    expect(regionEl(container).getAttribute('aria-label')).toBe('客户');
  });

  it('aria.live, the ListViewSchema extension, still renders aria-live', () => {
    const { container } = renderListView({ ariaLabel: 'Accounts', live: 'polite' });
    expect(regionEl(container).getAttribute('aria-live')).toBe('polite');
  });
});
