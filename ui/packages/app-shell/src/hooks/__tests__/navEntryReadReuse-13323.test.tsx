// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13323 — a navigation entry and a page element bound to the same API
 * read make ONE request in one console open.
 *
 * The nav gate (`useNavMemberGates`, objectui#13029) reads an entry's
 * `{ provider: 'api', read: { url } }` through `readElementApi`, and the page
 * element bound to the same read (`useElementApiDataSource`) reads it again
 * when it mounts. `readElementApi` shares a request only while it is in flight,
 * so when the nav read had settled first a second `GET` went out for an answer
 * the console already held (cloud's `console-boots`: `/api/v1/cloud/home x2`).
 *
 * Mounted here over the real `ConsoleElementApiOpen` (the scope
 * `ConnectedShellInner` mounts), the real `ExpressionProvider` and
 * `MePermissionsProvider`, a stubbed host `apiFetch`, and the real
 * `SchemaRenderer` for the page element, which mounts only once the test
 * says so: after the nav read has settled, the case in-flight sharing misses.
 *
 *  (a) one open: the element takes the nav gate's answer — one call;
 *  (b) the app root's landing replaces its address with the page: still one;
 *  (c) a new open (a PUSH, then a POP) reads again;
 *  (c') Back to an entry visited before is a new open too, even when nothing
 *       was read in between (a history entry keeps its key; the open's name
 *       must not);
 *  (d) a declared data change (an action's write) ends the reuse;
 *  (e) a failed nav read is not reused: the element asks again;
 *  (f) CONTROL: with no open scope, two calls — the defect as it was.
 *
 * Each case uses its own URL: `readElementApi` shares a pending request per URL
 * for the life of the module.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';

// Module scope, never a `beforeAll` (AGENTS.md §测试纪律, objectui#3010).
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererContext, MetadataCtx, notifyDataChanged, type ApiFetch } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import type { NavigationItem } from '@object-ui/types';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { ConsoleElementApiOpen } from '../../console/ConsoleElementApiOpen';
import { useNavMemberGates, navEntriesShownToMember } from '../useNavMemberGates';

const ANSWER: MePermissionsResponse = {
  authenticated: true,
  userId: 'u_member',
  tenantId: null,
  roles: [],
  permissionSets: [],
  systemPermissions: [],
  objects: {},
  fields: {},
};

let urlSeq = 0;
/** A URL no earlier case asked for. */
function freshUrl(): string {
  urlSeq += 1;
  return `/api/v1/reuse-probe/${urlSeq}`;
}

function binding(url: string) {
  return { provider: 'api', read: { url }, path: 'data' };
}

/** The app: an entry shown when the bound value has `total: 1`, as cloud's `nav_environments`. */
function appFor(url: string) {
  const navigation = [
    { id: 'nav_home', type: 'page', pageName: 'home', label: 'Home', visible: true },
    { id: 'nav_envs', type: 'page', pageName: 'welcome', label: 'Environments', visible: 'data.total == 1', dataSource: binding(url) },
  ] as NavigationItem[];
  return { name: 'crm', label: 'CRM', active: true, navigation };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function metadata(app: Record<string, unknown>) {
  return {
    apps: [app],
    objects: [],
    dashboards: [],
    reports: [],
    pages: [],
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

/** Draws the `total` its binding selected. */
function ReuseProbe({ schema }: { schema: { properties?: Record<string, unknown> } }) {
  return <span data-testid="reuse-probe">{String(schema.properties?.content ?? '')}</span>;
}

/** The labels the member is shown, as the sidebar computes them. */
function NavHost({ items }: { items: NavigationItem[] }) {
  const gates = useNavMemberGates();
  const shown = navEntriesShownToMember(items, gates).map((item) => item.label);
  return <div data-testid="nav">{shown.join(',')}</div>;
}

let showPage: () => void = () => {};
let navigateTo: NavigateFunction = () => {};

/** The page: one element bound to `url`, mounted only when the test says so. */
function Page({ url, page }: { url: string; page: string }) {
  const [shown, setShown] = React.useState(false);
  const navigate = useNavigate();
  React.useEffect(() => {
    showPage = () => setShown(true);
    navigateTo = navigate;
  }, [navigate]);
  return (
    <div data-testid={`page-${page}`}>
      {shown && (
        <SchemaRenderer
          schema={{ type: 'reuse-probe', id: `el_${page}`, dataSource: binding(url), properties: { content: '${data.total}' } } as never}
        />
      )}
    </div>
  );
}

function mount(url: string, apiFetch: ApiFetch, opts: { scope?: boolean; at?: string } = {}) {
  const app = appFor(url);
  const routes = (
    <Routes>
      <Route
        path="/apps/crm/page/:page"
        element={
          <>
            <NavHost items={app.navigation} />
            <RoutePage url={url} />
          </>
        }
      />
      <Route path="/apps/crm" element={<><NavHost items={app.navigation} /><Landing /></>} />
      <Route path="/apps/crm/plain" element={<><NavHost items={app.navigation} /><Landing /></>} />
    </Routes>
  );
  render(
    <SchemaRendererContext.Provider value={{ dataSource: null, apiFetch }}>
      <MePermissionsProvider initialPermissions={ANSWER}>
        <MetadataCtx.Provider value={metadata(app) as never}>
          <ExpressionProvider app={app}>
            <MemoryRouter initialEntries={[opts.at ?? '/apps/crm/page/welcome']}>
              {opts.scope === false ? routes : <ConsoleElementApiOpen>{routes}</ConsoleElementApiOpen>}
            </MemoryRouter>
          </ExpressionProvider>
        </MetadataCtx.Provider>
      </MePermissionsProvider>
    </SchemaRendererContext.Provider>,
  );
}

/** The page route: another page is another element, as the console's page route renders it. */
function RoutePage({ url }: { url: string }) {
  const page = useLocation().pathname.split('/').pop() ?? '';
  return <Page key={page} url={url} page={page} />;
}

/** The app root: replaces its address with the page once the test says so, as the landing does. */
function Landing() {
  const navigate = useNavigate();
  React.useEffect(() => {
    navigateTo = navigate;
  }, [navigate]);
  return <div data-testid="landing" />;
}

function callsFor(apiFetch: ReturnType<typeof vi.fn>, url: string): number {
  return apiFetch.mock.calls.filter(([input]) => input === url).length;
}

/** Wait for the nav gate's read to settle and draw the bound entry. */
async function navSettled() {
  await waitFor(() => expect(screen.getByTestId('nav').textContent).toBe('Home,Environments'));
}

async function mountPageElement(expected: string) {
  act(() => showPage());
  await waitFor(() => expect(screen.getByTestId('reuse-probe').textContent).toBe(expected));
}

beforeEach(() => {
  cleanup();
  ComponentRegistry.register('reuse-probe', ReuseProbe as never);
});

afterEach(() => {
  ComponentRegistry.unregister?.('reuse-probe');
});

describe('objectui#13323 — a nav entry and a page element bound to the same read make one request per open', () => {
  it('(a) one open: the page element takes the answer the nav gate already read', async () => {
    const url = freshUrl();
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ data: { total: 1 } }));
    mount(url, apiFetch);
    await navSettled();
    expect(callsFor(apiFetch, url)).toBe(1);
    // The nav read has SETTLED before the element mounts: no request is in
    // flight to share.
    await mountPageElement('1');
    expect(callsFor(apiFetch, url)).toBe(1);
  });

  it('(b) the landing replaces the app root with the page: the same open, one call', async () => {
    const url = freshUrl();
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ data: { total: 1 } }));
    mount(url, apiFetch, { at: '/apps/crm' });
    await navSettled();
    act(() => navigateTo('/apps/crm/page/welcome', { replace: true }));
    await waitFor(() => expect(screen.getByTestId('page-welcome')).toBeInTheDocument());
    await mountPageElement('1');
    expect(callsFor(apiFetch, url)).toBe(1);
  });

  it('(c) a new open reads again: a PUSH to another page, then Back', async () => {
    const url = freshUrl();
    let total = 1;
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ data: { total } }));
    mount(url, apiFetch);
    await navSettled();
    await mountPageElement('1');
    expect(callsFor(apiFetch, url)).toBe(1);

    total = 2;
    act(() => navigateTo('/apps/crm/page/pricing'));
    await waitFor(() => expect(screen.getByTestId('page-pricing')).toBeInTheDocument());
    await mountPageElement('2');
    expect(callsFor(apiFetch, url)).toBe(2);

    total = 3;
    act(() => navigateTo(-1));
    await waitFor(() => expect(screen.getByTestId('page-welcome')).toBeInTheDocument());
    await mountPageElement('3');
    expect(callsFor(apiFetch, url)).toBe(3);
  });

  it("(c') Back to the page after a page that reads nothing is a new open: the element reads again", async () => {
    const url = freshUrl();
    let total = 1;
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ data: { total } }));
    mount(url, apiFetch);
    await navSettled();
    await mountPageElement('1');
    expect(callsFor(apiFetch, url)).toBe(1);

    // A page with no binding: nothing is read on this visit, so nothing the
    // first visit kept is replaced by a read of this one.
    act(() => navigateTo('/apps/crm/plain'));
    await waitFor(() => expect(screen.getByTestId('landing')).toBeInTheDocument());
    expect(callsFor(apiFetch, url)).toBe(1);

    // Back restores the first entry, and its key with it.
    total = 5;
    act(() => navigateTo(-1));
    await waitFor(() => expect(screen.getByTestId('page-welcome')).toBeInTheDocument());
    await mountPageElement('5');
    expect(callsFor(apiFetch, url)).toBe(2);
  });

  it('(d) a declared data change ends the reuse: the element reads after it', async () => {
    const url = freshUrl();
    let total = 1;
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ data: { total } }));
    mount(url, apiFetch);
    await navSettled();
    total = 4;
    // What an action's write reports (`notifyDataChanged`, objectui#2269).
    act(() => notifyDataChanged({ objectName: 'account' }));
    await mountPageElement('4');
    expect(callsFor(apiFetch, url)).toBe(2);
  });

  it('(e) a failed nav read is not reused: the element asks again', async () => {
    const url = freshUrl();
    const apiFetch = vi
      .fn<ApiFetch>()
      .mockImplementationOnce(async () => jsonResponse({}, 500))
      .mockImplementation(async () => jsonResponse({ data: { total: 1 } }));
    mount(url, apiFetch);
    await waitFor(() => expect(callsFor(apiFetch, url)).toBe(1));
    // Fail-closed (objectui#13029): the bound entry stays hidden.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByTestId('nav').textContent).toBe('Home');
    await mountPageElement('1');
    expect(callsFor(apiFetch, url)).toBe(2);
  });

  it('(f) CONTROL: without the open scope the element reads again — the defect as it was', async () => {
    const url = freshUrl();
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ data: { total: 1 } }));
    mount(url, apiFetch, { scope: false });
    await navSettled();
    await mountPageElement('1');
    expect(callsFor(apiFetch, url)).toBe(2);
  });
});
