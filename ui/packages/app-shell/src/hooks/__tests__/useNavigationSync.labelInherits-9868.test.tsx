/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9868 — navigation sync stops MATERIALISING a label for an unnamed
 * page / dashboard entry.
 *
 * It used to write `label: label || pageName` / `label: label || dashboardName`,
 * which froze the machine name into the app's stored navigation. Under
 * `@objectstack/spec` 17.5.0 (the cloud#2021 letter-A ruling) an ABSENT label
 * means "resolve at render time", so an unnamed entry is written with NO
 * `label` key; an author label is still written, verbatim.
 *
 * Asserted on the real writer — `NavigationSyncEffect`, the one caller in the
 * console, which never passes a label — and, for the author-label control, on
 * `useNavigationSync().syncPageCreated` / `syncDashboardCreated` with one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { MetadataCtx, AdapterCtx, type MetadataContextValue } from '@object-ui/react';
import { NavigationSyncEffect, useNavigationSync } from '../useNavigationSync';
import { __markFirstPainted } from '../sharedUserFeeds';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

interface World {
  pages: unknown[];
  dashboards: unknown[];
}

const crm = { name: 'crm', label: 'CRM', navigation: [] };

function metaValue(world: World): MetadataContextValue {
  return {
    apps: [crm],
    objects: [],
    dashboards: world.dashboards,
    reports: [],
    pages: world.pages,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };
}

const adapterFor = (saveItem: ReturnType<typeof vi.fn>) =>
  ({ getClient: () => ({ meta: { saveItem } }) }) as unknown as React.ComponentProps<typeof AdapterCtx.Provider>['value'];

/** Every navigation array the writer PUT, flattened to its entries. */
const writtenEntries = (saveItem: ReturnType<typeof vi.fn>) =>
  saveItem.mock.calls.flatMap(([, , schema]) => schema.navigation as Record<string, unknown>[]);

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  // objectui#12980 — the effect reads nothing before the console's first
  // paint; these cases are about the diff, so they start past it.
  __markFirstPainted();
});

describe('objectui#9868 — NavigationSyncEffect writes unnamed entries with NO label', () => {
  it('a new page and a new dashboard land in navigation without a `label` key', async () => {
    const saveItem = vi.fn().mockResolvedValue({});
    const tree = (world: World) => (
      <AdapterCtx.Provider value={adapterFor(saveItem)}>
        <MetadataCtx.Provider value={metaValue(world)}>
          <NavigationSyncEffect />
        </MetadataCtx.Provider>
      </AdapterCtx.Provider>
    );
    const { rerender } = render(tree({ pages: [], dashboards: [] }));
    await flush();

    rerender(tree({ pages: [{ name: 'my_page' }], dashboards: [{ name: 'my_dash', label: 'My Dashboard' }] }));
    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(2));

    const [page, dash] = [
      writtenEntries(saveItem).find((e) => e.type === 'page'),
      writtenEntries(saveItem).find((e) => e.type === 'dashboard'),
    ];
    expect(page).toMatchObject({ type: 'page', pageName: 'my_page' });
    expect(dash).toMatchObject({ type: 'dashboard', dashboardName: 'my_dash' });
    // The subject: nothing materialised — not the machine name, not `''`.
    expect(page).not.toHaveProperty('label');
    expect(dash).not.toHaveProperty('label');
  });
});

describe('objectui#9868 — an author label is still written (control)', () => {
  it('syncPageCreated / syncDashboardCreated with a label store it verbatim', async () => {
    const saveItem = vi.fn().mockResolvedValue({});
    function Caller() {
      const { syncPageCreated, syncDashboardCreated } = useNavigationSync();
      useEffect(() => {
        void (async () => {
          await syncPageCreated('crm', 'my_page', 'Team Home');
          await syncDashboardCreated('crm', 'my_dash', 'Pipeline Health');
        })();
      }, [syncPageCreated, syncDashboardCreated]);
      return null;
    }
    render(
      <AdapterCtx.Provider value={adapterFor(saveItem)}>
        <MetadataCtx.Provider value={metaValue({ pages: [], dashboards: [] })}>
          <Caller />
        </MetadataCtx.Provider>
      </AdapterCtx.Provider>,
    );
    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(2));

    const entries = writtenEntries(saveItem);
    expect(entries.find((e) => e.type === 'page')).toMatchObject({ pageName: 'my_page', label: 'Team Home' });
    expect(entries.find((e) => e.type === 'dashboard')).toMatchObject({
      dashboardName: 'my_dash',
      label: 'Pipeline Health',
    });
  });
});
