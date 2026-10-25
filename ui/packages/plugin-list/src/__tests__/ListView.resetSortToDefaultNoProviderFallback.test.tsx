/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ListView`'s reset-to-declared-sort control resolves to ENGLISH when no
 * `I18nProvider` is mounted — objectui#4396.
 *
 * `list.resetSortToDefault` is one of the six keys PR #4372's census measured
 * as reading **outside** its hook's defaults table with **no inline
 * `defaultValue`** at the call site. #4372 taught `createSafeTranslation`'s
 * fallback to honour an inline default, which fixed the other 20 outside-table
 * keys; these six carry neither, so until this card they fell through to
 * `fallbackT`'s last resort — the raw key. The control in the sort popover was
 * labelled `list.resetSortToDefault`.
 *
 * The call site is bare on purpose and stays bare
 * (`t('list.resetSortToDefault')`, `ListView.tsx`); the fix is the row in
 * `LIST_DEFAULT_TRANSLATIONS`, byte-identical to `en.list.resetSortToDefault`.
 * That table is the same one objectui#4294 pinned byte-for-byte one row above,
 * for the same reason: on a provider-less host it is this copy that renders.
 *
 * Direction: this file was RED before the change (the button's accessible name
 * was the raw key) and is GREEN after.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, and `initReactI18next`
 * registers that instance as **react-i18next's module-global default**. The
 * registration survives unmount and `cleanup()`, so one `<I18nProvider>` mount
 * anywhere in a file silently resolves every later "no provider" render in that
 * same file against it — a green-looking file that asserts nothing about the
 * fallback. Vitest's `dom` project runs with `isolate: true`, so a file that
 * never mounts a provider gets a genuinely clean global. Keep it that way:
 * **do not import or mount `I18nProvider` here.**
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';

const objectDef = {
  name: 'projects',
  label: 'Projects',
  fields: {
    name: { type: 'text', label: 'Name' },
    plan_start_date: { type: 'date', label: 'Plan Start Date' },
    status: { type: 'select', label: 'Status' },
  },
};

// Rows matter: with an empty result set ListView renders `DataEmptyState`
// instead of the grid, and the toolbar the sort popover hangs off never mounts.
const ROWS = [
  { id: 'p-1', name: 'Alpha', plan_start_date: '2026-01-01', status: 'open' },
  { id: 'p-2', name: 'Beta', plan_start_date: '2026-02-01', status: 'done' },
];

/**
 * The control renders only when the view DECLARES a sort — with nothing
 * declared there is no default to return to, so the fixture must declare one.
 */
const DECLARED_SORT = [
  { field: 'plan_start_date', order: 'asc' },
  { field: 'name', order: 'asc' },
];

let prevObjectGrid: ReturnType<typeof ComponentRegistry.get>;

beforeAll(() => {
  // plugin-grid is not a dependency of plugin-list (that would be a cycle), so
  // the grid is stubbed — the same device the neighbouring sort tests use.
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});

afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});

afterEach(() => cleanup());

async function openSortPanel() {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: ROWS, total: ROWS.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(objectDef),
  };
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView
        schema={
          {
            type: 'list-view',
            objectName: 'projects',
            viewType: 'grid',
            columns: ['name', 'plan_start_date', 'status'],
            sort: DECLARED_SORT,
          } as unknown as ListViewSchema
        }
        dataSource={dataSource as never}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /^sort/i }));
  await screen.findByText('Sort Records');
}

describe('ListView reset-sort control — English fallback with no provider (objectui#4396)', () => {
  it('names the reset control in English, never the raw key', async () => {
    await openSortPanel();

    const reset = screen.getByTestId('sort-reset-default');
    expect(reset.textContent).toBe('Reset to view default');
    expect(reset.textContent).not.toBe('list.resetSortToDefault');
  });

  it('leaves no `list.` raw key anywhere in the sort popover', async () => {
    // Non-vacuity: `Sort Records` (already in the table) proves the popover is
    // genuinely mounted, so the absence below is a fact about the keys rather
    // than about an empty DOM.
    await openSortPanel();

    expect(screen.getByText('Sort Records')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/list\.[a-zA-Z]/);
  });
});
