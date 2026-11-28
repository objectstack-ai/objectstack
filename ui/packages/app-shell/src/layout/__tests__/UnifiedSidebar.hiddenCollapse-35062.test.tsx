// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — from 768 px up a collapsed console sidebar is hidden, and
 * its full menu floats over the content (objectstack#35062, ruling 6973617688:
 * one collapsed look at 768 px and up).
 *
 * - Collapsed by hand on a wide window, and collapsed by default on a narrow
 *   one (below 1280 px, objectstack#36112), the sidebar takes no width and
 *   leaves no icon column; nothing in it is reachable.
 * - Resting the pointer on the window's left edge floats the full menu, its
 *   labels and groups, after the hover delay; moving away folds it back. A
 *   press on the edge floats it at once. Neither changes the collapsed state,
 *   which a reload keeps. The edge is the only way to float it.
 * - The page header's expand button (a sidebar trigger) docks the sidebar
 *   beside the content as the reader's choice, on either window, and a reload
 *   keeps it there (ruling 7069868269 on objectstack#36112): there is no
 *   "Keep sidebar open" control.
 * - ⌘B / Ctrl+B is a press on the expand / collapse button (ruling 7074574380
 *   on objectstack#36112, objectstack#36347): docked, it collapses the
 *   sidebar; collapsed, it docks it, a float included, on either side of the
 *   threshold; the choice is kept, a reload keeps it, and focus does not move.
 * - Choosing an entry navigates, folds the menu and leaves the sidebar
 *   collapsed.
 * - The edge is drawn only while the sidebar is hidden, never on a phone.
 * - objectstack#36485 — the float carries the app-name menu, and its
 *   「Design layout」 enters the design mode from there too.
 *
 * The test DOM computes no Tailwind and no layout, so widths are read as the
 * class that sets them; the rendered widths are measured in a browser on the
 * pull request. Harness: the provider / chrome stand-ins of
 * `UnifiedSidebar.railOverlay-27593.test.tsx`, with the real `SidebarProvider`,
 * `Sidebar`, `NavigationRenderer` and `useResponsiveSidebar`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

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

/** The viewer is a workspace admin: only the objectstack#36485 pins say so. */
let workspaceAdmin = false;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: workspaceAdmin, isResolved: true }),
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
  CONSOLE_EXPANDED_SIDEBAR_WIDTH,
  CONSOLE_SIDEBAR_MAX_WIDTH,
  CONSOLE_SIDEBAR_MIN_WIDTH,
  CONSOLE_SIDEBAR_NARROW_OPEN_PREFERENCE,
  CONSOLE_SIDEBAR_WIDTH_PREFERENCE,
  RAIL_HIDDEN_PANEL,
  RAIL_OVERLAY_FRAME_NO_GAP,
  RAIL_OVERLAY_PANEL,
  SIDEBAR_RESIZING_FRAME,
  SIDEBAR_EDGE_ZONE,
  SIDEBAR_FLOAT_CLOSE_DELAY_MS,
  SIDEBAR_FLOAT_OPEN_DELAY_MS,
  primeConsoleSidebarOpen,
  readWideWindowOpen,
  writeWideWindowOpen,
} from '../consoleSidebarRail';
import { readWorkspacePreference, writeWorkspacePreference } from '../../utils/workspacePreference';
import { DesignModeProvider, useDesignModeController } from '../designMode';

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

/** The page header's expand button, reduced to what the sidebar reads: `data-sidebar="trigger"` and the toggle. */
function Trigger() {
  const { toggleSidebar } = useSidebar();
  return (
    <button type="button" data-sidebar="trigger" onClick={toggleSidebar}>
      Toggle sidebar
    </button>
  );
}

/** The provider's own toggle, as the trigger's handler or ⌘B's listener calls it, with no capture phase of its own. */
function ProviderToggle() {
  const { toggleSidebar } = useSidebar();
  return (
    <button type="button" data-testid="provider-toggle" hidden onClick={toggleSidebar}>
      Provider toggle
    </button>
  );
}

function RouteProbe() {
  return <div data-testid="route">{useLocation().pathname}</div>;
}

