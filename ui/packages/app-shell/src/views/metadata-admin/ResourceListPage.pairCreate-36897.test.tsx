// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36897 — the list's 「新建」 on a read-only base in Studio's area.
 *
 *  - It is offered: the item is created in the base's paired `.custom`
 *    package (ADR-0146 D3). An object and a flow open the list's own create
 *    dialog (`MetadataListCreateDialog`, whose landing is its own suite);
 *    another type goes to the area's create, which moves to the pair.
 *  - Where the area opens no create in the pair (`host.pairCreate`: the
 *    customization wall, under which the server refuses the pair's ensure
 *    for this caller) nothing is offered.
 *  - Setup (no area) is unchanged — the control: its 「新建」 goes to the
 *    item page's create and opens no dialog.
 *
 * objectstack#36907 — a dashboard list's 「新建」 in the area opens an app's
 * design mode, so it is offered only where an app opens (decision 6, the
 * pair leg included), never on a phone; with no app the list says why. The
 * report list's 「新建」 is the control: it reads no app.
 */

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/lint';
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@objectstack/spec/identity';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';

const BASE = 'hotcrm';

/** objectstack#36907 — the published apps per package (unset: one app), and the app reads asked. */
const APPS = { byPackage: new Map<string, unknown[]>(), reads: [] as string[], hold: null as Promise<void> | null };
/** Types whose list is empty, for the empty state's hint. */
const EMPTY_TYPES = new Set<string>();
const CLIENT = {
  list: async (type: string, options?: { packageId?: string }) => {
    if (type === 'app') {
      APPS.reads.push(options?.packageId ?? '');
      if (APPS.hold) await APPS.hold;
      return APPS.byPackage.get(options?.packageId ?? '') ?? [{ name: 'crm_app_one', label: 'One app' }];
    }
    if (EMPTY_TYPES.has(type)) return [];
    return type === 'package'
      ? [{ manifest: { id: BASE, name: 'HotCRM', scope: 'installed' } }]
      : [{ name: `crm_${type}_one`, label: `One ${type}`, _packageId: BASE }];
  },
};
const entry = (type: string, domain: string) => ({ type, label: type, domain, allowEnvironmentOverlay: false, allowRuntimeCreate: true });
const ENTRIES = [
  entry('object', 'data'),
  entry('flow', 'automation'),
  entry('email_template', 'system'),
  entry('dashboard', 'ui'),
  entry('report', 'ui'),
];

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: ENTRIES }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
}));

import { MetadataResourceListPage } from './ResourceListPage';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { t } from './i18n';

registerDefaultMetadataSchemas();

const fetchMock = vi.fn(async (url: string) => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const u = String(url);
  if (u === '/api/v1/packages') {
    return json(200, { success: true, data: { packages: [{ manifest: { id: BASE, name: 'HotCRM', scope: 'installed' }, writable: false }] } });
  }
  if (u.endsWith('/customizations')) {
    return json(200, {
      success: true,
      data: { packageId: BASE, overrides: [], extensions: [], switchedOff: [], arrangements: [], contributions: [], counts: { overrides: 0, extensions: 0, switchedOff: 0, arrangements: 0, contributions: 0 } },
    });
  }
  if (u.startsWith('/api/v1/data/sys_metadata_activation')) {
    return json(200, { object: 'sys_metadata_activation', records: [], hasMore: false });
  }
  return json(404, { success: false });
});

const DESKTOP_WIDTH = window.innerWidth;
beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  APPS.byPackage = new Map();
  APPS.reads = [];
  APPS.hold = null;
  EMPTY_TYPES.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: DESKTOP_WIDTH });
});

const READ_ONLY_BASE: MetadataAreaHost = { packageId: BASE, readOnly: true, basePath: `/studio/${BASE}/metadata`, pairCreate: true };
/** The area opens no create in the pair: its ensure door refuses this caller (the wall), or it has no customization. */
const NO_PAIR_CREATE: MetadataAreaHost = { ...READ_ONLY_BASE, pairCreate: false };

