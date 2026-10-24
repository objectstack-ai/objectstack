/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10580 — the bar `ObjectGrid` draws over its rows while it re-reads
 * them is named in the active locale.
 *
 * `RefreshIndicator` used to default its accessible name to the English
 * literal "Refreshing", and this grid passed none, so a screen reader
 * announced English in every locale. The grid now names the bar with
 * `grid.refreshing`, the key its pull-to-refresh text already reads, and the
 * component has no default left to fall to.
 *
 * The re-read is driven the way `ObjectGrid.invalidationRefetch-10035.test.tsx`
 * drives it: a write reported on the data-invalidation bus. The second `find`
 * is held open by hand, so the bar is read while the query really is in flight.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { notifyDataChanged } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

beforeEach(() => {
  // The provider persists the last language; keep one case from leaking into the next.
  window.localStorage.clear();
});

// Module constants: `I18nProvider` rebuilds its i18next instance whenever the
// `config` object changes identity, so an inline literal would re-boot it on
// every render.
const DE = { defaultLanguage: 'de', detectBrowserLanguage: false };
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false };

const OBJECT = 'duly_task';

/** The first `find` answers at once; every later one stays in flight. */
function makeDataSource() {
  let calls = 0;
  const find = vi.fn(() => {
    calls += 1;
    if (calls === 1) {
      return Promise.resolve({ data: [{ id: 'r1', name: 'First row' }], total: 1, hasMore: false, pageSize: 50 });
    }
    return new Promise<never>(() => {});
  });
  return {
    find,
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' } },
    }),
  } as any;
}

const SCHEMA: any = {
  type: 'object-grid',
  objectName: OBJECT,
  columns: [{ field: 'name', label: 'Name' }],
  pagination: { pageSize: 50 },
};

const indicator = () => screen.queryByTestId('refresh-indicator');

async function readBarNameDuringReRead(config: typeof DE) {
  const ds = makeDataSource();
  render(
    <I18nProvider config={config}>
      <ObjectGrid schema={SCHEMA} dataSource={ds} />
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByText('First row')).toBeInTheDocument());
  expect(indicator(), 'no bar while nothing is in flight').toBeNull();
  const before = ds.find.mock.calls.length;

  await act(async () => {
    notifyDataChanged({ objectName: OBJECT });
  });
  await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(before));
  await waitFor(() => expect(indicator()).not.toBeNull());
  // The rows on screen stay while the re-read runs; the bar sits over them.
  expect(screen.getByText('First row')).toBeInTheDocument();
}

describe('ObjectGrid names its refresh bar in the active locale (objectui#10580)', () => {
  it('de: the bar is named by the de pack, not by an English literal', async () => {
    await readBarNameDuringReRead(DE);
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Wird aktualisiert…' })).toBeInTheDocument());
    expect(indicator()!.getAttribute('aria-label')).not.toMatch(/Refreshing/);
  });

  it('en control: the bar is named by the en pack value', async () => {
    await readBarNameDuringReRead(EN);
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Refreshing…' })).toBeInTheDocument());
  });
});
