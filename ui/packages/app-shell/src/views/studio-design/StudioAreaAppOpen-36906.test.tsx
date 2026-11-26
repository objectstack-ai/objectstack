// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36906 — a dashboard or a report opened from a Studio list opens
 * in its app's edit state; the report list's New opens the app's new-report
 * page; with no app, the generic item page (or the area's own create).
 * objectstack#36907 — the dashboard list's New opens the app in its design
 * mode, the 「Add menu item」 picker on its dashboards.
 *
 * Through the real `StudioMetadataArea` and its routes, with the metadata
 * pages stubbed to their names and the metadata client answering the
 * package's apps, this file pins:
 *   - the app the item opens in (decision 6) and the arrival it carries;
 *   - the address the app page returns to (`?studio=`, decision 15): the list
 *     the author left, with its filters, never the item's own params;
 *   - the Studio address is replaced, so Back from the app page skips it;
 *   - which opens keep the generic item page (a tab, the draft review, no app,
 *     the cross-package leg, any other type, an item with no published version);
 *   - a read-only base: its own rows open in its app, a pair row opens in the
 *     base's app (objectstack#37237: the pair publishes no app of its own),
 *     and its report New opens the app page only where the pair door is open;
 *   - a dashboard made by the area's own create (on a phone, where the
 *     dashboard New has no design mode to open) opens in its app, and Back
 *     from there lands on the list, not on an empty create page;
 *   - the dashboard New (objectstack#36907): the app's root with the arrival
 *     that enters the design mode, decision 6 and the pair leg picking the
 *     app; no app or a phone, the area's own create; the report New unchanged.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom';

/**
 * The area's create, reduced to its Save: it publishes (the server's half is
 * `published` below) and lands on the item exactly as `ResourceEditPage` does,
 * with the same `replace` rule.
 */
function CreateStub() {
  const navigate = useNavigate();
  const { type = '' } = useParams<{ type: string }>();
  const { search } = useLocation();
  const host = useMetadataAreaHost();
  return (
    <div data-testid="area-page" data-page="create">
      <button
        type="button"
        onClick={() => {
          published.add(`${type}/made_here`);
          navigate(`../made_here${search}`, { relative: 'path', replace: studioCreateLandsInApp(host?.packageId, type) });
        }}
      >
        save the new item
      </button>
    </div>
  );
}

vi.mock('../metadata-admin/index.js', () => ({
  MetadataDirectoryPage: () => <div data-testid="area-page" data-page="directory" />,
  MetadataDiagnosticsPage: () => <div data-testid="area-page" data-page="diagnostics" />,
  MetadataResourceListPage: () => <div data-testid="area-page" data-page="list" />,
  MetadataResourceEditPage: ({ createMode }: { createMode?: boolean }) =>
    createMode ? <CreateStub /> : <div data-testid="area-page" data-page="item" />,
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
/** The dashboards and reports that have a published version (`type/name`); every other one is a draft only. */
const published = vi.hoisted(() => new Set<string>());
/** The item reads asked, as `[type, name, options]`; `failing` makes them refuse. */
const itemReads = vi.hoisted(() => ({ calls: [] as Array<[string, string, unknown]>, failing: false }));
vi.mock('../metadata-admin/useMetadata.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({
    list: async (type: string, options: { packageId?: string }) => {
      apps.listCalls.push([type, options]);
      return apps.byPackage.get(options.packageId ?? '') ?? [];
    },
    get: async (type: string, name: string, options?: unknown) => {
      if (type === 'app') return apps.byName.get(name) ?? null;
      itemReads.calls.push([type, name, options]);
      if (itemReads.failing) throw new Error('503 Service Unavailable');
      // Without draft preview the door answers the published version, or 404 (`null`).
      return published.has(`${type}/${name}`) ? { name } : null;
    },
  }),
}));

