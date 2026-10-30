// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — on a narrow window the console sidebar is the icon rail,
 * and a click expands it OVER the content (objectstack#27593).
 *
 * - At 1280 px the sidebar mounts as the rail; at 1440 px nothing changes; at
 *   700 px the phone drawer still mounts.
 * - A click on the rail's background expands it as an overlay: the panel
 *   takes the expanded width above the page while the in-flow gap keeps the
 *   rail's width, so the content beside it does not move. Hover alone does
 *   not expand it, and a click on a rail icon navigates as before.
 * - A navigation choice, a press outside it or Esc folds it again; a press in
 *   an entry's own menu (a portal) does not, and the app bar's trigger
 *   toggles it once.
 * - "Keep sidebar open" ends the fold for this browser and survives a reload.
 *
 * The test DOM computes no Tailwind and no layout, so widths are read as the
 * class that sets them; the rendered widths are measured in a browser on the
 * pull request. Harness: the provider / chrome stand-ins of
 * `UnifiedSidebar.iconRailScroll-12794.test.tsx`, with the real
 * `SidebarProvider`, `Sidebar`, `NavigationRenderer` and `useResponsiveSidebar`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) =>
        String(options?.[name] ?? ''),
      ),
    language: 'en',
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    viewLabel: (_o: string, _v: string, fallback?: string) => fallback,
    dashboardLabel: ({ label }: { label?: string }) => label,
    appLabel: ({ label }: { label?: string }) => label,
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

vi.mock('../../utils', () => ({
  resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : ''),
  matchAppBySegment: (apps: Array<{ name?: string }>, segment?: string) =>
    apps.find((a) => a?.name === segment),
  appRouteSegment: (app: { name?: string }) => app?.name,
}));

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
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ context: 'app', currentAppName: 'crm' }),
}));
vi.mock('../ContextSelectors', () => ({
  useAppContextSelectors: () => ({ contextValues: {}, element: null }),
  contextSelectorQueryKey: (id: string) => (id === 'active_package' ? 'package' : id),
  STUDIO_PACKAGE_SELECTOR_ID: 'active_package',
}));

import { SidebarProvider, useSidebar } from '@object-ui/components';
import { UnifiedSidebar } from '../UnifiedSidebar';
import { useResponsiveSidebar } from '../../hooks/useResponsiveSidebar';
import { RAIL_OVERLAY_FRAME_KEEPS_GAP, RAIL_OVERLAY_PANEL } from '../consoleSidebarRail';

/**
 * Size the test window: happy-dom's own viewport, so `innerWidth`, the
 * `resize` event and every media query answer the same width.
 */
function setViewportWidth(width: number) {
  (window as unknown as { happyDOM: { setViewport: (v: { width: number; height: number }) => void } }).happyDOM.setViewport({
    width,
    height: 900,
  });
}

/** The console layout's fold, as `ConsoleLayoutInner` runs it. */
function Fold() {
  useResponsiveSidebar();
  return null;
}

/** The app bar's trigger, reduced to what the fold reads: `data-sidebar="trigger"` and the toggle. */
function Trigger() {
  const { toggleSidebar } = useSidebar();
  return (
    <button type="button" data-sidebar="trigger" onClick={toggleSidebar}>
      Toggle sidebar
    </button>
  );
}

let navigateTo: (path: string) => void = () => {};
function RouteProbe() {
  const location = useLocation();
  navigateTo = useNavigate();
  return <div data-testid="route">{location.pathname}</div>;
}

function renderShell(width: number) {
  setViewportWidth(width);
  metadataState = {
    apps: [
      {
        name: 'crm',
        label: 'CRM',
        active: true,
        navigation: [
          { id: 'nav_accounts', type: 'object', objectName: 'account', label: 'Accounts' },
          { id: 'nav_contacts', type: 'object', objectName: 'contact', label: 'Contacts' },
        ],
      },
    ],
    objects: [],
  };
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider>
        <header data-testid="app-bar">
          <Trigger />
        </header>
        <Fold />
        <UnifiedSidebar activeAppName="crm" railOverlay />
        <div data-testid="page">
          <RouteProbe />
          <p>The page</p>
        </div>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

/** The desktop sidebar's root: it carries the expanded / collapsed state. */
const sidebarRoot = () => document.querySelector<HTMLElement>('[data-side][data-variant][data-state]');
/** The in-flow box that reserves the sidebar's width: the root's first child. */
const gap = () => sidebarRoot()!.firstElementChild as HTMLElement;
/** The fixed panel: the root's second child, the one the call site's props land on. */
const panel = () => sidebarRoot()!.lastElementChild as HTMLElement;
const frame = () => screen.getByTestId('console-sidebar-frame');
const background = () => panel().querySelector<HTMLElement>('[data-sidebar="sidebar"]')!;
const keepOpen = () => screen.queryByTestId('sidebar-keep-open');
const tokens = (el: Element) => el.className.split(/\s+/).filter(Boolean);

function expandRail() {
  fireEvent.click(background());
  expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
  expect(panel()).toHaveAttribute('data-console-rail', 'overlay');
}

function expectRail() {
  expect(sidebarRoot()).toHaveAttribute('data-state', 'collapsed');
  expect(sidebarRoot()).toHaveAttribute('data-collapsible', 'icon');
  expect(panel()).toHaveAttribute('data-console-rail', 'rail');
  expect(tokens(frame())).toEqual(['contents']);
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = 'sidebar_state=; path=/; max-age=0';
});

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
  localStorage.clear();
  document.cookie = 'sidebar_state=; path=/; max-age=0';
});

