// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — on a narrow window the console sidebar folds on its own,
 * and the app bar's trigger floats its menu OVER the content
 * (objectstack#27593). Folded, the sidebar is hidden, with no icon column
 * (ruling 6973617688 on objectstack#35062, which replaced the icon rail; the
 * edge, the reader's own collapse and focus are pinned in
 * `UnifiedSidebar.hiddenCollapse-35062.test.tsx`).
 *
 * - At 1280 px the sidebar mounts folded and hidden; at 1440 px nothing
 *   changes; at 700 px the phone drawer still mounts.
 * - The app bar's trigger floats the menu: the panel takes the expanded width
 *   above the page while the in-flow gap keeps no width, so the content beside
 *   it does not move. Resting the pointer on the window's left edge floats it
 *   too (the ruling's change to "hover alone does not expand").
 * - A navigation choice, a press outside it or Esc folds it again; a press in
 *   an entry's own menu (a portal) does not, and the app bar's trigger
 *   toggles it once.
 * - "Keep sidebar open" ends the fold for this browser and survives a reload.
 * - One Esc folds it wherever the pointer or focus is inside it: the hidden
 *   tooltip an entry opens does not take the key (objectstack#28078).
 * - "Keep sidebar open" on a narrow window and the wide-window choice are kept
 *   apart, across a resize and a reload (objectstack#28079).
 * - A group declared `expanded: false` stays collapsed, with its count, in the
 *   floated menu as in the expanded sidebar, and its disclosure opens it to
 *   the pointer and the keyboard (objectstack#32156 listed its entries in the
 *   icon rail, which is gone).
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
import userEvent from '@testing-library/user-event';
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
import {
  RAIL_OVERLAY_FRAME_NO_GAP,
  RAIL_OVERLAY_PANEL,
  SIDEBAR_FLOAT_OPEN_DELAY_MS,
  primeConsoleSidebarOpen,
} from '../consoleSidebarRail';

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
  const navigate = useNavigate();
  React.useEffect(() => {
    navigateTo = navigate;
  }, [navigate]);
  return <div data-testid="route">{location.pathname}</div>;
}

const DEFAULT_NAVIGATION = [
  { id: 'nav_accounts', type: 'object', objectName: 'account', label: 'Accounts' },
  { id: 'nav_contacts', type: 'object', objectName: 'contact', label: 'Contacts' },
];

function renderShell(width: number, navigation: unknown[] = DEFAULT_NAVIGATION) {
  setViewportWidth(width);
  metadataState = {
    apps: [
      {
        name: 'crm',
        label: 'CRM',
        active: true,
        navigation,
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

/** A page load: the console layout primes the provider before it mounts. */
function reload(width: number) {
  cleanup();
  setViewportWidth(width);
  primeConsoleSidebarOpen();
  return renderShell(width);
}

function resizeTo(width: number) {
  act(() => {
    setViewportWidth(width);
  });
}

const appBarTrigger = () => within(screen.getByTestId('app-bar')).getByRole('button', { name: 'Toggle sidebar' });

/** An entry's tooltip: open but hidden while the sidebar is expanded. */
const hiddenTooltip = () =>
  Array.from(document.querySelectorAll('[role="tooltip"]')).find((el) => el.closest('[hidden]'));

/** The folded sidebar's menu, floated over the content from the app bar's trigger. */
function expandRail() {
  fireEvent.click(appBarTrigger());
  expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
  expect(panel()).toHaveAttribute('data-console-rail', 'overlay');
}

/** Folded: hidden, with no icon column, and nothing in it reachable. */
function expectRail() {
  expect(sidebarRoot()).toHaveAttribute('data-state', 'collapsed');
  expect(sidebarRoot()).toHaveAttribute('data-collapsible', 'offcanvas');
  expect(panel()).toHaveAttribute('data-console-rail', 'hidden');
  expect(panel()).toHaveAttribute('inert');
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

describe('the narrow-window fold (objectstack#27593)', () => {
  it('at 1280 px the sidebar mounts folded and hidden, reserving no width', () => {
    renderShell(1280);
    expectRail();
    // Collapsed, the gap takes no width: the content is the whole window, with no icon column.
    expect(tokens(gap())).toContain('group-data-[state=collapsed]:group-data-[collapsible=offcanvas]:w-0');
    expect(keepOpen()).toBeNull();
  });

  it('the app bar’s trigger floats the menu over the content; the gap keeps no width', () => {
    renderShell(1280);
    expandRail();

    // The panel takes the expanded width above the page…
    for (const token of RAIL_OVERLAY_PANEL.split(' ')) expect(tokens(panel())).toContain(token);
    // …and the frame holds the gap at no width, so the content does not move.
    expect(tokens(frame())).toContain(RAIL_OVERLAY_FRAME_NO_GAP);
    const selector = /^\[&>(.+)\]:w-0$/.exec(RAIL_OVERLAY_FRAME_NO_GAP)?.[1];
    expect(selector, 'the frame variant names the element it narrows').toBeDefined();
    const target = frame().querySelector(`:scope > ${selector}`);
    expect(target, 'the variant reaches the primitive’s gap, not the panel').toBe(gap());
    expect(tokens(gap())).not.toContain('fixed');
    expect(tokens(panel())).toContain('fixed');
  });

  it('resting the pointer on the window’s left edge floats it; nothing of the hidden panel answers the pointer', () => {
    vi.useFakeTimers();
    try {
      renderShell(1280);
      // The hidden panel is inert: hovering it does nothing.
      fireEvent.pointerEnter(panel(), { pointerType: 'mouse' });
      fireEvent.mouseOver(background());
      act(() => {
        vi.advanceTimersByTime(SIDEBAR_FLOAT_OPEN_DELAY_MS * 2);
      });
      expectRail();

      // Ruling 6973617688 on objectstack#35062 changes this pin's "hover alone
      // does not expand": with the icon rail gone, the left edge floats the menu
      // on hover, as the app bar's trigger does on a click.
      fireEvent.pointerEnter(screen.getByTestId('console-sidebar-edge'), { pointerType: 'mouse' });
      act(() => {
        vi.advanceTimersByTime(SIDEBAR_FLOAT_OPEN_DELAY_MS);
      });
      expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
      expect(panel()).toHaveAttribute('data-console-rail', 'overlay');
    } finally {
      vi.useRealTimers();
    }
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

  describe('one Esc folds it wherever the pointer or focus is inside it (objectstack#28078)', () => {
    it('with focus on an entry, whose hidden tooltip is open', () => {
      renderShell(1280);
      expandRail();
      const entry = within(panel()).getByRole('link', { name: 'Contacts' });
      act(() => entry.focus());
      expect(hiddenTooltip(), 'the entry opened its hidden tooltip').toBeDefined();
      fireEvent.keyDown(entry, { key: 'Escape' });
      expectRail();
    });

    it('with the pointer on an entry', async () => {
      renderShell(1280);
      expandRail();
      fireEvent.pointerMove(within(panel()).getByRole('link', { name: 'Accounts' }), { pointerType: 'mouse' });
      await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
      expect(hiddenTooltip(), 'the entry opened its hidden tooltip').toBeDefined();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expectRail();
    });

    it('with focus on "Keep sidebar open"', () => {
      renderShell(1280);
      expandRail();
      const toggle = keepOpen()!;
      act(() => toggle.focus());
      expect(hiddenTooltip(), 'the toggle opened its hidden tooltip').toBeDefined();
      fireEvent.keyDown(toggle, { key: 'Escape' });
      expectRail();
    });

    it('an entry’s open menu still takes the Esc first', () => {
      renderShell(1280);
      expandRail();
      const entry = within(panel()).getByRole('link', { name: 'Accounts' });
      act(() => entry.focus());
      fireEvent.keyDown(within(panel()).getByRole('button', { name: 'More actions for Accounts' }), { key: 'Enter' });
      const item = screen.getAllByRole('menuitem')[0];
      fireEvent.keyDown(item, { key: 'Escape' });
      expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
    });
  });

  describe('"Keep sidebar open" leaves the wide-window choice alone (objectstack#28079)', () => {
    it('a collapsed wide-window sidebar comes back collapsed, after a reload too', () => {
      renderShell(1440);
      fireEvent.click(appBarTrigger());
      expect(sidebarRoot()).toHaveAttribute('data-state', 'collapsed');

      resizeTo(1280);
      expandRail();
      fireEvent.click(keepOpen()!);
      expect(keepOpen()).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(keepOpen()!);
      expectRail();

      resizeTo(1440);
      expect(sidebarRoot()).toHaveAttribute('data-state', 'collapsed');
      reload(1440);
      expect(sidebarRoot()).toHaveAttribute('data-state', 'collapsed');
    });

    it('an expanded wide-window sidebar comes back expanded, after a reload too', () => {
      renderShell(1440);
      expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');

      resizeTo(1280);
      expandRail();
      fireEvent.click(keepOpen()!);
      // Kept open on the narrow window, the reader collapses it there…
      fireEvent.click(appBarTrigger());
      expect(sidebarRoot()).toHaveAttribute('data-state', 'collapsed');
      // …and turns "keep open" off again.
      fireEvent.click(keepOpen()!);
      expectRail();

      resizeTo(1440);
      expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
      reload(1440);
      expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
    });
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

/**
 * A group the app declares `expanded: false` (the Account app's Developer
 * group) between two plain entries.
 */
const COLLAPSED_GROUP_NAVIGATION = [
  ...DEFAULT_NAVIGATION,
  {
    id: 'grp_developer',
    type: 'group',
    label: 'Developer',
    expanded: false,
    children: [
      { id: 'nav_api_keys', type: 'object', objectName: 'api_key', label: 'API Keys' },
      { id: 'nav_oauth_apps', type: 'object', objectName: 'oauth_app', label: 'OAuth Applications' },
    ],
  },
];

/** The group's disclosure: the label the expanded sidebar draws. */
const disclosure = () => within(panel()).getByRole('button', { name: /^Developer/ });
const groupEntry = (name: string) => within(panel()).queryByRole('link', { name });

describe('a collapsed group in the folded sidebar (objectstack#32156)', () => {
  it('at 1360 px the hidden sidebar offers none of its entries; the floated menu opens the group by its disclosure', () => {
    renderShell(1360, COLLAPSED_GROUP_NAVIGATION);
    expectRail();
    // objectstack#32156 listed the group's entries in the icon rail. With no
    // rail (ruling 6973617688 on objectstack#35062) the hidden panel is inert,
    // and the entries are reached through the floated menu.
    expandRail();
    expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
    expect(groupEntry('OAuth Applications')).toBeNull();
    fireEvent.click(disclosure());
    fireEvent.click(groupEntry('OAuth Applications')!);
    expectRail();
    expect(screen.getByTestId('route')).toHaveTextContent('/apps/crm/oauth_app');
  });

  it('at 1360 px the keyboard floats the menu from the trigger, opens the group and Enter opens an entry', async () => {
    const user = userEvent.setup();
    renderShell(1360, COLLAPSED_GROUP_NAVIGATION);
    act(() => appBarTrigger().focus());
    await user.keyboard('{Enter}');
    expect(panel()).toHaveAttribute('data-console-rail', 'overlay');
    expect(panel(), 'the trigger moves focus into the floated menu').toContainElement(
      document.activeElement as HTMLElement,
    );
    for (let press = 0; press < 8 && document.activeElement !== disclosure(); press++) {
      await user.tab();
    }
    expect(document.activeElement, 'Tab reaches the group’s disclosure').toBe(disclosure());
    await user.keyboard('{Enter}');
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
    for (let press = 0; press < 4 && document.activeElement !== groupEntry('API Keys'); press++) {
      await user.tab();
    }
    expect(document.activeElement, 'Tab reaches the entry').toBe(groupEntry('API Keys'));
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('route')).toHaveTextContent('/apps/crm/api_key');
    expectRail();
  });

  it('a wide window collapsed by hand is hidden too: no entry of the group is reachable', () => {
    renderShell(1440, COLLAPSED_GROUP_NAVIGATION);
    fireEvent.click(appBarTrigger());
    expect(sidebarRoot()).toHaveAttribute('data-state', 'collapsed');
    expect(sidebarRoot()).toHaveAttribute('data-collapsible', 'offcanvas');
    expect(panel()).toHaveAttribute('data-console-rail', 'hidden');
    expect(panel()).toHaveAttribute('inert');
  });

  it('the floated menu keeps the group collapsed, with its count, every time it floats', () => {
    renderShell(1360, COLLAPSED_GROUP_NAVIGATION);
    expandRail();
    expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
    expect(disclosure()).toHaveTextContent('2');
    expect(groupEntry('API Keys')).toBeNull();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expectRail();
    expandRail();
    expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
    expect(groupEntry('API Keys')).toBeNull();
  });

  it('at 1440 px the expanded sidebar keeps the group collapsed until its disclosure opens it', () => {
    renderShell(1440, COLLAPSED_GROUP_NAVIGATION);
    expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
    expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
    expect(groupEntry('API Keys')).toBeNull();

    fireEvent.click(disclosure());
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
    expect(groupEntry('API Keys')).not.toBeNull();
  });
});
