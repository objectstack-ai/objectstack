// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36906 — a dashboard or a report opened from a Studio list opens
 * in its app's edit state; the report list's New opens the app's new-report
 * page; with no app, the generic item page (or the area's own create).
 *
 * Through the real `StudioMetadataArea` and its routes, with the metadata
 * pages stubbed to their names and the metadata client answering the
 * package's apps, this file pins:
 *   - the app the item opens in (decision 6) and the arrival it carries;
 *   - the address the app page returns to (`?studio=`, decision 15): the list
 *     the author left, with its filters, never the item's own params;
 *   - the Studio address is replaced, so Back from the app page skips it;
 *   - which opens keep the generic item page (a tab, the draft review, no app,
 *     the cross-package leg, any other type).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';

vi.mock('../metadata-admin/index.js', () => ({
  MetadataDirectoryPage: () => <div data-testid="area-page" data-page="directory" />,
  MetadataDiagnosticsPage: () => <div data-testid="area-page" data-page="diagnostics" />,
  MetadataResourceListPage: () => <div data-testid="area-page" data-page="list" />,
  MetadataResourceEditPage: ({ createMode }: { createMode?: boolean }) => (
    <div data-testid="area-page" data-page={createMode ? 'create' : 'item'} />
  ),
  MetadataResourceHistoryPage: () => <div data-testid="area-page" data-page="history" />,
}));

const listed = vi.hoisted(() => ({ value: new Map<string, unknown>() }));
vi.mock('./packages-io.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: vi.fn(async () => listed.value),
}));

/** The package's published apps, and the apps the client reads by name. */
const apps = vi.hoisted(() => ({
  byPackage: new Map<string, Array<Record<string, unknown>>>(),
  byName: new Map<string, Record<string, unknown>>(),
  listCalls: [] as Array<[string, unknown]>,
}));
vi.mock('../metadata-admin/useMetadata.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({
    list: async (type: string, options: { packageId?: string }) => {
      apps.listCalls.push([type, options]);
      return apps.byPackage.get(options.packageId ?? '') ?? [];
    },
    get: async (_type: string, name: string) => apps.byName.get(name) ?? null,
  }),
}));

import { StudioMetadataArea } from './StudioMetadataArea';
import { rememberAppReturnPage, resetAppReturnPageForTests } from '../../utils/appReturnPage';
// The source under test reaches dynamic imports of `@objectstack/lint`; their first
// load is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';

const PKG = 'com.example.crm';

beforeEach(() => {
  listed.value = new Map([[PKG, { id: PKG, name: 'CRM', writable: true, manifest: {} }]]);
  apps.byPackage = new Map([[PKG, [{ name: 'crm_app', label: 'CRM' }]]]);
  apps.byName = new Map();
  apps.listCalls = [];
  resetAppReturnPageForTests();
});
afterEach(() => {
  cleanup();
  resetAppReturnPageForTests();
});

/** The app page the area hands over to: its address, its landing and how it was reached. */
function AppPage() {
  const { pathname, search, state } = useLocation();
  const how = useNavigationType();
  return <div data-testid="app-page" data-at={`${pathname}${search}`} data-state={JSON.stringify(state)} data-how={how} />;
}

function PackageArea() {
  const { pathname } = useLocation();
  const packageId = decodeURIComponent(pathname.split('/')[2] ?? '');
  return <StudioMetadataArea key={packageId} packageId={packageId} />;
}

