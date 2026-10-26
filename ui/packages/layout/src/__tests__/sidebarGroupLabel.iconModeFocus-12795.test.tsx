// @vitest-environment jsdom
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12795 — in the collapsed (icon-mode) sidebar a hidden group label
 * is no keyboard focus stop and is not in the accessibility tree. This file
 * covers the `@object-ui/layout` call sites: `NavigationRenderer`'s
 * collapsible group label and Favorites label, `AppSchemaRenderer`'s Area
 * label and `SidebarNav`'s group labels.
 *
 * The `SidebarGroupLabel` primitive hides a label there with `opacity-0` and
 * `-mt-8` only. A collapsible group's label is its disclosure button, so Tab
 * from the row above it landed on an invisible button and Enter toggled a
 * group the user could not see (measured in a browser; the readings are on the
 * pull request). Each call site now adds a variant-scoped `invisible`.
 *
 * Instrument: the real `SidebarProvider` / `Sidebar` / `SidebarGroupLabel`
 * and the real renderers, plus the REAL Tailwind compiler. The labels'
 * class tokens are compiled with `tailwindcss` and the stylesheet is injected,
 * so the DOM computes the label's `visibility` from the classes it actually
 * carries. user-event's Tab skips an element whose computed `visibility` is
 * `hidden`, and Testing Library's role queries drop it, so both pins read
 * behaviour rather than a class list. Only the labels' tokens are compiled:
 * compiling the whole tree would apply the primitive's `hidden md:block` with
 * no media query to lift it.
 *
 * jsdom rather than the default happy-dom: Tailwind emits its group variants
 * as `:is(:where(.group)[data-state="collapsed"] *)`, and happy-dom does not
 * match that selector, so it would compute every label as visible.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { isInaccessible } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { compile } from 'tailwindcss';
import type { AppComponentSchema, NavigationItem } from '@object-ui/types';
import { Sidebar, SidebarContent, SidebarProvider } from '@object-ui/components';
import { NavigationRenderer } from '../NavigationRenderer';
import { AppSchemaRenderer } from '../AppSchemaRenderer';
import { SidebarNav } from '../SidebarNav';

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

const labelsIn = (root: ParentNode) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-sidebar="group-label"]'));

/** Compiles every class token the rendered labels carry and injects the result. */
function applyLabelStyles(root: ParentNode) {
  const candidates = new Set<string>();
  for (const label of labelsIn(root)) {
    for (const t of label.className.split(/\s+/)) if (t) candidates.add(t);
  }
  const sheet = document.createElement('style');
  sheet.textContent = tailwind.build([...candidates]);
  document.head.appendChild(sheet);
  sheets.push(sheet);
}

const tokens = (el: Element) => el.className.split(/\s+/).filter(Boolean);

/** The variant prefix the primitive hides this label under, read off its `…:opacity-0` token. */
function hidingPrefix(label: Element): string {
  const hide = tokens(label).find((t) => t.endsWith(':opacity-0'));
  expect(hide, 'the primitive hides the label with a variant-scoped opacity-0').toBeDefined();
  return hide!.slice(0, -'opacity-0'.length);
}

/** Every label: in icon mode it computes hidden, under the primitive's own condition, and keeps the fade. */
function expectHiddenLabels(root: ParentNode, count: number) {
  const labels = labelsIn(root);
  expect(labels).toHaveLength(count);
  for (const label of labels) {
    const prefix = hidingPrefix(label);
    expect(tokens(label)).toContain(`${prefix}invisible`);
    expect(tokens(label)).toContain(`${prefix}transition-[margin,opacity,visibility]`);
    expect(getComputedStyle(label).visibility).toBe('hidden');
    expect(parseFloat(getComputedStyle(label).opacity)).toBe(0);
    expect(isInaccessible(label)).toBe(true);
  }
}

function expectShownLabels(root: ParentNode, count: number) {
  const labels = labelsIn(root);
  expect(labels).toHaveLength(count);
  for (const label of labels) {
    expect(getComputedStyle(label).visibility).not.toBe('hidden');
    expect(isInaccessible(label)).toBe(false);
  }
}

