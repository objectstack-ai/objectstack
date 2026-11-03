// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — on a phone the sidebar is a drawer over the page, and a
 * route change closes it (objectstack#29075). Before, a tapped entry opened
 * its page under a drawer that stayed open, so every navigation on a phone
 * cost a second tap to see the page it opened.
 *
 * The close is keyed on the route, not on one row's click handler, so the
 * second case navigates from outside the drawer and still sees it close. On a
 * wide window a route change leaves the sidebar alone.
 *
 * Harness: the provider / chrome mocks of
 * `UnifiedSidebar.mobileAppHeader-12201.test.tsx`; `@object-ui/layout` and
 * `@object-ui/components` stay REAL, and the drawer is opened through the real
 * `SidebarProvider` at a phone's width.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';

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

const LOGO = 'https://cdn.example.test/hotcrm-icon.svg';
const NAV = [{ id: 'n1', type: 'object', label: 'Leads', objectName: 'lead' }];
const HOTCRM = { name: 'hotcrm', label: 'HotCRM', icon: 'flame', active: true, branding: { logo: LOGO }, navigation: NAV };
const PLAIN = { name: 'plain', label: 'Plain', icon: 'box', active: true, navigation: NAV };

let metadataState: { apps: unknown[]; objects: unknown[] } = { apps: [], objects: [] };
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => metadataState,
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
let navContext: { context: 'app' | 'home'; currentAppName: string } = { context: 'app', currentAppName: 'hotcrm' };
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => navContext,
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

let sidebarState: { isMobile: boolean; openMobile: boolean; open: boolean } | null = null;
let navigateTo: ((to: string) => void) | null = null;

/** Opens the phone drawer the way the trigger does, and reads the sidebar's state. */
function Probe({ openDrawer }: { openDrawer: boolean }) {
  const { isMobile, openMobile, open, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  // Published after each commit, not during render (react-hooks/globals).
  React.useEffect(() => {
    navigateTo = navigate;
    sidebarState = { isMobile, openMobile, open };
  });
  React.useEffect(() => {
    if (openDrawer && isMobile) setOpenMobile(true);
  }, [openDrawer, isMobile, setOpenMobile]);
  return null;
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function renderSidebar(width: number) {
  setViewportWidth(width);
  metadataState = { apps: [HOTCRM, PLAIN], objects: [] };
  navContext = { context: 'app', currentAppName: 'hotcrm' };
  return render(
    <MemoryRouter initialEntries={['/apps/hotcrm']}>
      <SidebarProvider>
        <Probe openDrawer={width < 768} />
        <UnifiedSidebar activeAppName="hotcrm" />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  sidebarState = null;
  navigateTo = null;
  setViewportWidth(1024);
});

describe('a route change closes the phone drawer (objectstack#29075)', () => {
  it('tapping a drawer entry opens its page with the drawer closed', async () => {
    renderSidebar(375);
    await screen.findByTestId('mobile-sidebar-app');
    expect(sidebarState).toMatchObject({ isMobile: true, openMobile: true });

    fireEvent.click(screen.getByRole('link', { name: 'Leads' }));

    await waitFor(() => expect(sidebarState?.openMobile).toBe(false));
    await waitFor(() => expect(screen.queryByTestId('mobile-sidebar-app')).not.toBeInTheDocument());
  });

  it('a navigation from outside the drawer closes it too: the close follows the route, not a row', async () => {
    renderSidebar(375);
    await screen.findByTestId('mobile-sidebar-app');

    act(() => navigateTo?.('/apps/hotcrm/lead?view=all'));

    await waitFor(() => expect(sidebarState?.openMobile).toBe(false));
  });

  it('the drawer stays open while the route does not change', async () => {
    renderSidebar(375);
    await screen.findByTestId('mobile-sidebar-app');
    // The same route again: no change, no close.
    act(() => navigateTo?.('/apps/hotcrm'));
    expect(sidebarState?.openMobile).toBe(true);
  });

  it('CONTROL — on a wide window a route change leaves the sidebar as it was', async () => {
    renderSidebar(1280);
    await waitFor(() => expect(sidebarState?.isMobile).toBe(false));
    const before = sidebarState?.open;

    act(() => navigateTo?.('/apps/hotcrm/lead'));

    await waitFor(() => expect(sidebarState?.open).toBe(before));
    expect(sidebarState?.openMobile).toBe(false);
  });
});