function mount(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/studio/~all/metadata/*" element={<StudioMetadataArea packageId={null} />} />
        <Route path="/studio/:packageId/metadata/*" element={<PackageArea />} />
        <Route path="/apps/*" element={<AppPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function appPage() {
  const el = await screen.findByTestId('app-page');
  return {
    at: el.getAttribute('data-at') ?? '',
    state: JSON.parse(el.getAttribute('data-state') ?? 'null'),
    how: el.getAttribute('data-how'),
  };
}

const studioOf = (at: string) => new URLSearchParams(at.slice(at.indexOf('?'))).get('studio');

describe('a Studio dashboard or report opens in its app (objectstack#36906)', () => {
  it("a dashboard opens the package app's page in its edit state; the address returns to the list as left", async () => {
    mount(`/studio/${PKG}/metadata/dashboard/ops_board?package=${PKG}&q=ops&tab=`);
    // `tab=` (empty) still asks the item page for a tool: that open keeps it.
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('item');
    cleanup();

    mount(`/studio/${PKG}/metadata/dashboard/ops_board?package=${PKG}&q=ops`);
    const opened = await appPage();
    // One app in the package: its address is the package id (ADR-0048 option A).
    expect(opened.at.split('?')[0]).toBe(`/apps/${PKG}/dashboard/ops_board`);
    expect(opened.state).toEqual({ designModeNewDashboard: 'ops_board' });
    expect(studioOf(opened.at)).toBe(`/studio/${PKG}/metadata/dashboard?package=${PKG}&q=ops`);
    // Replaced: Back from the app page lands on the list, not on this address.
    expect(opened.how).toBe('REPLACE');
    expect(apps.listCalls).toEqual([['app', { packageId: PKG }]]);
  });

  it('a report opens its builder on arrival, in the app the author came from when it is one of the package apps', async () => {
    apps.byPackage.set(PKG, [{ name: 'sales' }, { name: 'service' }]);
    rememberAppReturnPage({ path: '/apps/service/home', app: 'service', label: 'Service' });
    mount(`/studio/${PKG}/metadata/report/pipeline?package=${PKG}`);
    const opened = await appPage();
    expect(opened.at.split('?')[0]).toBe('/apps/service/report/pipeline');
    expect(opened.state).toEqual({ openReportBuilder: 'pipeline' });
  });

  it("the remembered app of another package counts when its menu opens the item; Setup's, without it, does not", async () => {
    rememberAppReturnPage({ path: '/apps/ops_console/home', app: 'ops_console', label: 'Ops' });
    apps.byName.set('ops_console', { name: 'ops_console', navigation: [{ id: 'n', type: 'dashboard', dashboardName: 'ops_board' }] });
    mount(`/studio/${PKG}/metadata/dashboard/ops_board?package=${PKG}`);
    expect((await appPage()).at.split('?')[0]).toBe('/apps/ops_console/dashboard/ops_board');
    cleanup();

    resetAppReturnPageForTests();
    rememberAppReturnPage({ path: '/apps/setup/system', app: 'setup', label: 'Setup' });
    apps.byName.set('setup', { name: 'setup', navigation: [{ id: 'n', type: 'object', objectName: 'sys_user' }] });
    mount(`/studio/${PKG}/metadata/dashboard/ops_board?package=${PKG}`);
    expect((await appPage()).at.split('?')[0]).toBe(`/apps/${PKG}/dashboard/ops_board`);
  });

  it('a package with no published app keeps the generic item page (decision 3)', async () => {
    apps.byPackage.set(PKG, []);
    mount(`/studio/${PKG}/metadata/dashboard/ops_board?package=${PKG}`);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('item');
    expect(screen.queryByTestId('app-page')).toBeNull();
  });

  it('the History tab and the draft review keep the generic item page', async () => {
    mount(`/studio/${PKG}/metadata/report/pipeline/history?package=${PKG}`);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('item');
    cleanup();
    mount(`/studio/${PKG}/metadata/dashboard/ops_board?package=${PKG}&review=1`);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('item');
    expect(apps.listCalls).toEqual([]);
  });

  it('the cross-package leg and every other type keep the generic item page', async () => {
    mount('/studio/~all/metadata/dashboard/ops_board?package=' + PKG);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('item');
    cleanup();
    mount(`/studio/${PKG}/metadata/view/account.all?package=${PKG}`);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('item');
    expect(apps.listCalls).toEqual([]);
  });
});

describe("the report list's New opens the app's new-report page (objectstack#36906, decision 13)", () => {
  it('opens /apps/APP/reports/new, returning to the report list', async () => {
    mount(`/studio/${PKG}/metadata/report/new?package=${PKG}`);
    const opened = await appPage();
    expect(opened.at.split('?')[0]).toBe(`/apps/${PKG}/reports/new`);
    expect(opened.state).toBeNull();
    expect(studioOf(opened.at)).toBe(`/studio/${PKG}/metadata/report?package=${PKG}`);
  });

  it('with no app to open, the area creates as before; a dashboard New is not this card', async () => {
    apps.byPackage.set(PKG, []);
    mount(`/studio/${PKG}/metadata/report/new?package=${PKG}`);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('create');
    cleanup();
    apps.byPackage.set(PKG, [{ name: 'crm_app' }]);
    mount(`/studio/${PKG}/metadata/dashboard/new?package=${PKG}`);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('create');
  });
});