/** The sales app's shape: a group of entries under a label, beside plain entries. */
const NAVIGATION = [
  { id: 'nav_accounts', type: 'object', objectName: 'account', label: 'Accounts' },
  { id: 'nav_contacts', type: 'object', objectName: 'contact', label: 'Contacts' },
  {
    id: 'grp_pipeline',
    type: 'group',
    label: 'Pipeline',
    children: [
      { id: 'nav_leads', type: 'object', objectName: 'lead', label: 'Leads' },
      { id: 'nav_opportunities', type: 'object', objectName: 'opportunity', label: 'Opportunities' },
    ],
  },
];

function renderShell(width: number) {
  setViewportWidth(width);
  metadataState = {
    apps: [{ name: 'crm', label: 'CRM', active: true, navigation: NAVIGATION }],
    objects: [],
  };
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider>
        <header data-testid="app-bar">
          <Trigger />
        </header>
        <ProviderToggle />
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

/**
 * Resize the window under a mounted shell. happy-dom's `MediaQueryList`
 * starts tracking a query's changes at "no match", whatever the width, so a
 * query that matches when the shell mounts (a narrow window's) reports no
 * change on its first resize; a resize at the current width first sets it
 * right.
 */
function resizeTo(width: number) {
  act(() => {
    window.dispatchEvent(new Event('resize'));
    setViewportWidth(width);
  });
}

/** A page load: the console layout primes the provider before it mounts. */
function reload(width: number) {
  cleanup();
  setViewportWidth(width);
  primeConsoleSidebarOpen();
  return renderShell(width);
}

/** The desktop sidebar's root: it carries the expanded / collapsed state. */
const sidebarRoot = () => document.querySelector<HTMLElement>('[data-side][data-variant][data-state]');
/** The in-flow box that reserves the sidebar's width: the root's first child. */
const gap = () => sidebarRoot()!.firstElementChild as HTMLElement;
/** The fixed panel: the root's second child, the one the call site's props land on. */
const panel = () => sidebarRoot()!.lastElementChild as HTMLElement;
const frame = () => screen.getByTestId('console-sidebar-frame');
const edge = () => screen.queryByTestId('console-sidebar-edge');
const trigger = () => within(screen.getByTestId('app-bar')).getByRole('button', { name: 'Toggle sidebar' });
const keepOpen = () => screen.queryByTestId('sidebar-keep-open');
const narrowChoice = () => readWorkspacePreference(CONSOLE_SIDEBAR_NARROW_OPEN_PREFERENCE, 'user');
/**
 * ⌘B where a real key press lands: on the focused element, else the body. It
 * bubbles through the document, where the console's sidebar answers it, to
 * the window, where the provider's own listener sits.
 */
const commandB = (init: KeyboardEventInit = { metaKey: true }) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'b', ...init });
const tokens = (el: Element) => el.className.split(/\s+/).filter(Boolean);
const sidebarCookie = () => /(?:^|;\s*)sidebar_state=(\w+)/.exec(document.cookie)?.[1];

/** The gap's width while collapsed is the primitive's hidden (`offcanvas`) width. */
const HIDDEN_GAP = 'group-data-[state=collapsed]:group-data-[collapsible=offcanvas]:w-0';

/** Collapsed and hidden: no width, no icon column, nothing reachable, and the edge drawn. */
function expectHidden() {
  expect(sidebarRoot()).toHaveAttribute('data-state', 'collapsed');
  expect(sidebarRoot()).toHaveAttribute('data-collapsible', 'offcanvas');
  expect(tokens(gap())).toContain(HIDDEN_GAP);
  expect(panel()).toHaveAttribute('data-console-rail', 'hidden');
  expect(panel()).toHaveAttribute('inert');
  expect(tokens(frame())).toEqual(['contents']);
  expect(edge()).not.toBeNull();
}

/** Docked beside the content: expanded, no float, no edge. */
function expectDocked() {
  expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
  expect(panel()).not.toHaveAttribute('data-console-rail');
  expect(tokens(frame())).toEqual(['contents']);
  expect(edge()).toBeNull();
}

/** The full menu floats over the content: expanded, above the page, the gap still at no width. */
function expectFloat() {
  expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
  expect(panel()).toHaveAttribute('data-console-rail', 'overlay');
  expect(panel()).not.toHaveAttribute('inert');
  expect(tokens(frame())).toContain(RAIL_OVERLAY_FRAME_NO_GAP);
}