/** Tabs from `start` until focus leaves the sidebar; returns every element that took focus. */
async function tabWalk(user: ReturnType<typeof userEvent.setup>, start: HTMLElement, root: HTMLElement) {
  start.focus();
  const seen: HTMLElement[] = [start];
  for (let i = 0; i < 50; i++) {
    await user.tab();
    const el = document.activeElement as HTMLElement | null;
    if (!el || !root.contains(el) || el === start) break;
    seen.push(el);
  }
  return seen;
}

const name = (el: Element) => el.textContent?.trim();

// ---------------------------------------------------------------------------
// NavigationRenderer
// ---------------------------------------------------------------------------

const BASE = '/apps/crm';
const entry = (id: string, extra: Partial<NavigationItem> = {}): NavigationItem =>
  ({ id, type: 'object', objectName: id, label: id.toUpperCase(), ...extra }) as NavigationItem;

/** A top-level row, then two open collapsible groups. */
const ITEMS: NavigationItem[] = [
  entry('page_authoring'),
  { id: 'grp_sales', type: 'group', label: 'Sales', expanded: true, children: [entry('accounts'), entry('contacts')] } as NavigationItem,
  { id: 'grp_support', type: 'group', label: 'Support', expanded: true, children: [entry('cases')] } as NavigationItem,
];

function renderNavigation(open: boolean, items: NavigationItem[] = ITEMS, pinning = false) {
  const view = render(
    <MemoryRouter initialEntries={[BASE]}>
      <SidebarProvider defaultOpen={open}>
        <Sidebar collapsible="icon">
          <SidebarContent>
            <NavigationRenderer items={items} basePath={BASE} enablePinning={pinning} onPinToggle={() => {}} />
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    </MemoryRouter>,
  );
  applyLabelStyles(view.container);
  return view;
}

const sidebarOf = (container: HTMLElement) => container.querySelector('[data-sidebar="sidebar"]') as HTMLElement;

describe('NavigationRenderer — a hidden group label is no focus stop in icon mode (objectui#12795)', () => {
  it('collapsed to icons: Tab goes from a row straight to the next group\'s first row, and no label is focusable or announced', async () => {
    const user = userEvent.setup();
    const { container } = renderNavigation(false);
    const peer = container.querySelector('.group.peer[data-state]');
    expect(peer).toHaveAttribute('data-state', 'collapsed');
    expect(peer).toHaveAttribute('data-collapsible', 'icon');

    const walk = await tabWalk(user, screen.getByRole('link', { name: 'PAGE_AUTHORING' }), sidebarOf(container));
    expect(walk.map(name)).toEqual(['PAGE_AUTHORING', 'ACCOUNTS', 'CONTACTS', 'CASES']);
    expect(walk.filter((el) => el.closest('[data-sidebar="group-label"]'))).toEqual([]);
    expect(screen.queryByRole('button', { name: /Sales|Support/ })).not.toBeInTheDocument();

    expectHiddenLabels(container, 2);
  });

  it('collapsed to icons: the Favorites label is hidden and not announced', () => {
    const { container } = renderNavigation(
      false,
      [entry('page_authoring', { pinned: true } as Partial<NavigationItem>), ...ITEMS.slice(1)],
      true,
    );
    const favorites = screen.getByText('Favorites').closest('[data-sidebar="group-label"]') as HTMLElement;
    expect(favorites).toBeInTheDocument();
    expectHiddenLabels(container, 3);
  });

  it('expanded (CONTROL): each group label is still a focus stop after the row above it, and Enter still toggles its group', async () => {
    const user = userEvent.setup();
    const { container } = renderNavigation(true);
    expect(container.querySelector('.group.peer[data-state]')).toHaveAttribute('data-state', 'expanded');
    expectShownLabels(container, 2);

    const walk = await tabWalk(user, screen.getByRole('link', { name: 'PAGE_AUTHORING' }), sidebarOf(container));
    expect(walk.map(name)).toEqual(['PAGE_AUTHORING', 'Sales', 'ACCOUNTS', 'CONTACTS', 'Support', 'CASES']);

    const sales = screen.getByRole('button', { name: 'Sales' });
    sales.focus();
    expect(sales).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Enter}');
    expect(sales).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'ACCOUNTS' })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(sales).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'ACCOUNTS' })).toBeInTheDocument();
  });

  it('expanded (CONTROL): the Favorites label is shown and announced', () => {
    const { container } = renderNavigation(
      true,
      [entry('page_authoring', { pinned: true } as Partial<NavigationItem>), ...ITEMS.slice(1)],
      true,
    );
    expectShownLabels(container, 3);
  });
});

