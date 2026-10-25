// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SidebarItemMenu: the ⋯ menu a sidebar entry shows on hover (objectui#12427).
 *
 * The entries derive from the entry's type and target: Add to / Remove from
 * favorites first, then Open in new tab and Copy link for an entry that goes
 * somewhere, then Design for an entry with a designer, shown only to a
 * principal who may author metadata (`isAdmin && canAuthorMetadata`). A
 * right-click on the row opens the same menu.
 *
 * Harness: the real component in a real `SidebarMenuItem` row, the real router
 * and the real `resolveHref` of `@object-ui/layout` for the entry's address;
 * the translator returns each call site's inline default, and the two
 * principal answers are stand-ins. The entry's app is owned by a package, so
 * Design has a Studio surface to open (objectui#12520), and the package list
 * serves that package writable, so the gate's package half passes
 * (objectui#12615).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) =>
        String(options?.[name] ?? ''),
      ),
    language: 'en',
  }),
}));

const viewer = vi.hoisted(() => ({ isAdmin: true, canAuthorMetadata: true }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: true }),
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => viewer.canAuthorMetadata,
}));

const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: toastSpy,
}));

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from '@object-ui/components';
import { resolveHref } from '@object-ui/layout';
import { SidebarItemMenu, sidebarItemDesignPath } from '../SidebarItemMenu';

const BASE_PATH = '/apps/crm';
/** The app the entries belong to, owned by a package Studio can open. */
const APP = { name: 'crm', _packageId: 'com.acme.crm' };

const LEADS = { id: 'nav_leads', type: 'object', objectName: 'crm_lead', label: 'Leads' } as NavigationItem;
const HELP = { id: 'nav_help', type: 'url', url: 'https://example.com/help', label: 'Help' } as NavigationItem;
const RUN = { id: 'nav_run', type: 'action', label: 'Run' } as NavigationItem;

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

interface RowOptions {
  item?: NavigationItem;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  basename?: string;
  app?: { name?: string; _packageId?: string };
}