/** Rest a mouse pointer on the window's left edge for `ms`. */
function hoverEdge(ms: number) {
  fireEvent.pointerEnter(edge()!, { pointerType: 'mouse' });
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = 'sidebar_state=; path=/; max-age=0';
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  setViewportWidth(1024);
  localStorage.clear();
  document.cookie = 'sidebar_state=; path=/; max-age=0';
});

describe('a collapsed console sidebar is hidden, with no icon column (objectstack#35062)', () => {
  it('collapsed by hand at 1600 px it takes no width and nothing in it is reachable; the expand button docks it again, after a reload too', () => {
    renderShell(1600);
    expectDocked();
    expect(keepOpen(), 'no "Keep sidebar open" (objectstack#36112)').toBeNull();

    fireEvent.click(trigger());
    expectHidden();
    expect(readWideWindowOpen()).toBe(false);

    // The way back beside the content: the expand button.
    fireEvent.click(trigger());
    expectDocked();
    expect(readWideWindowOpen()).toBe(true);
    expect(sidebarCookie()).toBe('true');

    reload(1600);
    expectDocked();
  });

  it('collapsed by default at 1024 px it is hidden the same way', () => {
    renderShell(1024);
    expectHidden();
  });

  it('the edge is a strip at the window’s left edge, its full height (no top bar above it, objectstack#36112)', () => {
    renderShell(1024);
    for (const token of SIDEBAR_EDGE_ZONE.split(' ')) expect(tokens(edge()!)).toContain(token);
    expect(tokens(edge()!)).toEqual(expect.arrayContaining(['top-0', 'h-svh']));
    expect(tokens(edge()!)).not.toContain('!top-12');
    expect(edge()).toHaveAttribute('aria-hidden', 'true');
  });

  it('below 768 px there is no edge: the phone keeps its drawer', () => {
    renderShell(700);
    expect(sidebarRoot()).toBeNull();
    expect(edge()).toBeNull();
    fireEvent.click(trigger());
    expect(edge()).toBeNull();
  });

  it('at 1024 px the expand button docks the sidebar as the narrow-window choice, after a reload too; the collapse button takes it back', () => {
    renderShell(1024);
    expectHidden();
    fireEvent.click(trigger());
    expectDocked();
    expect(narrowChoice()).toBe('on');
    expect(readWideWindowOpen(), 'the wide-window choice is not touched').toBeUndefined();
    reload(1024);
    expectDocked();

    // The sidebar's own collapse button (a trigger too) collapses it, and that is kept.
    fireEvent.click(trigger());
    expectHidden();
    expect(narrowChoice()).toBe('off');
    reload(1024);
    expectHidden();
  });

  it('a stored "keep open" from before reads as expanded on a narrow window', () => {
    writeWorkspacePreference(CONSOLE_SIDEBAR_NARROW_OPEN_PREFERENCE, 'user', 'on');
    renderShell(1024);
    expectDocked();
  });
});

