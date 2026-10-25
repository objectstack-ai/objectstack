// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console chrome draws the active app's `branding.logo` (objectui#10827) —
 * in the top bar's app pill, not in the sidebar (objectui#12201).
 *
 * `branding.logo` is authored by the designer (`AppCreationWizard`,
 * `BrandingEditor`), documented, and set by downstream apps. objectui#10827
 * gave it its first mounted reader, a logo header at the top of
 * `UnifiedSidebar`. The maintainer's ruling of 2026-10-12 moved the reader:
 * the value is the app's square icon, and it sits LEFT of the app's name in
 * the top bar's app pill (`AppSwitcher`), so the sidebar header goes. An app
 * without a logo gets its `icon` on a tile in the pill — the control.
 *
 * ## Real subjects
 *
 * `ConsoleLayout` with its real `AppShell` (`@object-ui/layout`), real
 * `UnifiedSidebar` and real `AppSwitcher`, under the real
 * `NavigationProvider` — so the sidebar is in `app` context only because
 * `ConsoleLayout` put it there, as in the running console. The top bar is a
 * stand-in that mounts the real `AppSwitcher` with the very props
 * `ConsoleLayout` hands `AppHeader` (`AppHeader`'s own wiring of the pill is
 * `AppHeader.appIdentity-12201.test.tsx`'s). The other stand-ins are the
 * providers the sidebar reads (metadata, permissions, auth, expressions) and
 * the siblings this card does not touch: the chat dock and FAB, and the
 * preview and notification bars.
 *
 * The sidebar is read from `[data-sidebar="sidebar"]`, its own root, and the
 * pill from its trigger, so neither surface can answer for the other.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Partial mock: @object-ui/components also imports from @object-ui/i18n
// (createSafeTranslation), so the rest of the module must stay real.
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

let metadataState: { apps: unknown[]; objects: unknown[] };
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => metadataState,
}));

vi.mock('../../providers/ExpressionProvider', () => ({
  useExpressionContext: () => ({ evaluator: null }),
  evaluateVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  evaluateNavigationVisibility: (expr: unknown) => expr !== false && expr !== 'false',
}));

// Lazy lucide DynamicIcon would suspend mid-test; a null icon is enough here.
vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));

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
vi.mock('../ContextSelectors', () => ({
  useAppContextSelectors: () => ({ contextValues: {}, element: null }),
  contextSelectorQueryKey: (id: string) => (id === 'active_package' ? 'package' : id),
  STUDIO_PACKAGE_SELECTOR_ID: 'active_package',
}));
vi.mock('../LocalizedSidebarTrigger', () => ({
  LocalizedSidebarTrigger: () => null,
}));

// The top bar, reduced to the app pill it mounts — the REAL `AppSwitcher`, fed
// the props `ConsoleLayout` passes the header.
vi.mock('../AppHeader', async () => {
  const { AppSwitcher } = await import('../AppSwitcher');
  return {
    AppHeader: ({ activeAppName, onAppChange }: { activeAppName: string; onAppChange: (n: string) => void }) => (
      <div data-testid="app-header-stub">
        <AppSwitcher activeAppName={activeAppName} onAppChange={onAppChange} />
      </div>
    ),
  };
});
// Siblings in `ConsoleLayout` this card does not touch.
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../ChatDock', () => ({
  useChatDockState: () => ({
    expanded: false,
    width: 420,
    dragging: false,
    maximized: false,
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
    maximize: vi.fn(),
    restore: vi.fn(),
    onResizePointerDown: vi.fn(),
  }),
  ChatDockPanel: () => null,
  ChatDockMobileSheet: () => null,
}));
vi.mock('../ConsoleChatbotFab', () => ({ ConsoleChatbotFab: () => null }));
vi.mock('../ConsoleNotificationBanners', () => ({ ConsoleNotificationBanners: () => null }));
vi.mock('../../preview/DraftPreviewBar', () => ({ DraftPreviewBar: () => null }));
vi.mock('../../preview/UnpublishedAppBar', () => ({ UnpublishedAppBar: () => null }));

import { SidebarProvider } from '@object-ui/components';
import { ConsoleLayout } from '../ConsoleLayout';
import { UnifiedSidebar } from '../UnifiedSidebar';
import { NavigationProvider } from '../../context/NavigationContext';

const LOGO = 'https://cdn.example.test/acme-logo.svg';

const NAV = [{ id: 'n1', type: 'object', label: 'Accounts', objectName: 'account' }];