/** One sidebar row, drawn the way the sidebar draws an entry, with the menu beside its link. */
function renderRow({ item = LEADS, isFavorite = false, onToggleFavorite = vi.fn(), basename, app = APP }: RowOptions = {}) {
  const { href, external } = resolveHref(item, BASE_PATH);
  const label = String(item.label);
  const address = item.type === 'action' ? undefined : href;
  return render(
    <MemoryRouter basename={basename} initialEntries={[`${basename ?? ''}${BASE_PATH}`]}>
      <SidebarProvider>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href={address ?? '#'} data-testid="row-link">{label}</a>
            </SidebarMenuButton>
            <SidebarItemMenu
              label={label}
              href={address}
              external={external}
              isFavorite={isFavorite}
              onToggleFavorite={onToggleFavorite}
              designPath={sidebarItemDesignPath(item, app)}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarProvider>
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const trigger = () => screen.getByTestId('sidebar-item-menu-trigger');

/** objectui#12615 — one macrotask, so the package list's verdict has settled. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

async function openMenu(): Promise<string[]> {
  await settle();
  fireEvent.keyDown(trigger(), { key: 'Enter' });
  const items = await screen.findAllByRole('menuitem');
  return items.map((el) => el.textContent ?? '');
}

beforeEach(() => {
  viewer.isAdmin = true;
  viewer.canAuthorMetadata = true;
  // objectui#12615 — the app's package is served writable, so the Design
  // gate's package half passes and this file's own questions are the ones asked.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith('/api/v1/packages')
          ? { data: { packages: [{ manifest: { id: 'com.acme.crm', name: 'CRM' }, writable: true }] } }
          : { data: [] },
    })),
  );
  toastSpy.success.mockReset();
  toastSpy.error.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SidebarItemMenu: the entries an object entry offers (objectui#12427)', () => {
  it('lists exactly four entries for a principal who may author metadata, Design last', async () => {
    renderRow();
    expect(await openMenu()).toEqual(['Add to favorites', 'Open in new tab', 'Copy link', 'Design']);
  });

  it('lists exactly three for a non-admin: no Design entry', async () => {
    viewer.isAdmin = false;
    renderRow();
    expect(await openMenu()).toEqual(['Add to favorites', 'Open in new tab', 'Copy link']);
  });

  it('lists exactly three for an admin the server refuses metadata authoring', async () => {
    viewer.canAuthorMetadata = false;
    renderRow();
    expect(await openMenu()).toEqual(['Add to favorites', 'Open in new tab', 'Copy link']);
  });

  it('names its trigger after the entry, and reveals it on hover only', () => {
    renderRow();
    expect(trigger()).toHaveAccessibleName('More actions for Leads');
    // `SidebarMenuAction`'s `showOnHover`: hidden at rest on a pointer screen,
    // shown while the row is hovered or focused, and while the menu is open.
    expect(trigger().className).toContain('md:opacity-0');
    expect(trigger().className).toContain('group-hover/menu-item:opacity-100');
  });
});

describe('SidebarItemMenu: what each entry does (objectui#12427)', () => {
  it('Design opens Studio\'s Data surface for the entry\'s object (objectui#12520)', async () => {
    renderRow();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Design' }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/studio/com.acme.crm/data?surface=object:crm_lead'),
    );
  });

  it('the favorites entry reflects the state and flips it once per select', async () => {
    const onToggleFavorite = vi.fn();
    renderRow({ isFavorite: true, onToggleFavorite });
    const names = await openMenu();
    expect(names[0]).toBe('Remove from favorites');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from favorites' }));
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
  });

  it('Open in new tab opens the entry under the router basename, in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderRow({ basename: '/_console' });
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in new tab' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('/_console/apps/crm/crm_lead', '_blank', 'noopener,noreferrer');
  });

  it('Copy link copies the absolute address under the router basename', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderRow({ basename: '/_console' });
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/_console/apps/crm/crm_lead`);
  });

  it('an external entry opens and copies its URL verbatim', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderRow({ item: HELP, basename: '/_console' });
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in new tab' }));
    expect(open).toHaveBeenCalledWith('https://example.com/help', '_blank', 'noopener,noreferrer');
  });
});

describe('SidebarItemMenu: entries an entry type does not offer (objectui#12427)', () => {
  it('a url entry shows no Design entry, even to an admin who may author metadata', async () => {
    renderRow({ item: HELP });
    expect(await openMenu()).toEqual(['Add to favorites', 'Open in new tab', 'Copy link']);
  });

  it('an action entry has no address: neither Open in new tab nor Copy link', async () => {
    renderRow({ item: RUN });
    expect(await openMenu()).toEqual(['Add to favorites']);
  });
});

describe('SidebarItemMenu: right-click (objectui#12427)', () => {
  it('a right-click on the row opens the same menu and keeps the browser menu shut', async () => {
    renderRow();
    await settle();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    const notPrevented = fireEvent.contextMenu(screen.getByTestId('row-link'));
    expect(notPrevented).toBe(false);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((el) => el.textContent)).toEqual(['Add to favorites', 'Open in new tab', 'Copy link', 'Design']);
  });
});

describe('sidebarItemDesignPath: the Studio surface per entry type (objectui#12427, objectui#12520)', () => {
  it('a page entry opens its Interfaces surface, as the app bar does on the page', () => {
    const page = { id: 'p', type: 'page', pageName: 'home_page', label: 'Home' } as NavigationItem;
    expect(sidebarItemDesignPath(page, APP)).toBe('/studio/com.acme.crm/interfaces?surface=page:home_page');
  });

  it('an object entry opens the Data surface, a dashboard entry the Interfaces surface', () => {
    expect(sidebarItemDesignPath(LEADS, APP)).toBe('/studio/com.acme.crm/data?surface=object:crm_lead');
    const dash = { id: 'd', type: 'dashboard', dashboardName: 'sales', label: 'Sales' } as NavigationItem;
    expect(sidebarItemDesignPath(dash, APP)).toBe('/studio/com.acme.crm/interfaces?surface=dashboard:sales');
  });

  it('url, component and separator entries have no designer', () => {
    const component = { id: 'c', type: 'component', componentRef: 'x:y', label: 'C' } as NavigationItem;
    const separator = { id: 's', type: 'separator' } as NavigationItem;
    expect(sidebarItemDesignPath(HELP, APP)).toBeNull();
    expect(sidebarItemDesignPath(component, APP)).toBeNull();
    expect(sidebarItemDesignPath(separator, APP)).toBeNull();
  });
});
