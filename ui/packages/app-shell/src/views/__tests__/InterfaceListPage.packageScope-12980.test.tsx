// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12980 — inside an app that names a package, the interface list page
 * reads its source object through the app's scope, so the page route's scope
 * read (which already holds the source) is reused: no second request.
 *
 * Measured before the fix with this file's harness: the list page's
 * names-only read is a separate scope entry, and the package list does not
 * fill the by-name cache, so a source the app's package holds was asked again
 * by name (`object/crm_account`) after the route's `object?package=app.crm`
 * had returned it.
 *
 * The harness is the REAL `MetadataProvider` with a client double that records
 * each call as its URL would read. The route's half is the real
 * `readPageObjectScope` (what `AppContent` and `PageView` read for a page
 * route); the list page mounts once that read has settled, as it does below
 * the route's splash gate.
 *
 * Pins: (b) a package app's interface list issues no second read of its
 * source; (c) CONTROL: in an app with no package the list page still reads
 * its source by name, once.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdapterCtx, useMetadata } from '@object-ui/react';

import { MetadataProvider } from '../../providers/MetadataProvider';
import { InterfaceListPage } from '../InterfaceListPage';
import { readPageObjectScope } from '../../console/appObjectScope';

const OBJECTS = [
  { name: 'crm_account', _packageId: 'app.crm', label: 'Accounts', fields: { name: { type: 'text', label: 'Name' } } },
  { name: 'sys_user', _packageId: 'plugin.auth', fields: { name: { type: 'text' } } },
];
const PAGE = { name: 'accounts', label: 'Accounts', type: 'app', interfaceConfig: { source: 'crm_account' } };

const calls: string[] = [];
const objectCalls = () => calls.filter((c) => c === 'object' || c.startsWith('object?') || c.startsWith('object/'));
let apps: unknown[] = [];

function adapter() {
  return {
    clearCache: vi.fn(),
    // objectui#13044 — the real MetadataProvider reads an object by name through
    // the adapter's `getObjectSchema`; this double answers it from its own by-name door.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all = type === 'object' ? OBJECTS : type === 'app' ? apps : type === 'page' ? [PAGE] : [];
          const items = options?.packageId ? all.filter((o: any) => o._packageId === options.packageId) : all;
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          const item = (type === 'object' ? OBJECTS : []).find((o) => o.name === name);
          return item ? Promise.resolve({ type, name, item: structuredClone(item) }) : Promise.reject(new Error('404'));
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

/** The page route's half: its scope read first, then the list page below it. */
function PageRoute() {
  const metadata = useMetadata();
  const app = (metadata.apps as any[]).find((a) => a?.name === 'crm');
  if (!app) return null;
  const { ready } = readPageObjectScope(metadata.readObjectScope!, app, PAGE);
  if (!ready) return <div data-testid="route-pending" />;
  return <InterfaceListPage page={PAGE as never} />;
}

function boot() {
  const ds = { find: vi.fn(async () => ({ data: [], total: 0 })), getObjectSchema: vi.fn(async () => OBJECTS[0]) };
  render(
    <MetadataProvider adapter={adapter()}>
      <AdapterCtx.Provider value={ds as never}>
        <MemoryRouter initialEntries={['/apps/crm/page/accounts']}>
          <Routes>
            <Route path="/apps/:appName/page/:pageName" element={<PageRoute />} />
          </Routes>
        </MemoryRouter>
      </AdapterCtx.Provider>
    </MetadataProvider>,
  );
}

/** The list page draws its list once its source object is known. */
const sourceKnown = () => waitFor(() => expect(screen.getByTestId('interface-list-page')).toBeInTheDocument());

beforeEach(() => {
  calls.length = 0;
  // The provider caches each type in session storage: the app list included.
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(cleanup);

describe('the interface list page reuses the page route\'s scope for its source (objectui#12980)', () => {
  it('(b) in a package app, its source is read once, by the route\'s package list, and never again by name', async () => {
    apps = [{ name: 'crm', label: 'CRM', _packageId: 'app.crm' }];
    boot();
    await waitFor(() => expect(screen.queryByTestId('route-pending')).not.toBeInTheDocument());
    await sourceKnown();
    // Let anything the list page starts land before counting.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(objectCalls()).toEqual(['object?package=app.crm']);
  });

  it('(c) CONTROL: in an app with no package, its source is read by name, once', async () => {
    apps = [{ name: 'crm', label: 'CRM' }];
    boot();
    await waitFor(() => expect(screen.queryByTestId('route-pending')).not.toBeInTheDocument());
    await sourceKnown();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(objectCalls()).toEqual(['object/crm_account']);
  });
});