function Location() {
  const l = useLocation();
  return <div data-testid="location">{`${l.pathname}${l.search}`}</div>;
}

function mount(host: MetadataAreaHost | null, type: string) {
  const base = host?.basePath ?? '/apps/setup/metadata';
  const tree = (
    <MemoryRouter initialEntries={[`${base}/${type}${host ? `?package=${host.packageId}` : ''}`]}>
      <Routes>
        <Route path={`${base}/${type}`} element={<MetadataResourceListPage type={type} />} />
        <Route path="*" element={null} />
      </Routes>
      <Location />
    </MemoryRouter>
  );
  return render(host ? <MetadataAreaHostContext.Provider value={host}>{tree}</MetadataAreaHostContext.Provider> : tree);
}

// The header's New: "New X" in the Studio area (objectstack#37918), "New" in Setup.
const createButton = () => screen.queryByTestId('metadata-list-create');

describe('the list offers 「新建」 on a read-only base, into its pair (objectstack#36897)', () => {
  it('an object: 新建 is offered and opens the list create dialog', async () => {
    mount(READ_ONLY_BASE, 'object');
    await screen.findByTestId(`metadata-row-crm_object_one`);
    fireEvent.click(createButton()!);
    expect(await screen.findByTestId('create-object-owd')).toBeInTheDocument();
  });

  it('a flow: 新建 opens the starting points', async () => {
    mount(READ_ONLY_BASE, 'flow');
    await screen.findByTestId(`metadata-row-crm_flow_one`);
    fireEvent.click(createButton()!);
    expect(await screen.findByTestId('create-flow-preset-manual')).toBeInTheDocument();
  });

  it("another type goes to the area's create, which moves it to the pair", async () => {
    mount(READ_ONLY_BASE, 'email_template');
    await screen.findByTestId(`metadata-row-crm_email_template_one`);
    fireEvent.click(createButton()!);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/studio/${BASE}/metadata/email_template/new?package=${BASE}`));
  });

  it('where the area opens no create in the pair (the customization wall) nothing is offered', async () => {
    mount(NO_PAIR_CREATE, 'object');
    await screen.findByTestId(`metadata-row-crm_object_one`);
    expect(createButton()).toBeNull();
  });

  it('CONTROL — Setup: 新建 goes to the item create and opens no dialog', async () => {
    mount(null, 'object');
    await screen.findByTestId(`metadata-row-crm_object_one`);
    fireEvent.click(createButton()!);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/^\/apps\/setup\/metadata\/object\/new/));
    expect(screen.queryByTestId('create-object-owd')).toBeNull();
  });
});

describe("a dashboard list's 「新建」 in the area opens an app's design mode (objectstack#36907)", () => {
  const WRITABLE: MetadataAreaHost = { packageId: BASE, readOnly: false, basePath: `/studio/${BASE}/metadata` };
  const PAIR = `${BASE}.custom`;
  const reason = () => screen.queryByTestId('metadata-list-create-unavailable');
  // The header's 新建 (an empty list draws a second one in its empty state).
  const newButton = () => screen.queryByTestId('metadata-list-create');

  it("offered where an app opens: it goes to the area's create, which opens the app's design mode", async () => {
    mount(WRITABLE, 'dashboard');
    await screen.findByTestId('metadata-row-crm_dashboard_one');
    await waitFor(() => expect(newButton()).not.toBeNull());
    expect(reason()).toBeNull();
    expect(APPS.reads).toEqual([BASE]);
    fireEvent.click(newButton()!);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/studio/${BASE}/metadata/dashboard/new?package=${BASE}`));
  });

  it('with no app to open, no 新建, and the list says why', async () => {
    APPS.byPackage.set(BASE, []);
    mount(WRITABLE, 'dashboard');
    await screen.findByTestId('metadata-row-crm_dashboard_one');
    expect(await screen.findByTestId('metadata-list-create-unavailable')).toHaveTextContent(
      t('engine.list.dashboardNewNoApp', 'en-US'),
    );
    expect(newButton()).toBeNull();
  });

  it('on a phone, no 新建 and no app read: the design mode is never on there', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
    mount(WRITABLE, 'dashboard');
    // A phone draws the list as cards: wait for the list's reads to settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByTestId('location')).toHaveTextContent(`/studio/${BASE}/metadata/dashboard?package=${BASE}`);
    expect(newButton()).toBeNull();
    expect(reason()).toBeNull();
    expect(APPS.reads).toEqual([]);
  });

  it("a read-only base: offered by its own app; behind the customization wall nothing is offered, and no app is read", async () => {
    mount(READ_ONLY_BASE, 'dashboard');
    await screen.findByTestId('metadata-row-crm_dashboard_one');
    await waitFor(() => expect(newButton()).not.toBeNull());
    cleanup();
    APPS.reads = [];
    mount(NO_PAIR_CREATE, 'dashboard');
    await screen.findByTestId('metadata-row-crm_dashboard_one');
    expect(newButton()).toBeNull();
    expect(reason()).toBeNull();
    expect(APPS.reads).toEqual([]);
  });

  it("the pair leg: a pair publishing no app is offered by its base's app, one read more", async () => {
    APPS.byPackage.set(PAIR, []);
    mount({ packageId: PAIR, readOnly: false, basePath: `/studio/${PAIR}/metadata` }, 'dashboard');
    await waitFor(() => expect(newButton()).not.toBeNull());
    expect(APPS.reads).toEqual([PAIR, BASE]);
    cleanup();
    APPS.reads = [];
    APPS.byPackage.set(BASE, []);
    mount({ packageId: PAIR, readOnly: false, basePath: `/studio/${PAIR}/metadata` }, 'dashboard');
    expect(await screen.findByTestId('metadata-list-create-unavailable')).toBeInTheDocument();
    expect(newButton()).toBeNull();
  });

  it('CONTROL — the report list: 新建 offered with no app, and no app read', async () => {
    APPS.byPackage.set(BASE, []);
    mount(WRITABLE, 'report');
    await screen.findByTestId('metadata-row-crm_report_one');
    expect(newButton()).not.toBeNull();
    expect(reason()).toBeNull();
    expect(APPS.reads).toEqual([]);
  });
});