describe('the left edge floats the full menu over the content (objectstack#35062)', () => {
  it('after the hover delay, with its labels and groups; moving away folds it back', () => {
    vi.useFakeTimers();
    renderShell(1024);
    hoverEdge(SIDEBAR_FLOAT_OPEN_DELAY_MS - 1);
    expectHidden();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expectFloat();
    expect(within(panel()).getByRole('link', { name: 'Accounts' })).toBeVisible();
    expect(within(panel()).getByRole('button', { name: /^Pipeline/ })).toBeInTheDocument();
    expect(within(panel()).getByRole('link', { name: 'Leads' })).toBeInTheDocument();

    // A pointer inside it keeps it; away from it a moment, it folds back.
    fireEvent.pointerMove(within(panel()).getByRole('link', { name: 'Contacts' }), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_CLOSE_DELAY_MS * 2);
    });
    expectFloat();
    fireEvent.pointerMove(screen.getByText('The page'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_CLOSE_DELAY_MS - 1);
    });
    expectFloat();
    fireEvent.pointerMove(within(panel()).getByRole('link', { name: 'Contacts' }), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_CLOSE_DELAY_MS * 2);
    });
    expectFloat();
    fireEvent.pointerMove(screen.getByText('The page'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_CLOSE_DELAY_MS);
    });
    expectHidden();
  });

  it('a pointer that leaves the edge before the delay floats nothing', () => {
    vi.useFakeTimers();
    renderShell(1024);
    hoverEdge(SIDEBAR_FLOAT_OPEN_DELAY_MS / 2);
    fireEvent.pointerLeave(edge()!, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_OPEN_DELAY_MS * 2);
    });
    expectHidden();
  });

  it('a press on the edge floats it at once, and it stays until a press outside', () => {
    vi.useFakeTimers();
    renderShell(1024);
    fireEvent.click(edge()!);
    expectFloat();
    fireEvent.pointerMove(screen.getByText('The page'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_CLOSE_DELAY_MS * 2);
    });
    expectFloat();
    fireEvent.pointerDown(screen.getByText('The page'));
    expectHidden();
  });

  it('collapsed by hand at 1600 px: floating changes nothing the reader chose, and a reload comes back collapsed', () => {
    vi.useFakeTimers();
    renderShell(1600);
    fireEvent.click(trigger());
    expectHidden();

    hoverEdge(SIDEBAR_FLOAT_OPEN_DELAY_MS);
    expectFloat();
    // The float is not the reader's choice: neither the wide-window choice nor the cookie records it.
    expect(readWideWindowOpen()).toBe(false);
    expect(sidebarCookie()).toBe('false');

    // A reload while it floats comes back collapsed.
    reload(1600);
    expectHidden();
  });

  it('choosing an entry navigates, folds the menu, and the sidebar stays collapsed, after a reload too', () => {
    vi.useFakeTimers();
    renderShell(1600);
    fireEvent.click(trigger());
    hoverEdge(SIDEBAR_FLOAT_OPEN_DELAY_MS);
    expectFloat();

    fireEvent.click(within(panel()).getByRole('link', { name: 'Leads' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/apps/crm/lead');
    expectHidden();
    expect(readWideWindowOpen()).toBe(false);

    reload(1600);
    expectHidden();
  });

  it('a window that turns narrow or wide ends a float over a sidebar collapsed by hand, and it stays collapsed', () => {
    renderShell(1600);
    fireEvent.click(trigger());
    fireEvent.click(edge()!);
    expectFloat();
    // Narrow, with no narrow-window choice kept: collapsed, and the float is not one.
    resizeTo(1024);
    expectHidden();
    expect(narrowChoice()).toBeUndefined();

    fireEvent.click(edge()!);
    expectFloat();
    // Wide again: the reader's wide-window choice, collapsed.
    resizeTo(1600);
    expectHidden();
    expect(readWideWindowOpen()).toBe(false);
  });

  it('a window that narrows past the threshold under a float collapses the sidebar, hidden', () => {
    renderShell(1600);
    fireEvent.click(trigger());
    fireEvent.click(edge()!);
    expectFloat();
    resizeTo(1279);
    expectHidden();
    expect(readWideWindowOpen()).toBe(false);
  });
});

describe('the expand button docks it, and the keyboard walks it (objectstack#35062, objectstack#36112)', () => {
  it('at 1024 px, the expand button docks it even when React renders between the capture phase and the trigger’s own click handler', () => {
    renderShell(1024);
    expectHidden();
    // A browser runs a microtask checkpoint after each listener, so React may
    // render the capture phase's choice before the trigger's own handler runs.
    // Here the click stops after the capture phase and renders (act), and the
    // provider's toggle comes after, on its own.
    const stopAfterCapture = (event: Event) => event.stopPropagation();
    document.body.addEventListener('click', stopAfterCapture, true);
    try {
      fireEvent.click(trigger());
    } finally {
      document.body.removeEventListener('click', stopAfterCapture, true);
    }
    expectHidden();
    expect(narrowChoice()).toBe('on');
    fireEvent.click(screen.getByTestId('provider-toggle'));
    expectDocked();
    expect(narrowChoice()).toBe('on');
  });

  it('an entry chosen from the keyboard in a float navigates, folds it, and gives focus back to the trigger', () => {
    renderShell(1024);
    act(() => trigger().focus());
    fireEvent.click(edge()!);
    expectFloat();
    const entry = within(panel()).getByRole('link', { name: 'Contacts' });
    act(() => entry.focus());
    // A keyboard activation's click counts no presses.
    fireEvent.click(entry, { detail: 0 });
    expect(screen.getByTestId('route')).toHaveTextContent('/apps/crm/contact');
    expectHidden();
    expect(document.activeElement).toBe(trigger());
  });

  it('collapsing an expanded sidebar from the keyboard gives focus inside it to the trigger', () => {
    renderShell(1600);
    act(() => within(panel()).getByRole('link', { name: 'Accounts' }).focus());
    commandB({ ctrlKey: true });
    expectHidden();
    expect(document.activeElement).toBe(trigger());
  });
});

describe('⌘B / Ctrl+B is a press on the expand / collapse button (objectstack#36347, ruling 7074574380 on objectstack#36112)', () => {
  it('at 1600 px ⌘B collapses the docked sidebar and docks it again, as the reader’s choice, after a reload too', () => {
    renderShell(1600);
    expectDocked();
    commandB();
    expectHidden();
    expect(readWideWindowOpen()).toBe(false);
    expect(sidebarCookie()).toBe('false');
    reload(1600);
    expectHidden();

    commandB();
    expectDocked();
    expect(readWideWindowOpen()).toBe(true);
    expect(sidebarCookie()).toBe('true');
    reload(1600);
    expectDocked();
  });

  it('at 1024 px ⌘B docks the sidebar collapsed by default and keeps the narrow-window choice expanded, after a reload too; ⌘B again collapses it', () => {
    renderShell(1024);
    expectHidden();
    commandB();
    expectDocked();
    expect(narrowChoice()).toBe('on');
    expect(readWideWindowOpen(), 'the wide-window choice is not touched').toBeUndefined();
    reload(1024);
    expectDocked();

    commandB({ ctrlKey: true });
    expectHidden();
    expect(narrowChoice()).toBe('off');
    reload(1024);
    expectHidden();
  });

  it('on either window, collapsed or docked, ⌘B leaves what a press on the button leaves', () => {
    for (const width of [1600, 1024]) {
      for (const [start, ends] of [
        [reloadCollapsed, 'expanded'],
        [reloadDocked, 'collapsed'],
      ] as const) {
        start(width);
        fireEvent.click(trigger());
        const byButton = readChoices();
        start(width);
        commandB();
        expect(readChoices(), `${width} px, from ${start.name}`).toEqual(byButton);
        expect(byButton.state, `${width} px, from ${start.name}`).toBe(ends);
      }
    }
  });

  it('collapsed by hand at 1600 px, ⌘B docks it and moves no focus', () => {
    renderShell(1600);
    fireEvent.click(trigger());
    expectHidden();
    act(() => trigger().focus());
    commandB();
    expectDocked();
    expect(document.activeElement, 'focus stays where it was, as with a press').toBe(trigger());
  });

  it('while the menu floats from the left edge, ⌘B docks it where it is, on either window, and a reload keeps it', () => {
    // At 1024 px, collapsed by default: the float docks as the narrow-window choice.
    renderShell(1024);
    act(() => trigger().focus());
    fireEvent.click(edge()!);
    expectFloat();
    commandB();
    expectDocked();
    expect(narrowChoice()).toBe('on');
    expect(sidebarCookie()).toBe('true');
    expect(document.activeElement, 'focus does not move').toBe(trigger());
    reload(1024);
    expectDocked();

    // At 1600 px, collapsed by hand: the float docks as the wide-window choice.
    cleanup();
    localStorage.clear();
    renderShell(1600);
    fireEvent.click(trigger());
    vi.useFakeTimers();
    hoverEdge(SIDEBAR_FLOAT_OPEN_DELAY_MS);
    expectFloat();
    expect(readWideWindowOpen()).toBe(false);
    commandB();
    expectDocked();
    expect(readWideWindowOpen()).toBe(true);
    expect(sidebarCookie()).toBe('true');
    // Docked, the pointer moving away folds nothing.
    fireEvent.pointerMove(screen.getByText('The page'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_CLOSE_DELAY_MS * 2);
    });
    expectDocked();
    vi.useRealTimers();
    reload(1600);
    expectDocked();
  });

  it('one ⌘B is one press: the provider’s own listener on the window does not also take it from 768 px up', () => {
    const seen: string[] = [];
    const onWindow = (event: KeyboardEvent) => {
      if (event.key === 'b') seen.push(event.type);
    };
    window.addEventListener('keydown', onWindow);
    try {
      renderShell(1600);
      commandB();
      expectHidden();
      expect(seen, 'the chord does not reach the window').toEqual([]);

      // On a phone the provider's listener opens the drawer, as before.
      cleanup();
      renderShell(700);
      commandB();
      expect(seen).toEqual(['keydown']);
      expect(document.querySelector('[data-mobile="true"][data-sidebar="sidebar"]')).not.toBeNull();
    } finally {
      window.removeEventListener('keydown', onWindow);
    }
  });
});

