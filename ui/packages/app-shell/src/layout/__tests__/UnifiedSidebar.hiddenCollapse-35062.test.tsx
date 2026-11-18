// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — from 768 px up a collapsed console sidebar is hidden, and
 * its full menu floats over the content (objectstack#35062, ruling 6973617688:
 * one collapsed look at 768 px and up).
 *
 * - Collapsed by hand on a wide window, and folded on its own on a narrow one,
 *   the sidebar takes no width and leaves no icon column; nothing in it is
 *   reachable.
 * - Resting the pointer on the window's left edge floats the full menu, its
 *   labels and groups, after the hover delay; moving away folds it back. A
 *   press on the edge floats it at once. Neither changes the collapsed state,
 *   which a reload keeps.
 * - The app bar's trigger floats the folded menu and moves focus into it; Esc
 *   folds it and gives focus back to the trigger. On a sidebar the reader
 *   collapsed, the trigger expands it beside the content, as before.
 * - Choosing an entry navigates, folds the menu and leaves the sidebar
 *   collapsed.
 * - "Keep sidebar open" still turns the fold off; the edge is drawn only while
 *   the sidebar is hidden, never on a phone.
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
  CONSOLE_SIDEBAR_KEEP_OPEN_PREFERENCE,
  RAIL_OVERLAY_FRAME_NO_GAP,
  SIDEBAR_EDGE_ZONE,
  SIDEBAR_FLOAT_CLOSE_DELAY_MS,
  SIDEBAR_FLOAT_OPEN_DELAY_MS,
  primeConsoleSidebarOpen,
  readWideWindowOpen,
} from '../consoleSidebarRail';
import { writeWorkspacePreference } from '../../utils/workspacePreference';

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

/** The app bar's trigger, reduced to what the sidebar reads: `data-sidebar="trigger"` and the toggle. */
function Trigger() {
  const { toggleSidebar } = useSidebar();
  return (
    <button type="button" data-sidebar="trigger" onClick={toggleSidebar}>
      Toggle sidebar
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
  it('collapsed by hand at 1600 px it takes no width and nothing in it is reachable; the trigger expands it again', () => {
    renderShell(1600);
    expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
    expect(edge(), 'no edge beside an expanded sidebar').toBeNull();

    fireEvent.click(trigger());
    expectHidden();
    expect(readWideWindowOpen()).toBe(false);

    // The trigger expands it beside the content, as before: no float.
    fireEvent.click(trigger());
    expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
    expect(panel()).not.toHaveAttribute('data-console-rail');
    expect(tokens(frame())).toEqual(['contents']);
    expect(edge()).toBeNull();
    expect(readWideWindowOpen()).toBe(true);
  });

  it('folded on its own at 1280 px it is hidden the same way', () => {
    renderShell(1280);
    expectHidden();
  });

  it('the edge is a strip at the window’s left edge, below the top bar', () => {
    renderShell(1280);
    for (const token of SIDEBAR_EDGE_ZONE.split(' ')) expect(tokens(edge()!)).toContain(token);
    expect(tokens(edge()!)).toContain('!top-12');
    expect(edge()).toHaveAttribute('aria-hidden', 'true');
  });

  it('below 768 px there is no edge: the phone keeps its drawer', () => {
    renderShell(700);
    expect(sidebarRoot()).toBeNull();
    expect(edge()).toBeNull();
    fireEvent.click(trigger());
    expect(edge()).toBeNull();
  });

  it('"Keep sidebar open" still turns the fold off at 1280 px', () => {
    writeWorkspacePreference(CONSOLE_SIDEBAR_KEEP_OPEN_PREFERENCE, 'user', 'on');
    renderShell(1280);
    expect(sidebarRoot()).toHaveAttribute('data-state', 'expanded');
    expect(panel()).not.toHaveAttribute('data-console-rail');
    expect(edge()).toBeNull();
    // Collapsed there by hand, it is hidden like any other collapse.
    fireEvent.click(trigger());
    expectHidden();
  });
});

describe('the left edge floats the full menu over the content (objectstack#35062)', () => {
  it('after the hover delay, with its labels and groups; moving away folds it back', () => {
    vi.useFakeTimers();
    renderShell(1280);
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
    renderShell(1280);
    hoverEdge(SIDEBAR_FLOAT_OPEN_DELAY_MS / 2);
    fireEvent.pointerLeave(edge()!, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_FLOAT_OPEN_DELAY_MS * 2);
    });
    expectHidden();
  });

  it('a press on the edge floats it at once, and it stays until a press outside', () => {
    vi.useFakeTimers();
    renderShell(1280);
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
});

describe('the trigger floats the folded menu, and the keyboard walks it (objectstack#35062)', () => {
  it('at 1280 px the trigger floats it and moves focus in; Esc folds it and focus goes back to the trigger', () => {
    renderShell(1280);
    act(() => trigger().focus());
    fireEvent.click(trigger());
    expectFloat();
    expect(panel(), 'focus moves into the floated menu').toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expectHidden();
    expect(document.activeElement, 'focus goes back to the trigger').toBe(trigger());
  });

  it('⌘B floats it too', () => {
    renderShell(1280);
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expectFloat();
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expectHidden();
  });

  it('an entry chosen from the keyboard navigates, folds it, and gives focus back to the trigger', () => {
    renderShell(1280);
    act(() => trigger().focus());
    fireEvent.click(trigger());
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
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expectHidden();
    expect(document.activeElement).toBe(trigger());
  });
});
