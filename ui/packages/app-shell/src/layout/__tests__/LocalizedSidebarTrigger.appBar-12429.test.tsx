// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One sidebar trigger, in the app bar, at every width (objectui#12429,
 * maintainer ruling of 2026-10-15).
 *
 * The desktop collapse toggle used to sit in the sidebar's footer, while the
 * app bar's trigger was `lg:hidden`. Between the Shadcn mobile breakpoint
 * (768 px) and `lg` (1024 px) both rendered. Now the app bar's trigger is the
 * only one: below 768 px it opens the drawer, from 768 px up it collapses the
 * sidebar to the icon rail and expands it again, and the rail carries no
 * trigger of its own. `aria-expanded` follows the state the click toggles and
 * the tooltip names the shortcut, which still toggles the same state.
 *
 * Real subjects: `LocalizedSidebarTrigger` in a stand-in app bar, beside the
 * real `UnifiedSidebar`, under the real `SidebarProvider`. Harness: the
 * provider / chrome mocks of `UnifiedSidebar.mobileAppHeader-12201.test.tsx`,
 * minus its trigger stub. Where `AppHeader` puts the trigger is
 * `AppHeader.sidebarTrigger-12429.test.tsx`'s.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
import { SidebarProvider } from '@object-ui/components';
import { UnifiedSidebar } from '../UnifiedSidebar';
import { LocalizedSidebarTrigger } from '../LocalizedSidebarTrigger';

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function renderShell(width: number) {
  setViewportWidth(width);
  metadataState = { apps: [HOTCRM, PLAIN], objects: [] };
  navContext = { context: 'app', currentAppName: 'hotcrm' };
  return render(
    <MemoryRouter initialEntries={['/apps/hotcrm']}>
      <SidebarProvider>
        <header data-testid="app-bar">
          <LocalizedSidebarTrigger />
        </header>
        <UnifiedSidebar activeAppName="hotcrm" />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

const allTriggers = () => document.querySelectorAll('[data-sidebar="trigger"]');
/** The desktop sidebar's root: it carries the expanded / collapsed state. */
const desktopSidebar = () => document.querySelector<HTMLElement>('[data-side][data-variant][data-state]');
const trigger = () => within(screen.getByTestId('app-bar')).getByRole('button', { name: 'Toggle sidebar' });

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
  // The provider persists the open state in a cookie; each test starts expanded.
  document.cookie = 'sidebar_state=; path=/; max-age=0';
});

describe('desktop: the app bar trigger collapses the sidebar to the icon rail and expands it (objectui#12429)', () => {
  it('exactly one trigger, in the app bar; the sidebar renders no footer and no trigger', () => {
    renderShell(1280);
    expect(allTriggers()).toHaveLength(1);
    expect(screen.getByTestId('app-bar')).toContainElement(allTriggers()[0] as HTMLElement);
    expect(document.querySelector('[data-sidebar="footer"]')).toBeNull();
    expect(screen.getByText('Leads')).toBeInTheDocument();
  });

  it('one click collapses to the icon rail, a second expands; `aria-expanded` follows', () => {
    renderShell(1280);
    expect(desktopSidebar()).toHaveAttribute('data-state', 'expanded');
    expect(desktopSidebar()).toHaveAttribute('data-collapsible', 'icon');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(trigger());
    expect(desktopSidebar()).toHaveAttribute('data-state', 'collapsed');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    // The collapsed rail carries no trigger of its own.
    expect(desktopSidebar()!.querySelector('[data-sidebar="trigger"]')).toBeNull();
    expect(allTriggers()).toHaveLength(1);

    fireEvent.click(trigger());
    expect(desktopSidebar()).toHaveAttribute('data-state', 'expanded');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });

  it('the tooltip names the trigger and its shortcut', async () => {
    // The shortcut itself is unchanged and pinned where it is advertised:
    // `KeyboardShortcutsDialog.wiredOnly-11674.test.tsx` fires it.
    renderShell(1280);
    fireEvent.focus(trigger());
    const caps = await screen.findAllByTestId('sidebar-trigger-shortcut');
    expect(caps[0]).toHaveTextContent('⌘B');
    expect(caps[0].parentElement).toHaveTextContent('Toggle sidebar');
  });

  it('between the mobile breakpoint and lg (900 px): still one trigger, and it collapses the sidebar', () => {
    renderShell(900);
    expect(allTriggers()).toHaveLength(1);
    fireEvent.click(trigger());
    expect(desktopSidebar()).toHaveAttribute('data-state', 'collapsed');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('phone: the same trigger opens the drawer, and the drawer carries none (objectui#12429)', () => {
  it('exactly one trigger before and after opening; `aria-expanded` follows the drawer', async () => {
    renderShell(375);
    expect(allTriggers()).toHaveLength(1);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger());
    const drawer = await screen.findByTestId('mobile-sidebar-app');
    expect(drawer).toBeInTheDocument();
    expect(screen.getByTestId('app-bar').querySelector('[data-sidebar="trigger"]')).toHaveAttribute('aria-expanded', 'true');
    expect(allTriggers()).toHaveLength(1);
    expect(document.querySelector('[data-mobile="true"] [data-sidebar="footer"]')).toBeNull();
  });
});
