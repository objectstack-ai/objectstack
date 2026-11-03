// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * usePhoneNavDrawerHistory — on a phone, Back with the nav drawer open closes
 * the drawer and stays on the page (objectstack#29131). Before, Back left the
 * page the drawer was opened on.
 *
 * Harness: the provider / chrome mocks of
 * `UnifiedSidebar.phoneDrawerCloses-29075.test.tsx`; `@object-ui/layout` and
 * `@object-ui/components` stay REAL, so the drawer is the real Sheet, its
 * entries are the real `NavigationRenderer` links, and the sidebar's own
 * route-change close runs beside the hook. The history is a MemoryRouter that
 * starts on `/apps/hotcrm` with `/home` behind it.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, type Location } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    viewLabel: (_o: string, _v: string, fallback?: string) => fallback,
    dashboardLabel: ({ label }: { label?: string }) => label,
    appLabel: ({ name, label }: { name: string; label?: string }) => label || name,
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/permissions')>()),
  usePermissions: () => ({ can: () => true, hasCapabilities: () => true }),
}));

const NAV = [{ id: 'n1', type: 'object', label: 'Leads', objectName: 'lead' }];
const HOTCRM = { name: 'hotcrm', label: 'HotCRM', icon: 'flame', active: true, navigation: NAV };

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [HOTCRM], objects: [] }),
}));

vi.mock('../../providers/ExpressionProvider', () => ({
  useExpressionContext: () => ({ evaluator: null }),
  evaluateVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  evaluateNavigationVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  useHasExpressionScope: () => true,
}));

vi.mock('../../utils', () => ({
  resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : ''),
  matchAppBySegment: (apps: Array<{ name?: string }>, segment?: string) =>
    apps.find((a) => a?.name === segment),
  appRouteSegment: (app: { name?: string }) => app?.name,
}));

vi.mock('../../utils/getIcon', () => ({
  getIcon: (name?: string) => () => <svg data-icon={name ?? '(none)'} />,
}));
vi.mock('../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../hooks/useFavorites', () => ({
  useFavorites: () => ({ favorites: [], removeFavorite: vi.fn() }),
}));
vi.mock('../../hooks/useNavPins', () => ({
  useNavPins: () => ({ togglePin: vi.fn(), applyPins: (items: unknown) => items }),
}));
vi.mock('../../hooks/useNavActionDispatch', () => ({
  useNavActionDispatch: () => vi.fn(),
}));
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ context: 'app', currentAppName: 'hotcrm' }),
}));
vi.mock('../ContextSelectors', () => ({
  useAppContextSelectors: () => ({ contextValues: {}, element: null }),
  contextSelectorQueryKey: (id: string) => (id === 'active_package' ? 'package' : id),
  STUDIO_PACKAGE_SELECTOR_ID: 'active_package',
}));
vi.mock('../LocalizedSidebarTrigger', () => ({
  LocalizedSidebarTrigger: () => null,
}));

import { SidebarProvider, useSidebar } from '@object-ui/components';
import { UnifiedSidebar } from '../UnifiedSidebar';
import { usePhoneNavDrawerHistory } from '../usePhoneNavDrawerHistory';
import { NAV_DRAWER_OPEN_STATE } from '../../urlParams';

interface Probed {
  isMobile: boolean;
  openMobile: boolean;
  open: boolean;
  setOpenMobile: (open: boolean) => void;
  toggleSidebar: () => void;
  location: Location;
  navigate: ReturnType<typeof useNavigate>;
}

let probed: Probed | null = null;
/** Every location the router committed, in order (one per entry change). */
let committed: Location[] = [];

function Probe() {
  const { isMobile, openMobile, open, setOpenMobile, toggleSidebar } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  // Published after each commit, not during render (react-hooks/globals).
  React.useEffect(() => {
    probed = { isMobile, openMobile, open, setOpenMobile, toggleSidebar, location, navigate };
  });
  React.useEffect(() => {
    committed.push(location);
  }, [location]);
  return null;
}

function Mounted() {
  usePhoneNavDrawerHistory();
  return null;
}

