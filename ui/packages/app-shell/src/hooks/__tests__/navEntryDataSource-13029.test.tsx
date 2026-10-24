// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13029 — a navigation entry's API `dataSource` is read, and its
 * `visible` sees the selected value as `data`, on every navigation surface.
 *
 * The spec (`BaseNavItemSchema.dataSource`, `ElementApiDataSourceSchema` by
 * reference) lets an entry declare `{ provider: 'api', read: { url }, path? }`;
 * only its `visible` reads the bound value, as `data`. The shell builds ONE
 * evaluator for that, `useNavVisibility`, and each surface takes it from there:
 * the sidebar through `useNavMemberGates` (the host below hands the gates to the
 * real `NavigationRenderer` exactly as `UnifiedSidebar` does), the `nav:menu`
 * block and the command palette directly.
 *
 * Every surface is mounted over the real `ExpressionProvider`, the real
 * `MePermissionsProvider` and a stubbed `apiFetch` on `SchemaRendererContext`
 * (the seat `ConsoleShell` fills), and asked the same questions:
 *
 *  (a) `visible: 'data.total == 1'` shows the entry when the bound value has
 *      `total: 1`, and hides it when it has `total: 2`;
 *  (b) a pending read hides it, and a failed read (HTTP 500) hides it;
 *  (c) CONTROLS: an entry without `dataSource` shows on first paint with no
 *      request; a `visible` with no `data` reference on an entry WITH a
 *      `dataSource` still evaluates once the read answers;
 *  (d) `path` is honoured: the value at `path` is `data`, not the whole body.
 *
 * Each case uses its own URL: `readElementApi` shares a pending request per URL
 * for the life of the module, so a request a case leaves pending must not be
 * the one the next case asks for.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Module scope, never a `beforeAll` (AGENTS.md §测试纪律, objectui#3010).
import '@object-ui/components';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer } from '@object-ui/layout';
import { SchemaRenderer, SchemaRendererContext, MetadataCtx, type ApiFetch } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import type { NavigationItem } from '@object-ui/types';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { CommandPalette } from '../../chrome/CommandPalette';
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider';
import { useNavMemberGates } from '../useNavMemberGates';
import '../../views/nav-menu-renderer';

type Surface = 'sidebar' | 'nav:menu' | 'palette';
const SURFACES: Surface[] = ['sidebar', 'nav:menu', 'palette'];

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
  return `/api/v1/nav-probe/${urlSeq}`;
}

/**
 * The app: a plain entry, the entry under test (`data.total == 1`), and a
 * control bound to the same read whose `visible` names no `data`.
 */