/** The two apps an author can have: one with `branding.logo`, one without. */
const BRANDED = { name: 'acme_crm', label: 'Acme CRM', active: true, branding: { primaryColor: '#2563eb', logo: LOGO }, navigation: NAV };
const PLAIN = { name: 'plain_app', label: 'Plain App', active: true, branding: { primaryColor: '#2563eb' }, navigation: NAV };

function mountConsole(activeApp: Record<string, unknown>, apps: Record<string, unknown>[] = [activeApp]) {
  metadataState = { apps, objects: [] };
  const name = String(activeApp.name);
  return render(
    <MemoryRouter initialEntries={[`/apps/${name}`]}>
      <NavigationProvider>
        <ConsoleLayout activeAppName={name} activeApp={activeApp} onAppChange={vi.fn()} objects={[]}>
          <div data-testid="route-content">page</div>
        </ConsoleLayout>
      </NavigationProvider>
    </MemoryRouter>,
  );
}

function sidebarRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>('[data-sidebar="sidebar"]');
  if (!root) throw new Error('the console chrome mounted no sidebar');
  return root;
}

const imagesIn = (el: HTMLElement) => [...el.querySelectorAll('img')].map((img) => img.getAttribute('src'));

function appPill(): HTMLElement {
  const pill = document.querySelector<HTMLElement>('[data-testid="app-switcher-trigger"]');
  if (!pill) throw new Error('the console chrome mounted no app pill');
  return pill;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => cleanup());

describe('the console chrome renders the active app\'s `branding.logo` in the app pill (objectui#10827, objectui#12201)', () => {
  it('an app with `branding.logo` shows it in the app pill, left of the app\'s name', () => {
    const view = mountConsole(BRANDED);
    // The mount is real: the route content and the sidebar's navigation render.
    expect(view.getByTestId('route-content')).toBeInTheDocument();
    expect(view.getByText('Accounts')).toBeInTheDocument();

    const pill = appPill();
    expect(imagesIn(pill)).toEqual([LOGO]);
    const logo = pill.querySelector('img')!;
    expect(logo.compareDocumentPosition(within(pill).getByText('Acme CRM')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the sidebar no longer draws `branding.logo` — no logo header, no image', () => {
    mountConsole(BRANDED);
    expect(imagesIn(sidebarRoot())).toEqual([]);
    expect(sidebarRoot().querySelector('[data-sidebar="header"]')).toBeNull();
  });

  it('CONTROL — an app without a logo gets its icon tile in the pill, and no image anywhere', () => {
    const view = mountConsole(PLAIN);
    expect(view.getByText('Accounts')).toBeInTheDocument();
    expect(imagesIn(appPill())).toEqual([]);
    expect(within(appPill()).getByTestId('app-mark-tile')).toBeInTheDocument();
    expect(imagesIn(sidebarRoot())).toEqual([]);
  });

  it('the retired top-level `logo` renders nothing — only `branding.logo` is read', () => {
    const aliasOnly = { ...PLAIN, name: 'alias_app', logo: LOGO };
    const view = mountConsole(aliasOnly);
    expect(view.getByText('Accounts')).toBeInTheDocument();
    expect(imagesIn(appPill())).toEqual([]);
    expect(imagesIn(sidebarRoot())).toEqual([]);
  });

  it('switching to a branded app shows ITS logo in the pill, not the first app\'s', () => {
    // `PLAIN` is listed first: the pill must follow the active app.
    mountConsole(BRANDED, [PLAIN, BRANDED]);
    expect(imagesIn(appPill())).toEqual([LOGO]);
    cleanup();
    mountConsole(PLAIN, [BRANDED, PLAIN]);
    expect(imagesIn(appPill())).toEqual([]);
  });
});

describe('outside an app, the sidebar draws no app logo (objectui#10827)', () => {
  it('home context, with a branded app first in the list, draws no image', () => {
    // No `ConsoleLayout`, so nothing moves the context off `home` — where the
    // sidebar's `activeApp` falls back to the FIRST app.
    metadataState = { apps: [BRANDED, PLAIN], objects: [] };
    render(
      <MemoryRouter initialEntries={['/home']}>
        <NavigationProvider>
          <SidebarHost />
        </NavigationProvider>
      </MemoryRouter>,
    );
    expect(imagesIn(sidebarRoot())).toEqual([]);
  });
});

/** The real sidebar in the real `SidebarProvider`, as `AppShell` mounts it. */
function SidebarHost() {
  return (
    <SidebarProvider>
      <UnifiedSidebar activeAppName="" />
    </SidebarProvider>
  );
}