/** The state and the kept choices a press leaves: what a reload reads. */
function readChoices() {
  return {
    state: sidebarRoot()?.getAttribute('data-state'),
    rail: panel().getAttribute('data-console-rail'),
    wide: readWideWindowOpen(),
    narrow: narrowChoice(),
    cookie: sidebarCookie(),
  };
}

/** A fresh browser at `width` whose sidebar starts collapsed. */
function reloadCollapsed(width: number) {
  localStorage.clear();
  document.cookie = 'sidebar_state=; path=/; max-age=0';
  if (width >= 1280) writeWideWindowOpen(false);
  return reload(width);
}

/** A fresh browser at `width` whose sidebar starts docked. */
function reloadDocked(width: number) {
  localStorage.clear();
  document.cookie = 'sidebar_state=; path=/; max-age=0';
  if (width < 1280) writeWorkspacePreference(CONSOLE_SIDEBAR_NARROW_OPEN_PREFERENCE, 'user', 'on');
  return reload(width);
}

describe('the float carries the app menu, and its 「Design layout」 enters the design mode (objectstack#36485, objectstack#36758)', () => {
  /** The shell's hold on the mode, as `ConsoleLayout` keeps it, and whether it is on. */
  function Shell({ children }: { children: React.ReactNode }) {
    const mode = useDesignModeController({ appName: 'crm', appBasePath: '/apps/crm', enabled: true });
    return (
      <DesignModeProvider value={mode}>
        <output data-testid="mode">{mode.active ? 'on' : 'off'}</output>
        {children}
      </DesignModeProvider>
    );
  }

  afterEach(() => {
    workspaceAdmin = false;
    vi.unstubAllGlobals();
  });

  it('collapsed at 1024 px, pressed open from the left edge: the app menu offers 「Design layout」 to an admin who may author, and it turns the mode on', async () => {
    workspaceAdmin = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => ({
        headers: new Headers(), ok: true,
        status: 200,
        json: async () =>
          String(url).endsWith('/api/v1/packages')
            ? { data: { packages: [{ manifest: { id: 'com.acme.crm', name: 'CRM' }, writable: true }] } }
            : { data: [] },
      })),
    );
    setViewportWidth(1024);
    metadataState = {
      apps: [{ name: 'crm', label: 'CRM', active: true, navigation: NAVIGATION, _packageId: 'com.acme.crm' }],
      objects: [],
    };
    render(
      <MemoryRouter initialEntries={['/apps/crm']}>
        <Shell>
          <SidebarProvider>
            <Fold />
            <UnifiedSidebar activeAppName="crm" railOverlay />
            <div data-testid="page">
              <p>The page</p>
            </div>
          </SidebarProvider>
        </Shell>
      </MemoryRouter>,
    );
    // The package list's verdict settled, so an absent item is a reading.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expectHidden();
    fireEvent.click(edge()!);
    expectFloat();

    const menuTrigger = within(panel()).getByTestId('sidebar-app-menu-trigger');
    fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const item = await screen.findByTestId('sidebar-app-menu-design-layout');
    expect(item).toHaveTextContent('Design layout');
    expect(screen.getByTestId('mode')).toHaveTextContent('off');
    await act(async () => fireEvent.click(item));
    expect(screen.getByTestId('mode')).toHaveTextContent('on');
  });
});

