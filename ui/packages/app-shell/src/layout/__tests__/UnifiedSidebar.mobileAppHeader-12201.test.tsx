// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — on a phone the drawer header names the app: its glyph and
 * its name, in the place of the old mobile-only Home row (objectui#12201,
 * maintainer ruling of 2026-10-12, item 3).
 *
 * On a phone the top bar hides the app pill, so the drawer header is the one
 * place that says which app the user is in. The header keeps the old row's
 * job too: its 「All apps」 button is the way out of the app, to the declared
 * home. On desktop the drawer header is absent and the sidebar draws no logo
 * at all — the pill carries the identity there.
 *
 * Harness: the provider / chrome mocks of
 * `UnifiedSidebar.studioNoHome-12113.test.tsx`; `@object-ui/layout` and
 * `@object-ui/components` stay REAL, and the drawer is opened through the real
 * `SidebarProvider` at a phone's width.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

/** Opens the phone drawer the way the ☰ trigger does. */
function OpenDrawer() {
  const { isMobile, setOpenMobile } = useSidebar();
  React.useEffect(() => {
    if (isMobile) setOpenMobile(true);
  }, [isMobile, setOpenMobile]);
  return null;
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function renderSidebar(app: { name: string }, width: number) {
  setViewportWidth(width);
  metadataState = { apps: [HOTCRM, PLAIN], objects: [] };
  navContext = { context: 'app', currentAppName: app.name };
  return render(
    <MemoryRouter initialEntries={[`/apps/${app.name}`]}>
      <SidebarProvider>
        <OpenDrawer />
        <UnifiedSidebar activeAppName={app.name} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
});

describe('the phone drawer header shows the app\'s glyph and name (objectui#12201)', () => {
  it('a branded app: its `branding.logo` at 26 px, then its name', async () => {
    renderSidebar(HOTCRM, 375);
    const header = await screen.findByTestId('mobile-sidebar-app');
    const logo = within(header).getByTestId('app-mark-logo');
    expect(logo).toHaveAttribute('src', LOGO);
    expect(logo.className).toContain('size-[26px]');
    const name = within(header).getByText('HotCRM');
    expect(logo.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('FALLBACK — an app without a logo: its `icon` tile, then its name', async () => {
    renderSidebar(PLAIN, 375);
    const header = await screen.findByTestId('mobile-sidebar-app');
    expect(within(header).getByTestId('app-mark-tile').querySelector('svg')).toHaveAttribute('data-icon', 'box');
    expect(within(header).getByText('Plain')).toBeInTheDocument();
  });

  it('it replaces the Home row and keeps its job — 「All apps」 leads back to Home', async () => {
    renderSidebar(HOTCRM, 375);
    const header = await screen.findByTestId('mobile-sidebar-app');
    const out = within(header).getByTestId('mobile-sidebar-home');
    expect(out).toHaveAttribute('href', '/home');
    expect(out).toHaveAccessibleName('All apps');
    // No separate "Home" text row any more; the rest of the drawer is unchanged.
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.getByText('Leads')).toBeInTheDocument();
  });

  it('CONTROL — on desktop there is no drawer header and the sidebar draws no image', () => {
    renderSidebar(HOTCRM, 1280);
    expect(screen.queryByTestId('mobile-sidebar-app')).not.toBeInTheDocument();
    const root = document.querySelector<HTMLElement>('[data-sidebar="sidebar"]')!;
    expect(root.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getByText('Leads')).toBeInTheDocument();
  });
});
