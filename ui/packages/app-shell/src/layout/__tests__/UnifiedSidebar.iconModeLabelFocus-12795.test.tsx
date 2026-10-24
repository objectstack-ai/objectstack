// @vitest-environment jsdom
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — in the collapsed (icon-mode) sidebar a hidden group label
 * is no keyboard focus stop and is not in the accessibility tree
 * (objectui#12795). This file covers the app-shell call sites: the Area,
 * Recent and Starred labels, and Tab through the navigation the sidebar
 * renders with `NavigationRenderer`.
 *
 * The `SidebarGroupLabel` primitive hides a label there with `opacity-0` and
 * `-mt-8` only, so a collapsible group's label (a button) stayed a Tab stop,
 * and every label stayed in the accessibility tree. Each call site now adds a
 * variant-scoped `invisible`.
 *
 * Instrument: the REAL Tailwind compiler. The labels' class tokens are
 * compiled with `tailwindcss` and injected, so the DOM computes `visibility`
 * from the classes the labels carry; user-event's Tab and Testing Library's
 * role queries then read behaviour. jsdom, because happy-dom does not match
 * the `:is(:where(.group)[data-state="collapsed"] *)` selectors Tailwind emits
 * for group variants. The layout package's
 * `sidebarGroupLabel.iconModeFocus-12795.test.tsx` documents the instrument.
 *
 * Harness: the provider / chrome mocks of
 * `UnifiedSidebar.iconModeRecentLabel-12744.test.tsx`; `@object-ui/layout` and
 * `@object-ui/components` (the real `SidebarProvider`, `Sidebar` and
 * `SidebarGroupLabel`) stay REAL.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { isInaccessible } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { compile } from 'tailwindcss';

/** What the recent-items and favorites stores hold, and which arm renders. */
const state = vi.hoisted(() => ({
  recent: [] as unknown[],
  favorites: [] as unknown[],
  context: 'app' as 'app' | 'home',
}));

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
}));

vi.mock('../../utils', () => ({
  resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : ''),
  matchAppBySegment: (apps: Array<{ name?: string }>, segment?: string) =>
    apps.find((a) => a?.name === segment),
  appRouteSegment: (app: { name?: string }) => app?.name,
}));

vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));
vi.mock('../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: state.recent }) }));
vi.mock('../../hooks/useFavorites', () => ({
  useFavorites: () => ({ favorites: state.favorites, removeFavorite: vi.fn() }),
}));
vi.mock('../../hooks/useNavPins', () => ({
  useNavPins: () => ({ togglePin: vi.fn(), applyPins: (items: unknown) => items }),
}));
vi.mock('../../hooks/useNavActionDispatch', () => ({
  useNavActionDispatch: () => vi.fn(),
}));
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ context: state.context, currentAppName: 'crm' }),
}));
vi.mock('../ContextSelectors', () => ({
  useAppContextSelectors: () => ({ contextValues: {}, element: null }),
  contextSelectorQueryKey: (id: string) => (id === 'active_package' ? 'package' : id),
  STUDIO_PACKAGE_SELECTOR_ID: 'active_package',
}));
vi.mock('../LocalizedSidebarTrigger', () => ({
  LocalizedSidebarTrigger: () => null,
}));

import { SidebarProvider } from '@object-ui/components';
import { UnifiedSidebar } from '../UnifiedSidebar';

const tailwind = await compile('@tailwind utilities;');

beforeAll(() => {
  // jsdom has no `matchMedia`; the sidebar's `useIsMobile` reads it. A desktop
  // width keeps the sidebar out of its mobile sheet.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

let sheets: HTMLStyleElement[] = [];
afterEach(() => {
  cleanup();
  for (const s of sheets) s.remove();
  sheets = [];
});

const RECENT = {
  id: 'metadata:object:account',
  type: 'metadata',
  label: 'account',
  href: '/apps/crm/metadata/object/account',
  visitedAt: '2026-10-16T09:00:00.000Z',
};

const STARRED = { id: 'fav_account', type: 'object', label: 'Starred accounts', href: '/apps/crm/account' };

const obj = (id: string, label: string) => ({ id, type: 'object', objectName: id, label });

/**
 * Two areas (so the Area label draws), each area's navigation a row then an
 * open group, and the Recent group below the navigation.
 */
const APP = {
  name: 'crm',
  label: 'CRM',
  active: true,
  areas: [
    {
      id: 'area_work',
      label: 'Work',
      navigation: [
        obj('page_authoring', 'Page Authoring'),
        { id: 'grp_workspace', type: 'group', label: 'Workspace', expanded: true, children: [obj('my_work', 'My Work'), obj('tasks', 'Tasks')] },
      ],
    },
    { id: 'area_money', label: 'Money', navigation: [obj('invoices', 'Invoices')] },
  ],
};

const labelsIn = (root: ParentNode) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-sidebar="group-label"]'));

function sidebarUi(open: boolean) {
  metadataState = { apps: [APP], objects: [] };
  const view = render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider defaultOpen={open}>
        <UnifiedSidebar activeAppName="crm" />
      </SidebarProvider>
    </MemoryRouter>,
  );
  const candidates = new Set<string>();
  for (const label of labelsIn(view.container)) {
    for (const t of label.className.split(/\s+/)) if (t) candidates.add(t);
  }
  const sheet = document.createElement('style');
  sheet.textContent = tailwind.build([...candidates]);
  document.head.appendChild(sheet);
  sheets.push(sheet);
  return view;
}

