/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10580 — the bar `ListView` draws over its rows while it re-reads
 * them is named in the active locale.
 *
 * `RefreshIndicator` used to default its accessible name to the English
 * literal "Refreshing", and this view passed none, so a screen reader
 * announced English in every locale. The view now names the bar with
 * `list.refreshing`, the key its pull-to-refresh text already reads, and the
 * component has no default left to fall to.
 *
 * The re-read is the toolbar's own refresh button (`ListView.refreshButton.test.tsx`).
 * The second `find` is held open by hand, so the bar is read while the query
 * really is in flight.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

beforeEach(() => {
  // The provider persists the last language; keep one case from leaking into the next.
  window.localStorage.clear();
});

// Module constants: `I18nProvider` rebuilds its i18next instance whenever the
// `config` object changes identity, so an inline literal would re-boot it on
// every render.
const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false };
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false };

/** The first `find` answers at once; every later one stays in flight. */
function makeDataSource() {
  let calls = 0;
  const find = vi.fn(() => {
    calls += 1;
    if (calls === 1) return Promise.resolve({ data: [{ _id: 'p1', name: 'Alpha' }], total: 1 });
    return new Promise<never>(() => {});
  });
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as any;
}

const indicator = () => screen.queryByTestId('refresh-indicator');
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

async function readBarNameDuringReRead(config: typeof ZH) {
  const ds = makeDataSource();
  render(
    <I18nProvider config={config}>
      <SchemaRendererProvider dataSource={ds}>
        <ListView
          schema={{ ...WIDE_TOOLBAR, type: 'list-view', objectName: 'proj', fields: ['name'] } as any}
          dataSource={ds}
        />
      </SchemaRendererProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
  await settle();
  expect(indicator(), 'no bar while nothing is in flight').toBeNull();

  fireEvent.click(screen.getByTestId('refresh-button'));
  await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(indicator()).not.toBeNull());
}

describe('ListView names its refresh bar in the active locale (objectui#10580)', () => {
  it('zh: the bar is named by the zh pack, not by an English literal', async () => {
    await readBarNameDuringReRead(ZH);
    await waitFor(() => expect(screen.getByRole('progressbar', { name: '刷新中…' })).toBeInTheDocument());
    expect(indicator()!.getAttribute('aria-label')).not.toMatch(/Refreshing/);
  });

  it('en control: the bar is named by the en pack value', async () => {
    await readBarNameDuringReRead(EN);
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Refreshing…' })).toBeInTheDocument());
  });
});