import { StudioMetadataArea } from './StudioMetadataArea';
import { studioCreateLandsInApp } from './studioAppEdit';
import { useMetadataAreaHost } from '../metadata-admin/metadataAreaHost';
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
  published.clear();
  for (const item of ['dashboard/ops_board', 'report/pipeline']) published.add(item);
  itemReads.calls = [];
  itemReads.failing = false;
  resetAppReturnPageForTests();
});
afterEach(() => {
  cleanup();
  resetAppReturnPageForTests();
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: DESKTOP_WIDTH });
});

/** jsdom's window width, a desktop's; a phone is under 768 px (`usePhoneViewport`). */
const DESKTOP_WIDTH = window.innerWidth;
const phoneWidth = () => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });

/** The app page the area hands over to: its address, its landing and how it was reached; and the browser's Back. */
function AppPage() {
  const { pathname, search, state } = useLocation();
  const how = useNavigationType();
  const navigate = useNavigate();
  return (
    <div data-testid="app-page" data-at={`${pathname}${search}`} data-state={JSON.stringify(state)} data-how={how}>
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
    </div>
  );
}

function PackageArea() {
  const { pathname } = useLocation();
  const packageId = decodeURIComponent(pathname.split('/')[2] ?? '');
  return <StudioMetadataArea key={packageId} packageId={packageId} />;
}

function mount(url: string, earlier: string[] = []) {
  return render(
    <MemoryRouter initialEntries={[...earlier, url]}>
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
    // The one read of the item, asked of the open package.
    expect(itemReads.calls).toEqual([['dashboard', 'ops_board', { packageId: PKG }]]);
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
    // A plain package is no pair: its apps are the only ones read.
    expect(apps.listCalls).toEqual([['app', { packageId: PKG }]]);
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
    // The cross-package leg itself (with `?package=` the area moves the open to that package's leg).
    mount('/studio/~all/metadata/dashboard/ops_board');
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

  it('with no app to open, the area creates as before', async () => {
    apps.byPackage.set(PKG, []);
    mount(`/studio/${PKG}/metadata/report/new?package=${PKG}`);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('create');
  });
});

describe('an item with no published version keeps the generic item page (objectstack#36906)', () => {
  it('a draft-only dashboard row keeps the item page, and no app is read', async () => {
    mount(`/studio/${PKG}/metadata/dashboard/ai_drafted?package=${PKG}`);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('item');
    expect(screen.queryByTestId('app-page')).toBeNull();
    expect(itemReads.calls).toEqual([['dashboard', 'ai_drafted', { packageId: PKG }]]);
    expect(apps.listCalls).toEqual([]);
  });

  it('so does a draft-only report, and an item whose read fails', async () => {
    mount(`/studio/${PKG}/metadata/report/refused_publish?package=${PKG}`);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('item');
    cleanup();
    itemReads.failing = true;
    mount(`/studio/${PKG}/metadata/dashboard/ops_board?package=${PKG}`);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('item');
    expect(screen.queryByTestId('app-page')).toBeNull();
  });

  it("a dashboard made by the area's create (a phone's) opens in its app, and Back from there lands on the list", async () => {
    // objectstack#36907 — elsewhere a dashboard's New opens the app's design mode.
    phoneWidth();
    const list = `/studio/${PKG}/metadata/dashboard?package=${PKG}`;
    mount(`/studio/${PKG}/metadata/dashboard/new?package=${PKG}`, [list]);
    fireEvent.click(await screen.findByText('save the new item'));
    const opened = await appPage();
    expect(opened.at.split('?')[0]).toBe(`/apps/${PKG}/dashboard/made_here`);
    expect(opened.state).toEqual({ designModeNewDashboard: 'made_here' });
    expect(studioOf(opened.at)).toBe(list);
    fireEvent.click(screen.getByText('back'));
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('list');
  });

  it('the create landing is replaced only where the item opens in an app', () => {
    expect(studioCreateLandsInApp(PKG, 'dashboard')).toBe(true);
    expect(studioCreateLandsInApp(PKG, 'report')).toBe(true);
    expect(studioCreateLandsInApp(PKG, 'view')).toBe(false);
    expect(studioCreateLandsInApp(null, 'dashboard')).toBe(false);
    expect(studioCreateLandsInApp(undefined, 'report')).toBe(false);
  });
});