const tokens = (el: Element) => el.className.split(/\s+/).filter(Boolean);

/** The variant prefix the primitive hides this label under, read off its `…:opacity-0` token. */
function hidingPrefix(label: Element): string {
  const hide = tokens(label).find((t) => t.endsWith(':opacity-0'));
  expect(hide, 'the primitive hides the label with a variant-scoped opacity-0').toBeDefined();
  return hide!.slice(0, -'opacity-0'.length);
}

const labelByText = (text: string) =>
  screen.getByText(text).closest('[data-sidebar="group-label"]') as HTMLElement;

function expectHidden(label: HTMLElement) {
  const prefix = hidingPrefix(label);
  expect(tokens(label)).toContain(`${prefix}invisible`);
  expect(tokens(label)).toContain(`${prefix}transition-[margin,opacity,visibility]`);
  expect(getComputedStyle(label).visibility).toBe('hidden');
  expect(isInaccessible(label)).toBe(true);
}

function expectShown(label: HTMLElement) {
  expect(getComputedStyle(label).visibility).not.toBe('hidden');
  expect(isInaccessible(label)).toBe(false);
}

const sidebarOf = (container: HTMLElement) => container.querySelector('[data-sidebar="sidebar"]') as HTMLElement;

/**
 * Tabs from `start` until focus leaves the sidebar, and returns the rows and
 * labels that took focus, in order. Each row's own menu button is left out:
 * the browser hides it in icon mode through classes this file does not
 * compile, so in this DOM it would read as a stop it is not.
 */
async function tabWalk(start: HTMLElement, root: HTMLElement) {
  const user = userEvent.setup();
  start.focus();
  const seen: HTMLElement[] = [start];
  for (let i = 0; i < 50; i++) {
    await user.tab();
    const el = document.activeElement as HTMLElement | null;
    if (!el || !root.contains(el) || el === start) break;
    seen.push(el);
  }
  return seen.filter((el) => el.tagName === 'A' || el.closest('[data-sidebar="group-label"]'));
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = 'sidebar_state=; path=/; max-age=0';
  state.recent = [RECENT];
  state.favorites = [];
  state.context = 'app';
});

describe('UnifiedSidebar — a hidden group label is no focus stop in icon mode (objectui#12795)', () => {
  it('collapsed to icons: the Area, Workspace and Recent labels are hidden and not announced, and Tab skips them', async () => {
    const { container } = sidebarUi(false);
    const peer = container.querySelector('.group.peer[data-state]');
    expect(peer).toHaveAttribute('data-state', 'collapsed');
    expect(peer).toHaveAttribute('data-collapsible', 'icon');

    const walk = await tabWalk(screen.getByRole('link', { name: 'Page Authoring' }), sidebarOf(container));
    expect(walk.map((el) => el.textContent?.trim())).toEqual(['Page Authoring', 'My Work', 'Tasks', 'All reports']);
    expect(walk.filter((el) => el.closest('[data-sidebar="group-label"]'))).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Workspace' })).not.toBeInTheDocument();

    const labels = labelsIn(container);
    expect(labels).toHaveLength(3);
    expect(labelByText('Area')).toBe(labels[0]);
    expect(labelByText('Recent')).toBe(labels[2]);
    for (const label of labels) expectHidden(label);
  });

  it('collapsed to icons (home arm): the Starred label is hidden and not announced', () => {
    state.context = 'home';
    state.favorites = [STARRED];
    const { container } = sidebarUi(false);
    const labels = labelsIn(container);
    expect(labels).toHaveLength(1);
    expect(labelByText('Starred')).toBe(labels[0]);
    expectHidden(labels[0]);
  });

  it('expanded (CONTROL): the Workspace label is still a focus stop after Page Authoring, Enter still toggles it, and Recent still opens on click', async () => {
    const { container } = sidebarUi(true);
    expect(container.querySelector('.group.peer[data-state]')).toHaveAttribute('data-state', 'expanded');
    for (const label of labelsIn(container)) expectShown(label);

    const walk = await tabWalk(screen.getByRole('link', { name: 'Page Authoring' }), sidebarOf(container));
    expect(walk.map((el) => el.textContent?.trim())).toEqual(['Page Authoring', 'Workspace', 'My Work', 'Tasks', 'All reports']);

    const user = userEvent.setup();
    const workspace = screen.getByRole('button', { name: 'Workspace' });
    workspace.focus();
    expect(workspace).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Enter}');
    expect(workspace).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'My Work' })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(workspace).toHaveAttribute('aria-expanded', 'true');

    expect(screen.queryByRole('link', { name: /\baccount$/ })).not.toBeInTheDocument();
    await user.click(labelByText('Recent'));
    expect(screen.getByRole('link', { name: /\baccount$/ })).toHaveAttribute('href', RECENT.href);
  });

  it('expanded (CONTROL, home arm): the Starred label is shown and announced', () => {
    state.context = 'home';
    state.favorites = [STARRED];
    const { container } = sidebarUi(true);
    expectShown(labelByText('Starred'));
    expect(labelsIn(container)).toHaveLength(1);
  });
});