// ---------------------------------------------------------------------------
// AppSchemaRenderer — its Area label sits in the same icon sidebar
// ---------------------------------------------------------------------------

const APP: AppComponentSchema = {
  type: 'app',
  name: 'crm',
  title: 'Sales CRM',
  areas: [
    { id: 'area_sales', label: 'Sales area', icon: 'Briefcase', navigation: [entry('opportunities')] },
    { id: 'area_service', label: 'Service area', icon: 'Headphones', navigation: [entry('tickets')] },
  ],
};

function renderApp(open: boolean) {
  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <AppSchemaRenderer schema={APP} basePath={BASE} defaultOpen={open}>
        <div>Page</div>
      </AppSchemaRenderer>
    </MemoryRouter>,
  );
  applyLabelStyles(view.container);
  return view;
}

const areaLabel = (container: HTMLElement) =>
  within(container).getByText('Area').closest('[data-sidebar="group-label"]') as HTMLElement;

describe('AppSchemaRenderer — the hidden Area label is not announced in icon mode (objectui#12795)', () => {
  it('collapsed to icons: the Area label is hidden and not announced; Tab goes from one area row to the next', async () => {
    const user = userEvent.setup();
    const { container } = renderApp(false);
    expect(container.querySelector('.group.peer[data-state]')).toHaveAttribute('data-state', 'collapsed');
    expect(areaLabel(container)).toBeInTheDocument();
    expectHiddenLabels(container, 1);

    const first = screen.getByRole('button', { name: 'Sales area' });
    first.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Service area' }));
  });

  it('expanded (CONTROL): the Area label is shown and announced', () => {
    const { container } = renderApp(true);
    expect(areaLabel(container)).toBeInTheDocument();
    expectShownLabels(container, 1);
  });
});

// ---------------------------------------------------------------------------
// SidebarNav — collapsible="icon" by default
// ---------------------------------------------------------------------------

const NAV = [
  { label: 'Main', items: [{ title: 'Home', href: '/home' }, { title: 'Inbox', href: '/inbox' }] },
  { label: 'Admin', items: [{ title: 'Users', href: '/users' }] },
];

function renderSidebarNav(open: boolean) {
  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <SidebarProvider defaultOpen={open}>
        <SidebarNav items={NAV} />
      </SidebarProvider>
    </MemoryRouter>,
  );
  applyLabelStyles(view.container);
  return view;
}

describe('SidebarNav — a hidden group label is not announced in icon mode (objectui#12795)', () => {
  it('collapsed to icons: both group labels are hidden and not announced; Tab goes from a group\'s last row to the next group\'s first', async () => {
    const user = userEvent.setup();
    const { container } = renderSidebarNav(false);
    expect(container.querySelector('.group.peer[data-state]')).toHaveAttribute('data-collapsible', 'icon');
    expectHiddenLabels(container, 2);

    const walk = await tabWalk(user, screen.getByRole('link', { name: 'Inbox' }), sidebarOf(container));
    expect(walk.map(name)).toEqual(['Inbox', 'Users']);
  });

  it('expanded (CONTROL): both group labels are shown and announced', () => {
    const { container } = renderSidebarNav(true);
    expectShownLabels(container, 2);
  });
});