type Entry = string | { pathname: string; state?: unknown };

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function renderConsole(width: number, entries: Entry[] = ['/home', '/apps/hotcrm']) {
  setViewportWidth(width);
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <SidebarProvider>
        <Mounted />
        <Probe />
        <UnifiedSidebar activeAppName="hotcrm" />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

const current = () => probed!.location;
const flagged = (location: Location) =>
  !!location.state && (location.state as Record<string, unknown>)[NAV_DRAWER_OPEN_STATE] === true;

async function phoneReady() {
  await waitFor(() => expect(probed?.isMobile).toBe(true));
}

async function openDrawer() {
  act(() => probed!.setOpenMobile(true));
  await screen.findByTestId('mobile-sidebar-app');
  await waitFor(() => expect(flagged(current())).toBe(true));
}

async function back() {
  act(() => {
    probed!.navigate(-1);
  });
}

afterEach(() => {
  cleanup();
  probed = null;
  committed = [];
  setViewportWidth(1024);
});

describe('Back with the phone nav drawer open (objectstack#29131)', () => {
  it('Back closes the drawer and stays on the same URL', async () => {
    renderConsole(375);
    await phoneReady();
    await openDrawer();
    expect(current().pathname).toBe('/apps/hotcrm');

    await back();

    await waitFor(() => expect(probed?.openMobile).toBe(false));
    expect(current().pathname).toBe('/apps/hotcrm');
    expect(flagged(current())).toBe(false);
    await waitFor(() => expect(screen.queryByTestId('mobile-sidebar-app')).not.toBeInTheDocument());

    // And the next Back leaves the page, as it does with the drawer closed.
    await back();
    await waitFor(() => expect(current().pathname).toBe('/home'));
  });

  it('closing the drawer (Escape) pops its entry, so Back goes to the previous page', async () => {
    renderConsole(390);
    await phoneReady();
    await openDrawer();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await waitFor(() => expect(probed?.openMobile).toBe(false));
    await waitFor(() => expect(flagged(current())).toBe(false));
    expect(current().pathname).toBe('/apps/hotcrm');

    await back();
    await waitFor(() => expect(current().pathname).toBe('/home'));
  });

  it('choosing a nav entry replaces the drawer entry: Back goes to the page the drawer was opened on', async () => {
    renderConsole(375);
    await phoneReady();
    await openDrawer();

    fireEvent.click(screen.getByRole('link', { name: 'Leads' }));

    await waitFor(() => expect(current().pathname).toBe('/apps/hotcrm/lead'));
    await waitFor(() => expect(probed?.openMobile).toBe(false));
    expect(flagged(current())).toBe(false);

    await back();
    await waitFor(() => expect(current().pathname).toBe('/apps/hotcrm'));
    expect(flagged(current())).toBe(false);
    expect(probed?.openMobile).toBe(false);
  });

  it('the drawer\'s "All apps" link, which closes the drawer itself, does not pop as well', async () => {
    renderConsole(375);
    await phoneReady();
    await openDrawer();

    fireEvent.click(screen.getByTestId('mobile-sidebar-home'));

    await waitFor(() => expect(current().pathname).toBe('/home'));
    await waitFor(() => expect(probed?.openMobile).toBe(false));

    await back();
    await waitFor(() => expect(current().pathname).toBe('/apps/hotcrm'));
    expect(flagged(current())).toBe(false);
  });

  it('a reload on the drawer entry leaves the drawer closed and the entry without the flag', async () => {
    // A reload keeps `history.state`, so the document starts on a flagged entry it never pushed.
    renderConsole(375, ['/home', '/apps/hotcrm', { pathname: '/apps/hotcrm', state: { [NAV_DRAWER_OPEN_STATE]: true } }]);
    await phoneReady();

    await waitFor(() => expect(flagged(current())).toBe(false));
    expect(current().pathname).toBe('/apps/hotcrm');
    expect(probed?.openMobile).toBe(false);
    expect(screen.queryByTestId('mobile-sidebar-app')).not.toBeInTheDocument();
  });

  it('Forward to the drawer entry this page pushed opens the drawer again', async () => {
    renderConsole(375);
    await phoneReady();
    await openDrawer();
    await back();
    await waitFor(() => expect(probed?.openMobile).toBe(false));

    act(() => {
      probed!.navigate(1);
    });

    await waitFor(() => expect(probed?.openMobile).toBe(true));
    expect(flagged(current())).toBe(true);
  });

  it('CONTROL — at desktop width, opening and closing the sidebar writes no history entry', async () => {
    renderConsole(1280);
    await waitFor(() => expect(probed?.isMobile).toBe(false));
    const before = committed.length;
    const start = current().key;

    act(() => probed!.toggleSidebar());
    await waitFor(() => expect(probed?.open).toBe(false));
    act(() => probed!.toggleSidebar());
    await waitFor(() => expect(probed?.open).toBe(true));

    expect(committed.length).toBe(before);
    expect(current().key).toBe(start);
  });

});
