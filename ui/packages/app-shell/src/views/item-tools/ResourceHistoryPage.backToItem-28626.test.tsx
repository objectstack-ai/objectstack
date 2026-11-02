// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28626 — the routed history page's "Back to item" opens the item
 * it is the history of, `…/metadata/TYPE/NAME`, with the query the item page
 * reads (`?package=`, `?scope=environment`), under every route nesting that
 * still mounts the page.
 *
 * Setup keeps one metadata type on its own pages, the datasource (ADR-0146
 * D1, `SETUP_KEPT_METADATA_TYPE`), and `AppContent` mounts its history page
 * under two nestings: `/apps/:appName/*` → `metadata` → `:type/:name/history`
 * with an active app, and `/apps/:appName/*` → `metadata/:type/:name/history`
 * with none. The exported `MetadataResourceRouter` mounts it under a splat,
 * `component/:ns/:name/*`, with the type in `?type=`. Under Studio's "All
 * metadata" area the link is built from the area's root and is the control.
 *
 * Real: the page and React Router. Stubbed: the metadata client and types.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MetadataAreaHostContext, type MetadataAreaHost } from '../metadata-admin/metadataAreaHost';

const client = { history: vi.fn(async () => ({ events: [] })) };

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'datasource', label: 'Datasource', domain: 'system' }],
  }),
}));
vi.mock('../metadata-admin/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

import { MetadataResourceHistoryPage } from './ResourceHistoryPage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Here() {
  const { pathname, search } = useLocation();
  return <output data-testid="here">{`${pathname}${search}`}</output>;
}

const item = <div data-testid="item-page" />;
const history = <MetadataResourceHistoryPage />;

/** `AppContent`'s branch with an active app: the history route nests in `metadata`. */
function WithApp() {
  return (
    <Routes>
      <Route path="metadata">
        <Route path=":type" element={<div data-testid="type-list" />} />
        <Route path=":type/:name" element={item} />
        <Route path=":type/:name/history" element={history} />
      </Route>
    </Routes>
  );
}

/** `AppContent`'s branch with no app: one flat route per page. */
function NoApp() {
  return (
    <Routes>
      <Route path="metadata/:type" element={<div data-testid="type-list" />} />
      <Route path="metadata/:type/:name" element={item} />
      <Route path="metadata/:type/:name/history" element={history} />
    </Routes>
  );
}

function renderUnderApps(branch: React.ReactNode, url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Here />
      <Routes>
        <Route path="/apps/:appName/*" element={branch} />
        <Route path="/studio/*" element={<div data-testid="studio" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const backToItem = () => fireEvent.click(screen.getByRole('button', { name: /Back to item/ }));

describe('"Back to item" on the routed history page (objectstack#28626)', () => {
  it('with an active app it opens the item, not a type list named after it', async () => {
    renderUnderApps(<WithApp />, '/apps/setup/metadata/datasource/warehouse/history');
    backToItem();
    expect(await screen.findByTestId('item-page')).toBeInTheDocument();
    expect(screen.getByTestId('here')).toHaveTextContent(/^\/apps\/setup\/metadata\/datasource\/warehouse$/);
  });

  it('with no app it opens the item, not a root path named after it', async () => {
    renderUnderApps(<NoApp />, '/apps/setup/metadata/datasource/warehouse/history');
    backToItem();
    expect(await screen.findByTestId('item-page')).toBeInTheDocument();
    expect(screen.getByTestId('here')).toHaveTextContent(/^\/apps\/setup\/metadata\/datasource\/warehouse$/);
  });

  it('keeps the query the item page reads, under both nestings', async () => {
    for (const branch of [<WithApp key="with" />, <NoApp key="none" />]) {
      renderUnderApps(branch, '/apps/crm/metadata/datasource/warehouse/history?package=com.example.crm&scope=environment');
      backToItem();
      expect(await screen.findByTestId('item-page')).toBeInTheDocument();
      expect(screen.getByTestId('here')).toHaveTextContent(
        /^\/apps\/crm\/metadata\/datasource\/warehouse\?package=com\.example\.crm&scope=environment$/,
      );
      cleanup();
    }
  });

  it('keeps an encoded item name encoded', async () => {
    renderUnderApps(<WithApp />, '/apps/setup/metadata/datasource/sales%20db/history');
    backToItem();
    expect(await screen.findByTestId('item-page')).toBeInTheDocument();
    expect(screen.getByTestId('here')).toHaveTextContent(/^\/apps\/setup\/metadata\/datasource\/sales%20db$/);
  });

  it('under the exported resource router (a splat, type in the query) it opens the item with its ?type=', async () => {
    renderUnderApps(
      <Routes>
        <Route path="component/:ns/:name/*" element={<MetadataResourceHistoryPage type="datasource" name="warehouse" />} />
      </Routes>,
      '/apps/crm/component/metadata/resource/warehouse/history?type=datasource',
    );
    backToItem();
    expect(screen.getByTestId('here')).toHaveTextContent(
      /^\/apps\/crm\/component\/metadata\/resource\/warehouse\?type=datasource$/,
    );
  });

  it('under Studio\'s "All metadata" area it still opens the area\'s item page (control)', async () => {
    const host: MetadataAreaHost = { packageId: 'com.example.crm', readOnly: false, basePath: '/studio/com.example.crm/metadata' };
    render(
      <MetadataAreaHostContext.Provider value={host}>
        <MemoryRouter initialEntries={['/studio/com.example.crm/metadata/flow/lead_route/history?package=com.example.crm']}>
          <Here />
          <Routes>
            <Route path="/studio/:pkg/metadata">
              <Route path=":type/:name" element={item} />
              <Route path=":type/:name/history" element={history} />
            </Route>
          </Routes>
        </MemoryRouter>
      </MetadataAreaHostContext.Provider>,
    );
    backToItem();
    expect(await screen.findByTestId('item-page')).toBeInTheDocument();
    expect(screen.getByTestId('here')).toHaveTextContent(
      /^\/studio\/com\.example\.crm\/metadata\/flow\/lead_route\?package=com\.example\.crm$/,
    );
  });
});