function appFor(url: string, path: string | null = 'summary') {
  const dataSource = path === null
    ? { provider: 'api', read: { url } }
    : { provider: 'api', read: { url }, path };
  const navigation = [
    { id: 'nav_home', type: 'page', pageName: 'home', label: 'Home', visible: true },
    { id: 'nav_onboarding', type: 'page', pageName: 'onboarding', label: 'Onboarding', visible: 'data.total == 1', dataSource },
    { id: 'nav_tour', type: 'page', pageName: 'tour', label: 'Tour', visible: '2 > 1', dataSource },
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

/** The sidebar's hand-off: the member gates, given to the real `NavigationRenderer` as `UnifiedSidebar` gives them. */
function SidebarHost({ items }: { items: NavigationItem[] }) {
  const gates = useNavMemberGates();
  return (
    <SidebarProvider defaultOpen>
      <div data-testid="sidebar">
        <NavigationRenderer
          items={items}
          basePath="/apps/crm"
          evaluateVisibility={gates.evaluateVisibility}
          checkPermission={gates.checkPermission}
          checkCapability={gates.checkCapability}
        />
      </div>
    </SidebarProvider>
  );
}

function renderSurface(surface: Surface, app: ReturnType<typeof appFor>, apiFetch: ApiFetch) {
  const element =
    surface === 'sidebar' ? (
      <SidebarHost items={app.navigation} />
    ) : surface === 'nav:menu' ? (
      <SchemaRenderer schema={{ type: 'page:section', id: 's1', children: [{ type: 'nav:menu', id: 'blk_nav' }] } as never} />
    ) : (
      <CommandPaletteProvider>
        <CommandPalette apps={[app]} activeApp={app} objects={[]} onAppChange={() => {}} />
      </CommandPaletteProvider>
    );
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <SchemaRendererContext.Provider value={{ dataSource: null, apiFetch }}>
        <MePermissionsProvider initialPermissions={ANSWER}>
          <MetadataCtx.Provider value={metadata(app) as never}>
            <ExpressionProvider app={app}>
              <MemoryRouter initialEntries={[surface === 'palette' ? '/apps/crm?palette=1' : '/apps/crm']}>
                <Routes>
                  <Route path="/apps/:appName" element={element} />
                </Routes>
              </MemoryRouter>
            </ExpressionProvider>
          </MetadataCtx.Provider>
        </MePermissionsProvider>
      </SchemaRendererContext.Provider>
    </I18nProvider>,
  );
}

/** The entry labels the surface draws, in order. */
function drawn(surface: Surface): string[] {
  if (surface === 'palette') {
    return Array.from(document.querySelectorAll('[cmdk-item][data-value^="page "]')).map((el) =>
      (el.textContent ?? '').trim(),
    );
  }
  const root =
    surface === 'sidebar' ? screen.getByTestId('sidebar') : screen.getByRole('navigation', { name: 'App navigation' });
  return within(root)
    .queryAllByRole('link')
    .map((el) => (el.textContent ?? '').trim());
}

/** Let a settled read reach the state it sets. */
async function settle(apiFetch: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(apiFetch).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe.each(SURFACES)('objectui#13029 — a nav entry reads its API dataSource as `data` (%s)', (surface) => {
  it('(a) shown when the bound value has `total: 1`', async () => {
    const url = freshUrl();
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ summary: { total: 1 } }));
    renderSurface(surface, appFor(url), apiFetch);
    await waitFor(() => expect(drawn(surface)).toEqual(['Home', 'Onboarding', 'Tour']));
    expect(apiFetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'GET' }));
  });

  it('(a) hidden when the bound value has `total: 2`; the control on the same read still evaluates (c)', async () => {
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ summary: { total: 2 } }));
    renderSurface(surface, appFor(freshUrl()), apiFetch);
    // `Tour` (`visible: '2 > 1'`, no `data` reference) draws once the read answers.
    await waitFor(() => expect(drawn(surface)).toContain('Tour'));
    expect(drawn(surface)).toEqual(['Home', 'Tour']);
  });

  it('(b) a pending read hides both bound entries; the plain one draws on first paint', async () => {
    const apiFetch = vi.fn<ApiFetch>(() => new Promise<Response>(() => {}));
    renderSurface(surface, appFor(freshUrl()), apiFetch);
    expect(drawn(surface)).toEqual(['Home']);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(drawn(surface)).toEqual(['Home']);
  });

  it('(b) a failed read (HTTP 500) hides both bound entries', async () => {
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ summary: { total: 1 } }, 500));
    renderSurface(surface, appFor(freshUrl()), apiFetch);
    await settle(apiFetch);
    expect(drawn(surface)).toEqual(['Home']);
  });

  it('(d) the value at `path` is `data`, not the whole answer', async () => {
    // The whole answer has `total: 2`; the value at `summary` has `total: 1`.
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ total: 2, summary: { total: 1 } }));
    renderSurface(surface, appFor(freshUrl()), apiFetch);
    await waitFor(() => expect(drawn(surface)).toEqual(['Home', 'Onboarding', 'Tour']));
  });

  it('(d) without `path`, `data` is the whole answer', async () => {
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({ total: 2, summary: { total: 1 } }));
    renderSurface(surface, appFor(freshUrl(), null), apiFetch);
    await waitFor(() => expect(drawn(surface)).toContain('Tour'));
    expect(drawn(surface)).toEqual(['Home', 'Tour']);
  });

  it('(c) an app with no binding draws its entries on first paint and sends no request', () => {
    const apiFetch = vi.fn<ApiFetch>(async () => jsonResponse({}));
    const app = appFor(freshUrl());
    renderSurface(surface, { ...app, navigation: [app.navigation[0]] }, apiFetch);
    expect(drawn(surface)).toEqual(['Home']);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
