// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console chrome draws the active app's `branding.logo` (objectui#10827)
 * on the app's own glyph: from 768 px up in the sidebar's app menu row, the
 * page's first row now that a desktop app draws no top bar (objectstack#36112);
 * on a phone in the top bar's app pill (objectui#12201).
 *
 * `branding.logo` is authored by the designer (`AppCreationWizard`,
 * `BrandingEditor`), documented, and set by downstream apps. objectui#10827
 * gave it its first mounted reader, a logo header at the top of
 * `UnifiedSidebar`. The maintainer's ruling of 2026-10-12 made the value the
 * app's square icon, LEFT of the app's name (`AppMark`): objectui#12201 drew
 * it in the top bar's pill, and objectstack#36112 moved that row into the
 * sidebar's head on a desktop. The glyph is the only place it shows: no
 * other image in the sidebar. An app without a logo gets its `icon` on a
 * tile — the control.
 *
 * ## Real subjects
 *
 * `ConsoleLayout` with its real `AppShell` (`@object-ui/layout`), real
 * `UnifiedSidebar`, real `SidebarAppMenu` and real `AppSwitcher`, under the
 * real `NavigationProvider` — so the sidebar is in `app` context only because
 * `ConsoleLayout` put it there, as in the running console. The phone's top bar
 * is a stand-in that mounts the real `AppSwitcher` with the very props
 * `ConsoleLayout` hands `AppHeader` (`AppHeader`'s own wiring of the pill is
 * `AppHeader.appIdentity-12201.test.tsx`'s). The other stand-ins are the
 * providers the sidebar reads (metadata, permissions, auth, expressions) and
 * the siblings this card does not touch: the chat dock and FAB, and the
 * preview and notification bars.
 *
 * The glyph is read from its trigger (`sidebar-app-menu-trigger` on a desktop,
 * `app-switcher-trigger` on a phone), and the rest of the sidebar from
 * `[data-sidebar="sidebar"]` with that trigger left out.
 */

import '@testing-library/jest-dom/vitest';
// The layout reaches `import('@objectstack/lint')` (the draft bar's publish
// preflight); pay its first load at collection, never inside a clocked case.
import '@objectstack/lint';
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
  useHasExpressionScope: () => true,
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
    fullWindow: false,
    setFullWindow: vi.fn(),
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
    onResizePointerDown: vi.fn(),
  }),
  ChatDockPanel: () => null,
  ChatDockMobileSheet: () => null,
}));
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

function mountConsole(
  activeApp: Record<string, unknown>,
  apps: Record<string, unknown>[] = [activeApp],
  width = 1280,
) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
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

/** The app's glyph and name: the sidebar's app menu row on a desktop, the top bar's pill on a phone. */
function appPill(): HTMLElement {
  const pill =
    document.querySelector<HTMLElement>('[data-testid="sidebar-app-menu-trigger"]') ??
    document.querySelector<HTMLElement>('[data-testid="app-switcher-trigger"]');
  if (!pill) throw new Error('the console chrome mounted no app glyph');
  return pill;
}

/** The sidebar's images outside the app menu row. */
function imagesInSidebarBesideGlyph(): Array<string | null> {
  return [...sidebarRoot().querySelectorAll('img')]
    .filter((img) => !img.closest('[data-testid="sidebar-app-menu-trigger"]'))
    .map((img) => img.getAttribute('src'));
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true });
});

describe('the console chrome renders the active app\'s `branding.logo` on its glyph (objectui#10827, objectui#12201, objectstack#36112)', () => {
  it('an app with `branding.logo` shows it in the sidebar\'s app menu row, left of the app\'s name', () => {
    const view = mountConsole(BRANDED);
    // The mount is real: the route content and the sidebar's navigation render.
    expect(view.getByTestId('route-content')).toBeInTheDocument();
    expect(view.getByText('Accounts')).toBeInTheDocument();

    const pill = appPill();
    expect(pill).toHaveAttribute('data-testid', 'sidebar-app-menu-trigger');
    expect(sidebarRoot()).toContainElement(pill);
    expect(imagesIn(pill)).toEqual([LOGO]);
    const logo = pill.querySelector('img')!;
    expect(logo.compareDocumentPosition(within(pill).getByText('Acme CRM')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the sidebar draws `branding.logo` only on that glyph — no logo header, no other image', () => {
    mountConsole(BRANDED);
    expect(imagesInSidebarBesideGlyph()).toEqual([]);
    expect(imagesIn(sidebarRoot())).toEqual([LOGO]);
  });

  it('on a phone the logo stays in the top bar\'s pill, and the sidebar draws none', () => {
    mountConsole(BRANDED, [BRANDED], 390);
    const pill = appPill();
    expect(pill).toHaveAttribute('data-testid', 'app-switcher-trigger');
    expect(imagesIn(pill)).toEqual([LOGO]);
    expect(document.querySelector('[data-testid="sidebar-app-menu-trigger"]')).toBeNull();
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

describe('an app\'s automatic tile colour stays on its tile (objectstack#36157)', () => {
  /** An app declaring neither a logo nor a colour: the tile gets a palette colour, the theme nothing. */
  const UNDECLARED = { name: 'meeting_notes', label: 'Meeting notes', active: true, navigation: NAV };

  it('the pill draws the automatic colour, and the primary controls keep the platform default', () => {
    mountConsole(UNDECLARED);
    expect(within(appPill()).getByTestId('app-mark-tile')).toHaveAttribute('data-app-tile', 'pink');
    // Only a declared `branding` reaches the theme: no brand colour is written.
    for (const prop of ['--brand-primary', '--primary', '--sidebar-primary']) {
      expect(document.documentElement.style.getPropertyValue(prop), prop).toBe('');
    }
  });

  it('CONTROL — a declared colour is the theme\'s primary and the tile\'s', () => {
    mountConsole(PLAIN);
    expect(within(appPill()).getByTestId('app-mark-tile')).toHaveAttribute('data-app-tile', 'declared');
    expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('#2563eb');
  });
});
