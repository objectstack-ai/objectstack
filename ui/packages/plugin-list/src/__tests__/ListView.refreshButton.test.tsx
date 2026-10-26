/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #2634 — the ListView toolbar must expose a manual "Refresh" button that
 * re-fetches the current view from the backend without a full page reload.
 * Clicking it re-queries the DataSource while the filter/sort/search state
 * (held in component state) is preserved.
 *
 * The toggle is spec-canonical (`userActions.refresh`, @objectstack/spec) and
 * defaults to visible (opt-out via `userActions.refresh: false`).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    value: (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        clear: () => { store = {}; },
        removeItem: (k: string) => { delete store[k]; },
      };
    })(),
    configurable: true,
  });
});

function makeDataSource() {
  const find = vi.fn().mockResolvedValue({ data: [], total: 0 });
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as any;
}

function renderList(schema: Partial<ListViewSchema>, ds: any) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView
        schema={{ ...WIDE_TOOLBAR, type: 'list-view', objectName: 'proj', fields: ['name'], ...schema } as any}
        dataSource={ds}
      />
    </SchemaRendererProvider>,
  );
}

describe('ListView — manual refresh button (#2634)', () => {
  it('renders a refresh button by default and re-fetches on click', async () => {
    const ds = makeDataSource();
    renderList({}, ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const callsBefore = ds.find.mock.calls.length;

    const btn = screen.getByTestId('refresh-button');
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);

    await waitFor(() => {
      expect(ds.find.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('hides the refresh button when userActions.refresh is false', async () => {
    const ds = makeDataSource();
    renderList({ userActions: { refresh: false } as any }, ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(screen.queryByTestId('refresh-button')).not.toBeInTheDocument();
  });
});