describe('a read-only base (objectstack#36906)', () => {
  const BASE = 'com.example.hr';
  const PAIR = `${BASE}.custom`;
  const customizationOf = (walled: boolean) =>
    ({ base: BASE, baseLabel: 'HR', basedOn: null, walled, pairId: null, ensure: async () => PAIR, ensurePackage: vi.fn() }) as any;

  beforeEach(() => {
    listed.value.set(BASE, { id: BASE, name: 'HR', writable: false, manifest: {} });
    listed.value.set(PAIR, { id: PAIR, name: 'HR (customizations)', writable: true, manifest: {} });
    apps.byPackage.set(BASE, [{ name: 'hr_app', label: 'HR' }]);
    published.add('dashboard/headcount');
  });

  function mountBase(url: string, customization: unknown) {
    return render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path={`/studio/${BASE}/metadata/*`} element={<StudioMetadataArea packageId={BASE} customization={customization as any} />} />
          <Route path="/studio/:packageId/metadata/*" element={<PackageArea />} />
          <Route path="/apps/*" element={<AppPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("a base dashboard row opens in the base's app", async () => {
    mountBase(`/studio/${BASE}/metadata/dashboard/headcount?package=${BASE}`, customizationOf(false));
    const opened = await appPage();
    expect(opened.at.split('?')[0]).toBe(`/apps/${BASE}/dashboard/headcount`);
    expect(opened.state).toEqual({ designModeNewDashboard: 'headcount' });
    expect(studioOf(opened.at)).toBe(`/studio/${BASE}/metadata/dashboard?package=${BASE}`);
  });

  it("report New opens the base app's new-report page (it saves in the pair), returning to the list", async () => {
    mountBase(`/studio/${BASE}/metadata/report/new?package=${BASE}`, customizationOf(false));
    const opened = await appPage();
    expect(opened.at.split('?')[0]).toBe(`/apps/${BASE}/reports/new`);
    expect(studioOf(opened.at)).toBe(`/studio/${BASE}/metadata/report?package=${BASE}`);
  });

  it('where the pair door is closed, report New goes back to the list, as every create there does', async () => {
    mountBase(`/studio/${BASE}/metadata/report/new?package=${BASE}`, customizationOf(true));
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('list');
    expect(screen.queryByTestId('app-page')).toBeNull();
    cleanup();
    mountBase(`/studio/${BASE}/metadata/report/new?package=${BASE}`, null);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('list');
    expect(apps.listCalls).toEqual([]);
  });
});

describe("a customization pair's dashboard or report opens in its base's app (objectstack#37237)", () => {
  const BASE = 'com.example.hr';
  const PAIR = `${BASE}.custom`;
  const pairList = (type: string) => `/studio/${PAIR}/metadata/${type}?package=${PAIR}`;

  beforeEach(() => {
    listed.value.set(BASE, { id: BASE, name: 'HR', writable: false, manifest: {} });
    listed.value.set(PAIR, { id: PAIR, name: 'HR (customizations)', writable: true, manifest: {} });
    apps.byPackage.set(BASE, [{ name: 'hr_app', label: 'HR' }]);
    for (const item of ['dashboard/headcount', 'report/attrition']) published.add(item);
  });

  it("a pair dashboard opens in the base app's edit state, and × returns to the pair's list", async () => {
    mount(`/studio/${PAIR}/metadata/dashboard/headcount?package=${PAIR}`);
    const opened = await appPage();
    // The base ships one app: its address is the base's id, never the pair's.
    expect(opened.at.split('?')[0]).toBe(`/apps/${BASE}/dashboard/headcount`);
    expect(opened.state).toEqual({ designModeNewDashboard: 'headcount' });
    expect(studioOf(opened.at)).toBe(pairList('dashboard'));
    expect(opened.how).toBe('REPLACE');
    // One read more, and only of the base: the item itself is asked of the pair.
    expect(apps.listCalls).toEqual([
      ['app', { packageId: PAIR }],
      ['app', { packageId: BASE }],
    ]);
    expect(itemReads.calls).toEqual([['dashboard', 'headcount', { packageId: PAIR }]]);
  });

  it("reached from the base's list: a row of the pair links `?package=PAIR`, which re-roots the area onto the pair", async () => {
    mount(`/studio/${BASE}/metadata/dashboard/headcount?package=${PAIR}`);
    const opened = await appPage();
    expect(opened.at.split('?')[0]).toBe(`/apps/${BASE}/dashboard/headcount`);
    expect(studioOf(opened.at)).toBe(pairList('dashboard'));
    expect(itemReads.calls).toEqual([['dashboard', 'headcount', { packageId: PAIR }]]);
  });

  it("a pair report opens the base app's builder, picked by decision 6 among the base's apps", async () => {
    apps.byPackage.set(BASE, [{ name: 'hr_people' }, { name: 'hr_reports' }]);
    rememberAppReturnPage({ path: '/apps/hr_reports/home', app: 'hr_reports', label: 'HR Reports' });
    mount(`/studio/${PAIR}/metadata/report/attrition?package=${PAIR}`);
    const opened = await appPage();
    expect(opened.at.split('?')[0]).toBe('/apps/hr_reports/report/attrition');
    expect(opened.state).toEqual({ openReportBuilder: 'attrition' });
    expect(studioOf(opened.at)).toBe(pairList('report'));
    cleanup();

    // No remembered app: the base's first app (rule 2).
    resetAppReturnPageForTests();
    mount(`/studio/${PAIR}/metadata/report/attrition?package=${PAIR}`);
    expect((await appPage()).at.split('?')[0]).toBe('/apps/hr_people/report/attrition');
  });

  it('a pair whose base has no published app keeps the generic item page', async () => {
    apps.byPackage.set(BASE, []);
    mount(`/studio/${PAIR}/metadata/dashboard/headcount?package=${PAIR}`);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('item');
    expect(screen.queryByTestId('app-page')).toBeNull();
    expect(apps.listCalls).toEqual([
      ['app', { packageId: PAIR }],
      ['app', { packageId: BASE }],
    ]);
  });

  it("a pair with a published app of its own opens there; the base's apps are not read", async () => {
    apps.byPackage.set(PAIR, [{ name: 'hr_custom_app' }]);
    mount(`/studio/${PAIR}/metadata/dashboard/headcount?package=${PAIR}`);
    expect((await appPage()).at.split('?')[0]).toBe(`/apps/${PAIR}/dashboard/headcount`);
    expect(apps.listCalls).toEqual([['app', { packageId: PAIR }]]);
  });
});

describe("the dashboard list's New opens the app's design mode on its dashboards (objectstack#36907)", () => {
  const LIST = `/studio/${PKG}/metadata/dashboard?package=${PKG}`;
  const entersDesignMode = (studioReturn: string) => ({ designModeAddDashboard: { studioReturn } });

  it("opens the app's root with the arrival that enters the mode; the address carries no mode, and Back lands on the list", async () => {
    mount(`/studio/${PKG}/metadata/dashboard/new?package=${PKG}&q=ops`, [LIST]);
    const opened = await appPage();
    // One app in the package: its address is the package id (ADR-0048 option A).
    expect(opened.at).toBe(`/apps/${PKG}`);
    expect(opened.state).toEqual(entersDesignMode(`${LIST}&q=ops`));
    expect(opened.how).toBe('REPLACE');
    expect(apps.listCalls).toEqual([['app', { packageId: PKG }]]);
    expect(itemReads.calls).toEqual([]);
    fireEvent.click(screen.getByText('back'));
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('list');
  });

  it('the app is picked by decision 6: the remembered app among the package apps, else the first', async () => {
    apps.byPackage.set(PKG, [{ name: 'sales' }, { name: 'service' }]);
    rememberAppReturnPage({ path: '/apps/service/home', app: 'service', label: 'Service' });
    mount(`/studio/${PKG}/metadata/dashboard/new?package=${PKG}`);
    expect((await appPage()).at).toBe('/apps/service');
    cleanup();
    resetAppReturnPageForTests();
    mount(`/studio/${PKG}/metadata/dashboard/new?package=${PKG}`);
    expect((await appPage()).at).toBe('/apps/sales');
  });

  it("with no app to open, the area's own create; on a phone too, with no app read", async () => {
    apps.byPackage.set(PKG, []);
    mount(`/studio/${PKG}/metadata/dashboard/new?package=${PKG}`);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('create');
    expect(screen.queryByTestId('app-page')).toBeNull();
    cleanup();
    apps.byPackage.set(PKG, [{ name: 'crm_app' }]);
    apps.listCalls = [];
    phoneWidth();
    mount(`/studio/${PKG}/metadata/dashboard/new?package=${PKG}`);
    expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('create');
    expect(apps.listCalls).toEqual([]);
  });

  describe('a read-only base and its pair', () => {
    const BASE = 'com.example.hr';
    const PAIR = `${BASE}.custom`;
    const customizationOf = (walled: boolean) =>
      ({ base: BASE, baseLabel: 'HR', basedOn: null, walled, pairId: null, ensure: async () => PAIR, ensurePackage: vi.fn() }) as any;

    beforeEach(() => {
      listed.value.set(BASE, { id: BASE, name: 'HR', writable: false, manifest: {} });
      listed.value.set(PAIR, { id: PAIR, name: 'HR (customizations)', writable: true, manifest: {} });
      apps.byPackage.set(BASE, [{ name: 'hr_app', label: 'HR' }]);
    });

    function mountBase(url: string, customization: unknown) {
      return render(
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path={`/studio/${BASE}/metadata/*`} element={<StudioMetadataArea packageId={BASE} customization={customization as any} />} />
            <Route path="/apps/*" element={<AppPage />} />
          </Routes>
        </MemoryRouter>,
      );
    }

    it("a base's New opens the base's app (what the mode saves goes to the pair); walled, it goes back to the list", async () => {
      mountBase(`/studio/${BASE}/metadata/dashboard/new?package=${BASE}`, customizationOf(false));
      const opened = await appPage();
      expect(opened.at).toBe(`/apps/${BASE}`);
      expect(opened.state).toEqual(entersDesignMode(`/studio/${BASE}/metadata/dashboard?package=${BASE}`));
      cleanup();
      apps.listCalls = [];
      mountBase(`/studio/${BASE}/metadata/dashboard/new?package=${BASE}`, customizationOf(true));
      expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('list');
      expect(apps.listCalls).toEqual([]);
    });

    it("the pair leg: a pair's New, the pair publishing no app, opens its base's app, one read more", async () => {
      mount(`/studio/${PAIR}/metadata/dashboard/new?package=${PAIR}`);
      const opened = await appPage();
      expect(opened.at).toBe(`/apps/${BASE}`);
      expect(opened.state).toEqual(entersDesignMode(`/studio/${PAIR}/metadata/dashboard?package=${PAIR}`));
      expect(apps.listCalls).toEqual([
        ['app', { packageId: PAIR }],
        ['app', { packageId: BASE }],
      ]);
    });

    it("the pair leg picks among the base's apps by decision 6; a base with no app, the area's own create", async () => {
      apps.byPackage.set(BASE, [{ name: 'hr_people' }, { name: 'hr_reports' }]);
      rememberAppReturnPage({ path: '/apps/hr_reports/home', app: 'hr_reports', label: 'HR Reports' });
      mount(`/studio/${PAIR}/metadata/dashboard/new?package=${PAIR}`);
      expect((await appPage()).at).toBe('/apps/hr_reports');
      cleanup();
      apps.byPackage.set(BASE, []);
      mount(`/studio/${PAIR}/metadata/dashboard/new?package=${PAIR}`);
      expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('create');
    });

    it("CONTROL — a pair's report New keeps the area's own create: the pair leg is the dashboard New's alone", async () => {
      mount(`/studio/${PAIR}/metadata/report/new?package=${PAIR}`);
      expect((await screen.findByTestId('area-page')).getAttribute('data-page')).toBe('create');
      expect(apps.listCalls).toEqual([['app', { packageId: PAIR }]]);
    });
  });
});
