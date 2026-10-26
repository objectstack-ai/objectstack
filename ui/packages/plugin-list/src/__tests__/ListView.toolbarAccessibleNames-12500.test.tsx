/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12500 — the list toolbar's Filter, Export and Add record buttons
 * keep an accessible name when they render icon-only.
 *
 * ## The defect
 *
 * Below Tailwind's `sm` breakpoint each of these buttons shows only its icon:
 * the visible label is a `hidden sm:inline` span, and nothing else named the
 * button. A screen reader announced "button". With filters active, the count
 * badge was the Filter button's whole name, a bare number.
 *
 * ## How "below sm" is reproduced here
 *
 * happy-dom has no viewport and no Tailwind stylesheet, so the label spans are
 * visible in every case by default. The narrow cases mount the one rule that
 * applies below `sm`, `.hidden { display: none }`, without the `sm:inline`
 * media rule that undoes it at 640 px and up. The accessible-name computation
 * then skips the hidden label, as a browser does at 375 px. The wide cases
 * mount no rule, which is the 1280 px control: the label is visible and the
 * name must be that label exactly once.
 *
 * Provider-less, so `t()` reads `LIST_DEFAULT_TRANSLATIONS`; that table and
 * the `en` pack are held equal by the defaults-mirror pin in app-shell.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, waitFor, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';

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

let narrowStyle: HTMLStyleElement | null = null;

/** The base (below `sm`) Tailwind rule for the label spans, and nothing else. */
function belowSm() {
  narrowStyle = document.createElement('style');
  narrowStyle.textContent = '.hidden { display: none; }';
  document.head.appendChild(narrowStyle);
}

afterEach(() => {
  cleanup();
  narrowStyle?.remove();
  narrowStyle = null;
});

const ONE_FILTER = {
  id: 'root',
  logic: 'and',
  conditions: [{ id: 'c1', field: 'name', operator: 'contains', value: 'a' }],
};

async function renderToolbar(extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const ds: any = {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    exportDownload: vi.fn(),
  };
  render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView
        schema={{
          type: 'list-view',
          objectName: 'account',
          viewType: 'grid',
          fields: ['name'],
          addRecord: { enabled: true, position: 'both' },
          ...extra,
        } as any}
        dataSource={ds}
        {...props}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
}

describe('ListView toolbar buttons keep a name when icon-only (objectui#12500)', () => {
  it('below sm: Filter and both Add record buttons are found by name', async () => {
    belowSm();
    await renderToolbar();

    const filter = screen.getByRole('button', { name: 'Filter' });
    expect(filter).toHaveAttribute('data-testid', 'toolbar-filter-trigger');

    // The empty state's own CTA is named "Add record" too; the two toolbar
    // slots (`position: 'both'`) are the ones under test.
    const adds = screen
      .getAllByRole('button', { name: 'Add record' })
      .filter((btn) => btn.getAttribute('data-testid') === 'add-record-button');
    expect(adds).toHaveLength(2);
  });

  it('below sm: Export is found by name in a non-compact toolbar', async () => {
    belowSm();
    await renderToolbar({ compactToolbar: false, exportOptions: { formats: ['csv'] } });

    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('below sm, one active filter: the Filter name carries "Filter" and the count', async () => {
    belowSm();
    await renderToolbar({}, { initialFilters: ONE_FILTER });

    const filter = screen.getByTestId('toolbar-filter-trigger');
    expect(filter).toHaveAccessibleName('Filter, 1 active');
  });

  it('CONTROL, wide: each name is its visible label exactly once', async () => {
    await renderToolbar({ compactToolbar: false, exportOptions: { formats: ['csv'] } });

    // Filter is an icon button at every width since objectui#12695, so its
    // name is `aria-label` alone and it draws no label text.
    const filter = screen.getByTestId('toolbar-filter-trigger');
    expect(filter.textContent).toBe('');
    expect(filter).toHaveAccessibleName('Filter');

    const exportBtn = screen.getByRole('button', { name: 'Export' });
    expect(exportBtn).toHaveTextContent(/^Export$/);

    for (const btn of screen.getAllByTestId('add-record-button')) {
      expect(btn).toHaveTextContent(/^Add record$/);
      expect(btn).toHaveAccessibleName('Add record');
    }
  });
});