describe("an empty dashboard list's hint never says a writable package is read-only (objectstack#36907)", () => {
  const WRITABLE: MetadataAreaHost = { packageId: BASE, readOnly: false, basePath: `/studio/${BASE}/metadata` };
  const hint = () => screen.queryByTestId('metadata-list-empty-hint');
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

  beforeEach(() => {
    EMPTY_TYPES.add('dashboard');
  });

  it('on a phone it says a dashboard is made in an app\'s design mode on a wider screen', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
    mount(WRITABLE, 'dashboard');
    expect(await screen.findByTestId('metadata-list-empty-hint')).toHaveTextContent(
      t('engine.list.dashboardNewWiderScreen', 'en-US'),
    );
    expect(hint()).not.toHaveTextContent(t('engine.list.readOnlyHint', 'en-US'));
    expect(screen.queryByTestId('metadata-list-create')).toBeNull();
  });

  it("while the package's apps are read it says nothing yet, then the create hint once the New is offered", async () => {
    let release!: () => void;
    APPS.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    mount(WRITABLE, 'dashboard');
    await settle();
    // The empty state is drawn (its title), with no description under it yet.
    expect(screen.getByText(/^No .+ items registered$/)).toBeInTheDocument();
    expect(hint()).toBeNull();
    expect(screen.queryByTestId('metadata-list-create')).toBeNull();
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(await screen.findByTestId('metadata-list-empty-hint')).toHaveTextContent(/New/);
    expect(screen.getByTestId('metadata-list-create')).toBeInTheDocument();
  });

  it('CONTROL — with no app, the hint is the no-app reason', async () => {
    APPS.byPackage.set(BASE, []);
    mount(WRITABLE, 'dashboard');
    await waitFor(() => expect(hint()).toHaveTextContent(t('engine.list.dashboardNewNoApp', 'en-US')));
  });
});