describe('the narrow-window icon rail (objectstack#27593)', () => {
  it('at 1280 px the sidebar mounts as the icon rail, reserving only the rail', () => {
    renderShell(1280);
    expectRail();
    // Collapsed, the gap takes the primitive's own icon width: the content is the window minus the rail.
    expect(tokens(gap()).some((t) => t.endsWith(':w-(--sidebar-width-icon)'))).toBe(true);
    expect(keepOpen()).toBeNull();
  });

  it('a click on the rail’s background expands it over the content; the gap keeps the rail’s width', () => {
    renderShell(1280);
    expandRail();

    // The panel takes the expanded width above the page…
    for (const token of RAIL_OVERLAY_PANEL.split(' ')) expect(tokens(panel())).toContain(token);
    // …and the frame holds the gap at the rail's width, so the content does not move.
    expect(tokens(frame())).toContain(RAIL_OVERLAY_FRAME_KEEPS_GAP);
    const selector = /^\[&>(.+)\]:w-\(--sidebar-width-icon\)$/.exec(RAIL_OVERLAY_FRAME_KEEPS_GAP)?.[1];
    expect(selector, 'the frame variant names the element it narrows').toBeDefined();
    const target = frame().querySelector(`:scope > ${selector}`);
    expect(target, 'the variant reaches the primitive’s gap, not the panel').toBe(gap());
    expect(tokens(gap())).not.toContain('fixed');
    expect(tokens(panel())).toContain('fixed');
  });

  it('hover alone does not expand it, and a click on a rail icon navigates without expanding', () => {
    renderShell(1280);
    fireEvent.pointerEnter(panel());
    fireEvent.mouseOver(background());
    expectRail();

    fireEvent.click(within(panel()).getByRole('link', { name: 'Accounts' }));
    expectRail();
    expect(screen.getByTestId('route')).toHaveTextContent('/apps/crm/account');
  });

  it('choosing a navigation item folds it', () => {
    renderShell(1280);
    expandRail();
    fireEvent.click(within(panel()).getByRole('link', { name: 'Contacts' }));
    expectRail();
    expect(screen.getByTestId('route')).toHaveTextContent('/apps/crm/contact');
  });

  it('a navigation from anywhere else folds it', () => {
    renderShell(1280);
    expandRail();
    act(() => navigateTo('/apps/crm/account'));
    expectRail();
  });

  it('a press outside folds it; the app bar trigger toggles it exactly once', () => {
    renderShell(1280);
    expandRail();
    fireEvent.pointerDown(screen.getByText('The page'));
    expectRail();

    expandRail();
    const trigger = within(screen.getByTestId('app-bar')).getByRole('button', { name: 'Toggle sidebar' });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expectRail();

    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
    expect(panel()).toHaveAttribute('data-console-rail', 'overlay');
  });

  it('a press in an entry’s own menu, drawn in a portal, does not fold it', () => {
    renderShell(1280);
    expandRail();
    fireEvent.keyDown(within(panel()).getByRole('button', { name: 'More actions for Accounts' }), { key: 'Enter' });
    const item = screen.getAllByRole('menuitem')[0];
    expect(panel()).not.toContainElement(item);
    fireEvent.pointerDown(item);
    expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
  });

  it('Esc folds it; an Esc another layer already handled does not', () => {
    renderShell(1280);
    expandRail();
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    handled.preventDefault();
    act(() => {
      document.body.dispatchEvent(handled);
    });
    expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expectRail();
  });

  it('"Keep sidebar open" ends the fold for this browser, survives a reload, and gives it back', () => {
    renderShell(1280);
    expandRail();
    const toggle = keepOpen()!;
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);

    // The wide-window sidebar on a narrow window: expanded beside the content, no overlay.
    expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
    expect(panel()).not.toHaveAttribute('data-console-rail');
    expect(tokens(frame())).toEqual(['contents']);
    expect(keepOpen()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.pointerDown(screen.getByText('The page'));
    expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');

    cleanup();
    renderShell(1280);
    expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
    expect(keepOpen()).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(keepOpen()!);
    expectRail();
  });

  it('at 1440 px nothing changes: expanded beside the content, no rail, no toggle', () => {
    renderShell(1440);
    expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
    expect(panel()).not.toHaveAttribute('data-console-rail');
    expect(tokens(frame())).toEqual(['contents']);
    expect(keepOpen()).toBeNull();
    fireEvent.pointerDown(screen.getByText('The page'));
    expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
  });

  it('at 700 px the phone drawer still mounts', () => {
    renderShell(700);
    expect(sidebarRoot()).toBeNull();
    fireEvent.click(within(screen.getByTestId('app-bar')).getByRole('button', { name: 'Toggle sidebar' }));
    expect(document.querySelector('[data-mobile="true"][data-sidebar="sidebar"]')).not.toBeNull();
  });
});