/** The width the frame hands the sidebar primitive (its `--sidebar-width`). */
const frameWidth = () => frame().style.getPropertyValue('--sidebar-width');
const resizeHandle = () => screen.queryByTestId('console-sidebar-resize');
const keptWidth = () => readWorkspacePreference(CONSOLE_SIDEBAR_WIDTH_PREFERENCE, 'user');

describe('the docked sidebar’s right edge resizes it, and the float takes the width (objectstack#36227)', () => {
  it('at 1440 px a drag on the edge resizes it between 200 and 350; the width is kept once the drag ends, and a reload keeps it', () => {
    renderShell(1440);
    expectDocked();
    expect(frameWidth()).toBe(`${CONSOLE_EXPANDED_SIDEBAR_WIDTH}px`);
    const handle = resizeHandle()!;
    expect(handle).toHaveAttribute('role', 'separator');
    expect(handle).toHaveAttribute('aria-valuenow', '256');
    expect(handle).toHaveAttribute('aria-valuemin', String(CONSOLE_SIDEBAR_MIN_WIDTH));
    expect(handle).toHaveAttribute('aria-valuemax', String(CONSOLE_SIDEBAR_MAX_WIDTH));

    // Dragged far right: held at the widest, the primitive's transition off while it follows.
    fireEvent.pointerDown(handle, { button: 0, clientX: 256, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
    expect(frameWidth()).toBe('350px');
    expect(tokens(frame())).toContain(SIDEBAR_RESIZING_FRAME);
    expect(keptWidth(), 'nothing is kept mid-drag').toBeUndefined();
    // Dragged far left: held at the narrowest.
    fireEvent.pointerMove(handle, { clientX: 0, pointerId: 1 });
    expect(frameWidth()).toBe('200px');
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 300, pointerId: 1 });
    expect(frameWidth()).toBe('300px');
    expect(tokens(frame())).toEqual(['contents']);
    expect(keptWidth()).toBe(300);

    reload(1440);
    expectDocked();
    expect(frameWidth()).toBe('300px');
    expect(resizeHandle()).toHaveAttribute('aria-valuenow', '300');
  });

  it('a double-click on the edge comes back to 256; the arrow keys, Home and End move it too', () => {
    writeWorkspacePreference(CONSOLE_SIDEBAR_WIDTH_PREFERENCE, 'user', 320);
    renderShell(1440);
    expect(frameWidth()).toBe('320px');
    fireEvent.doubleClick(resizeHandle()!);
    expect(frameWidth()).toBe('256px');
    expect(keptWidth()).toBe(256);

    fireEvent.keyDown(resizeHandle()!, { key: 'End' });
    expect(frameWidth()).toBe('350px');
    fireEvent.keyDown(resizeHandle()!, { key: 'ArrowRight' });
    expect(frameWidth(), 'held at the widest').toBe('350px');
    fireEvent.keyDown(resizeHandle()!, { key: 'ArrowLeft' });
    expect(frameWidth()).toBe('334px');
    fireEvent.keyDown(resizeHandle()!, { key: 'Home' });
    expect(frameWidth()).toBe('200px');
    expect(keptWidth()).toBe(200);
  });

  it('a kept width out of the range reads as the nearest end', () => {
    writeWorkspacePreference(CONSOLE_SIDEBAR_WIDTH_PREFERENCE, 'user', 9000);
    renderShell(1440);
    expect(frameWidth()).toBe('350px');
  });

  it('collapsed, the edge is gone; the float takes the kept width, drawn as a card, and the hidden panel keeps the card parked past the edge', () => {
    vi.useFakeTimers();
    writeWorkspacePreference(CONSOLE_SIDEBAR_WIDTH_PREFERENCE, 'user', 300);
    renderShell(1024);
    expectHidden();
    expect(resizeHandle()).toBeNull();
    expect(frameWidth()).toBe('300px');
    for (const token of RAIL_HIDDEN_PANEL.split(' ')) expect(tokens(panel())).toContain(token);

    hoverEdge(SIDEBAR_FLOAT_OPEN_DELAY_MS);
    expectFloat();
    expect(resizeHandle(), 'the float is not resized').toBeNull();
    expect(frameWidth()).toBe('300px');
    for (const token of RAIL_OVERLAY_PANEL.split(' ')) expect(tokens(panel())).toContain(token);
    // A card: off the window's edges, rounded, with a shadow. Its offset is
    // from the window's inline start, the primitive's own edge (objectstack#37914).
    expect(tokens(panel())).toEqual(expect.arrayContaining(['inset-y-2', 'start-2', 'rounded-lg', 'shadow-xl']));
    expect(tokens(panel())).not.toContain('inset-y-0');
    expect(tokens(panel())).not.toContain('start-0');
    expect(tokens(panel())).not.toContain('left-0');
  });

  it('the edge going away mid-drag ends the drag as a cancel: the page is selectable again and the width goes back (⌘B, then a narrow window)', () => {
    const body = document.body.style;
    writeWorkspacePreference(CONSOLE_SIDEBAR_WIDTH_PREFERENCE, 'user', 300);
    renderShell(1440);

    // ⌘B folds the sidebar while the edge is held.
    fireEvent.pointerDown(resizeHandle()!, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(resizeHandle()!, { clientX: 340, pointerId: 1 });
    expect(frameWidth()).toBe('340px');
    expect(body.getPropertyValue('user-select')).toBe('none');
    commandB();
    expectHidden();
    expect(resizeHandle()).toBeNull();
    expect(body.getPropertyValue('user-select'), 'the page is selectable again').toBe('');
    expect(body.getPropertyValue('cursor')).toBe('');
    expect(frameWidth(), 'back to the width it had').toBe('300px');
    expect(tokens(frame())).not.toContain(SIDEBAR_RESIZING_FRAME);
    expect(keptWidth()).toBe(300);

    // The window narrows past 768 px while the edge is held.
    commandB();
    expectDocked();
    fireEvent.pointerDown(resizeHandle()!, { button: 0, clientX: 300, pointerId: 2 });
    fireEvent.pointerMove(resizeHandle()!, { clientX: 220, pointerId: 2 });
    expect(body.getPropertyValue('user-select')).toBe('none');
    resizeTo(700);
    expect(resizeHandle()).toBeNull();
    expect(body.getPropertyValue('user-select')).toBe('');
    expect(body.getPropertyValue('cursor')).toBe('');
    expect(keptWidth()).toBe(300);
    resizeTo(1440);
    expect(frameWidth(), 'nothing of the drag is left behind').toBe('300px');
    expect(tokens(frame())).not.toContain(SIDEBAR_RESIZING_FRAME);
  });

  it('on a phone the drawer keeps its own width and draws no edge', () => {
    writeWorkspacePreference(CONSOLE_SIDEBAR_WIDTH_PREFERENCE, 'user', 300);
    renderShell(700);
    expect(resizeHandle()).toBeNull();
    expect(frameWidth()).toBe('');
  });
});

describe('a menu opened from the float keeps it out (objectstack#36471)', () => {
  /** The float a resting pointer opened on a wide window, the pointer then past it on the page. */
  function floatThenPointerAway() {
    vi.useFakeTimers();
    writeWideWindowOpen(false);
    reload(1440);
    expectHidden();
    hoverEdge(SIDEBAR_FLOAT_OPEN_DELAY_MS);
    expectFloat();
    // The float still sliding in: the pointer is past its edge a moment, which starts the fold's clock.
    fireEvent.pointerMove(screen.getByText('The page'), { pointerType: 'mouse' });
  }

  it('the app name pressed before the fold’s moment is up: the menu opens, and the float stays while it is open', () => {
    floatThenPointerAway();
    fireEvent.pointerDown(within(panel()).getByTestId('sidebar-app-menu-trigger'), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    expect(screen.getByTestId('sidebar-app-menu')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_CLOSE_DELAY_MS * 3);
    });
    expectFloat();
    expect(screen.getByTestId('sidebar-app-menu')).toBeInTheDocument();
  });

  it('a menu opened from the float with no press in it (the keyboard) holds the float when the moment is up', () => {
    floatThenPointerAway();
    fireEvent.keyDown(within(panel()).getByTestId('sidebar-app-menu-trigger'), { key: 'Enter' });
    expect(screen.getByTestId('sidebar-app-menu')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_CLOSE_DELAY_MS * 3);
    });
    expectFloat();
  });

  it('a press in the float stops the fold’s clock; a later move away starts it again', () => {
    floatThenPointerAway();
    fireEvent.pointerDown(within(panel()).getByRole('link', { name: 'Contacts' }), { button: 0, pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_CLOSE_DELAY_MS * 3);
    });
    expectFloat();
    fireEvent.pointerMove(screen.getByText('The page'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_CLOSE_DELAY_MS);
    });
    expectHidden();
  });

  it('once the menu closes, moving away folds the float as before', () => {
    floatThenPointerAway();
    fireEvent.pointerDown(within(panel()).getByTestId('sidebar-app-menu-trigger'), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_CLOSE_DELAY_MS * 3);
    });
    expectFloat();
    fireEvent.keyDown(screen.getByTestId('sidebar-app-menu'), { key: 'Escape' });
    expect(screen.queryByTestId('sidebar-app-menu')).toBeNull();
    fireEvent.pointerMove(screen.getByText('The page'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_CLOSE_DELAY_MS);
    });
    expectHidden();
  });
});
