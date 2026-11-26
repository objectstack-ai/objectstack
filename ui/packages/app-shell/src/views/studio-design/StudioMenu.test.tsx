// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36899 — Studio's left menu as the author meets it.
 *
 *  1. Collapsing it is kept across a reload under Studio's own cookie
 *     (`studio_menu_state`); the app sidebar's (`sidebar_state`) is not
 *     touched, so collapsing one never collapses the other.
 *  2. Below 768 px it is a drawer: closed until the toggle opens it, and
 *     choosing an entry closes it.
 *  3. The open page's entry is the current page (`aria-current`); every other
 *     entry is not.
 *  4. The search narrows the entries by name, and says so when none match.
 *  5. Focus order: the toggle, then the search, then the entries.
 *
 * objectstack#37201 — the two tiers (ADR-0084, amended 2026-11-25):
 *  6. Group labels carry no count and no link; an entry's muted number is
 *     its items; an empty 常用 type is dimmed, numberless, a link.
 *  7. The 「高级」 fold: closed by default, remembered under
 *     `studio_menu_advanced`, open by itself on one of its pages without
 *     writing the cookie, ignored by the search, a button with
 *     `aria-expanded` / `aria-controls`.
 *  8. The 常用 types are listed on a package that holds none of them.
 *  9. `~org` and `~all` draw no fold.
 *
 * objectstack#37360 — 全部类型 All types (ADR-0084, amended 2026-11-25):
 * 10. The fold's last row, below its groups and under no group's label; it
 *     opens the area's type directory and is current there. CONTROL: a 高级
 *     type the package holds none of is still not in the fold.
 *
 * objectstack#37452 — drawn as the app's menu:
 * 11. A group is the app menu's collapsible group: its label is a disclosure
 *     button, open by default; closing it hides its entries; a search opens
 *     every group it lists, chevron included, and holds it open; in the phone
 *     drawer the label is the app menu's 44 px tap target.
 * 12. An entry draws a bare line icon before its name; the current entry is
 *     the primitive's active row (the pill and left bar).
 * 13. The selected entry is tinted by Studio's graphite accent whatever the
 *     app's theme colours are: every theme token the app's branding writes
 *     (primary and accent) is rebound over it.
 *
 * The provider, the sidebar primitive and the router are real; only the
 * metadata reads are doubled.
 */

import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/** What the doubled reads answer; each test may change it before rendering. */
const reads = vi.hoisted(() => ({
  entries: [] as Array<{ type: string; domain: string }>,
  sweep: {} as { loading?: boolean; error?: string | null; countsByType: Record<string, number>; packagesByType: Record<string, string[]> },
}));

const SERVED = [
  { type: 'hook', domain: 'data' },
  { type: 'object', domain: 'data' },
  { type: 'app', domain: 'ui' },
  { type: 'page', domain: 'ui' },
  { type: 'flow', domain: 'automation' },
  { type: 'permission', domain: 'security' },
  { type: 'position', domain: 'security' },
];

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => ({}),
    useMetadataTypes: () => ({ loading: false, error: null, entries: reads.entries }),
    useGlobalDiagnostics: () => ({ loading: false, error: null, ...reads.sweep, reload: () => {} }),
  };
});

import { useAppShellBranding } from '@object-ui/layout';
import { StudioMenu, StudioMenuProvider, StudioMenuTrigger } from './StudioMenu';
import { STUDIO_MENU_ADVANCED_COOKIE, STUDIO_MENU_COOKIE } from './studioMenuModel';
import { STUDIO_ACCENT, STUDIO_ACCENT_HSL } from './studio-tokens';

const PKG = 'com.acme.app';

function clearCookies() {
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

const cookie = (name: string) =>
  document.cookie
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1];

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: px });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: px < 768,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
}

function Shell({ segment }: { segment: string }) {
  return (
    <StudioMenuProvider>
      <header>
        <StudioMenuTrigger locale="en" />
      </header>
      <StudioMenu segment={segment} locale="en" />
    </StudioMenuProvider>
  );
}

function renderAt(path: string, segment = PKG) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<Shell segment={segment} />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const toggle = () => screen.getByTestId('studio-menu-toggle');
const fold = () => screen.getByTestId('studio-menu-advanced-toggle');
const foldRegion = () => screen.getByTestId('studio-menu-advanced');
const entry = (key: string) => screen.getByTestId(`studio-menu-entry-${key}`);
/** The docked menu's open state, as the sidebar primitive draws it. */
const docked = () => document.querySelector('[data-side="left"][data-state]')?.getAttribute('data-state');

beforeEach(() => {
  clearCookies();
  setWidth(1280);
  reads.entries = SERVED;
  // The package holds objects, flows, permission sets and hooks; no app, page or position.
  reads.sweep = {
    countsByType: { object: 3, flow: 2, permission: 1, hook: 27 },
    packagesByType: { object: [PKG], flow: [PKG], permission: [PKG], hook: [PKG] },
  };
});

afterEach(() => {
  cleanup();
  clearCookies();
  vi.unstubAllGlobals();
});

describe('the menu collapses and keeps it across a reload, under its own cookie', () => {
  it('collapsing writes studio_menu_state, leaves sidebar_state alone, and a remount comes back collapsed', () => {
    document.cookie = 'sidebar_state=true; path=/';
    const first = renderAt(`/studio/${PKG}/data`);
    expect(docked()).toBe('expanded');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle());
    expect(docked()).toBe('collapsed');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(cookie(STUDIO_MENU_COOKIE)).toBe('false');
    expect(cookie('sidebar_state')).toBe('true');

    first.unmount();
    renderAt(`/studio/${PKG}/data`);
    expect(docked()).toBe('collapsed');
  });

  it('CONTROL: the app sidebar collapsed does not collapse the menu', () => {
    document.cookie = 'sidebar_state=false; path=/';
    renderAt(`/studio/${PKG}/data`);
    expect(docked()).toBe('expanded');
  });
});

describe('below 768 px the menu is a drawer', () => {
  it('closed until the toggle opens it; choosing an entry closes it', async () => {
    setWidth(390);
    renderAt(`/studio/${PKG}/data`);
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.queryByTestId('studio-menu')).toBeNull();

    fireEvent.click(toggle());
    const drawer = await screen.findByRole('dialog');
    fireEvent.click(within(drawer).getByTestId('studio-menu-entry-type:flow'));
    expect(screen.getByTestId('where')).toHaveTextContent(`/studio/${PKG}/metadata/flow?package=${PKG}`);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('the current entry and the search', () => {
  it('the open page\'s entry is the current page, and only it', () => {
    renderAt(`/studio/${PKG}/metadata/flow?package=${PKG}`);
    expect(entry('type:flow')).toHaveAttribute('aria-current', 'page');
    const others = within(screen.getByTestId('studio-menu'))
      .getAllByRole('link')
      .filter((a) => a !== entry('type:flow'));
    expect(others.length).toBeGreaterThan(0);
    for (const a of others) expect(a).not.toHaveAttribute('aria-current');
  });

  // objectstack#37201 — the group's type count is gone; a number is an entry's items.
  it('draws no count on a group label and a muted item count on an entry', () => {
    renderAt(`/studio/${PKG}/data`);
    expect(screen.queryByTestId('studio-menu-group-count-data')).toBeNull();
    expect(entry('type:object')).toHaveTextContent(/3$/);
    expect(screen.getByTestId('studio-menu-count-type:object')).toHaveClass('text-muted-foreground');
    expect(screen.getByTestId('studio-menu-count-type:object')).toHaveAttribute('title', '3 items');
  });

  it('narrows the entries by name, and says so when none match', () => {
    renderAt(`/studio/${PKG}/data`);
    const search = screen.getByTestId('studio-menu-search');
    expect(search).toHaveAccessibleName('Search the menu');

    fireEvent.change(search, { target: { value: 'flow' } });
    const links = within(screen.getByTestId('studio-menu')).getAllByRole('link');
    // "flow" names the flow type and the organization's flows (a 高级 entry: the search ignores the fold).
    expect(links.map((a) => a.getAttribute('data-testid'))).toEqual(['studio-menu-entry-type:flow', 'studio-menu-entry-orgFlows']);

    fireEvent.change(search, { target: { value: 'zzz-nothing' } });
    expect(within(screen.getByTestId('studio-menu')).queryAllByRole('link')).toEqual([]);
    expect(screen.getByTestId('studio-menu-no-matches')).toHaveAttribute('role', 'status');
  });

  it('focus order: the toggle, then the search, then the 常用 entries, the 高级 button, and its entries', () => {
    renderAt(`/studio/${PKG}/data`);
    fireEvent.click(fold());
    const order = [toggle(), screen.getByTestId('studio-menu-search'), entry('type:object'), entry('type:permission'), fold(), entry('type:hook')];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    for (const el of order) expect(el.getAttribute('tabindex') ?? '0').not.toBe('-1');
    expect(screen.getByRole('navigation', { name: 'Studio menu' })).toBe(screen.getByTestId('studio-menu'));
  });
});

describe('the group labels (objectstack#37201)', () => {
  it('carry no count and no link: the label is the group\'s name', () => {
    renderAt(`/studio/${PKG}/data`);
    const group = screen.getByTestId('studio-menu-group-data');
    const label = group.querySelector('[data-sidebar="group-label"]')!;
    expect(label).toHaveTextContent(/^Data$/);
    expect(label.querySelector('a')).toBeNull();
    expect(label.closest('a')).toBeNull();
  });

  it('a group is labelled in a tier only where it holds an entry of that tier', () => {
    renderAt(`/studio/${PKG}/data`);
    const menu = screen.getByTestId('studio-menu');
    // 常用: data, ui, automation, security. 平台 Platform holds only 高级 entries; AI is not served here.
    expect([...menu.querySelectorAll('[data-testid^="studio-menu-group-"]')].map((g) => g.getAttribute('data-testid'))).toEqual([
      'studio-menu-group-data',
      'studio-menu-group-ui',
      'studio-menu-group-automation',
      'studio-menu-group-security',
    ]);
    expect([...foldRegion().querySelectorAll('[data-testid^="studio-menu-advanced-group-"]')].map((g) => g.getAttribute('data-testid'))).toEqual([
      'studio-menu-advanced-group-data',
      'studio-menu-advanced-group-automation',
      'studio-menu-advanced-group-system',
      'studio-menu-advanced-group-security',
    ]);
    // Inside the closed fold: out of the accessibility tree until it opens.
    expect(within(screen.getByTestId('studio-menu-advanced-group-security')).getAllByRole('link', { hidden: true }).map((a) => a.getAttribute('data-testid'))).toEqual([
      'studio-menu-entry-owd',
      'studio-menu-entry-environment',
    ]);
  });
});

describe('an empty 常用 type (objectstack#37201)', () => {
  it('the package holds none: dimmed, no number, still a link to its list', () => {
    renderAt(`/studio/${PKG}/data`);
    const app = entry('type:app');
    expect(app).toHaveAttribute('data-empty', 'true');
    expect(app).toHaveAttribute('href', `/studio/${PKG}/metadata/app?package=${PKG}`);
    expect(app).toHaveAttribute('title', 'None yet: open the list to make the first');
    expect(app.querySelector('span')).toHaveClass('text-muted-foreground');
    expect(screen.queryByTestId('studio-menu-count-type:app')).toBeNull();
    expect(app).toHaveTextContent(/^App/);
    expect(app).not.toHaveTextContent(/\d/);
    // One it holds is neither dimmed nor numberless.
    expect(entry('type:object')).not.toHaveAttribute('data-empty');
    expect(entry('type:object').querySelector('span')).not.toHaveClass('text-muted-foreground');
  });

  it('a sweep that counts 0 of it: still no number, never "0"', () => {
    reads.sweep = { ...reads.sweep, countsByType: { ...reads.sweep.countsByType, app: 0 } };
    renderAt(`/studio/${PKG}/data`);
    expect(entry('type:app')).toHaveAttribute('data-empty', 'true');
    expect(screen.queryByTestId('studio-menu-count-type:app')).toBeNull();
    expect(entry('type:app')).not.toHaveTextContent('0');
  });

  it('while the sweep has not answered, nothing is empty', () => {
    reads.sweep = { loading: true, countsByType: {}, packagesByType: {} };
    renderAt(`/studio/${PKG}/data`);
    expect(entry('type:app')).not.toHaveAttribute('data-empty');
    expect(entry('type:object')).not.toHaveAttribute('data-empty');
  });

  it('a sweep that failed answered nothing: nothing is empty', () => {
    reads.sweep = { error: 'not found', countsByType: {}, packagesByType: {} };
    renderAt(`/studio/${PKG}/data`);
    expect(entry('type:app')).not.toHaveAttribute('data-empty');
  });
});

describe('a package that holds nothing yet (objectstack#37201)', () => {
  it('lists every served 常用 type, holding one or not; a 高级 type only when held', () => {
    reads.entries = [
      ...SERVED,
      { type: 'dashboard', domain: 'ui' },
      { type: 'report', domain: 'ui' },
      { type: 'agent', domain: 'ai' },
      { type: 'tool', domain: 'ai' },
      { type: 'skill', domain: 'ai' },
    ];
    reads.sweep = { countsByType: {}, packagesByType: {} };
    renderAt(`/studio/${PKG}/data`);
    const links = (root: HTMLElement) => within(root).queryAllByRole('link').map((a) => a.getAttribute('data-testid')!.replace('studio-menu-entry-', ''));
    const common = links(screen.getByTestId('studio-menu')).filter((k) => !links(foldRegion()).includes(k));
    expect(common).toEqual([
      'type:object',
      'type:app',
      'type:page',
      'type:dashboard',
      'type:report',
      'type:flow',
      'type:permission',
      'type:agent',
      'type:tool',
      'type:skill',
    ]);
    for (const k of common) expect(entry(k)).toHaveAttribute('data-empty', 'true');
    expect(screen.queryByTestId('studio-menu-entry-type:hook')).toBeNull();
    expect(screen.queryByTestId('studio-menu-entry-type:position')).toBeNull();
  });
});

describe('the 「高级」 fold (objectstack#37201)', () => {
  it('closed by default: a button that names the region it controls, which is hidden', () => {
    renderAt(`/studio/${PKG}/data`);
    expect(fold().tagName).toBe('BUTTON');
    expect(fold()).toHaveAccessibleName('Advanced');
    expect(fold()).toHaveAttribute('aria-expanded', 'false');
    expect(fold().getAttribute('aria-controls')).toBe(foldRegion().id);
    expect(foldRegion().id).not.toBe('');
    expect(foldRegion()).not.toBeVisible();
    expect(entry('type:hook')).not.toBeVisible();
    expect(entry('type:object')).toBeVisible();
  });

  it('a click opens it and remembers it under studio_menu_advanced, apart from the collapse cookie; a remount keeps it', () => {
    const first = renderAt(`/studio/${PKG}/data`);
    fireEvent.click(fold());
    expect(fold()).toHaveAttribute('aria-expanded', 'true');
    expect(foldRegion()).toBeVisible();
    expect(entry('type:hook')).toBeVisible();
    expect(cookie(STUDIO_MENU_ADVANCED_COOKIE)).toBe('true');
    expect(cookie(STUDIO_MENU_COOKIE)).toBeUndefined();

    first.unmount();
    const second = renderAt(`/studio/${PKG}/data`);
    expect(fold()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(fold());
    expect(fold()).toHaveAttribute('aria-expanded', 'false');
    expect(cookie(STUDIO_MENU_ADVANCED_COOKIE)).toBe('false');
    second.unmount();
    renderAt(`/studio/${PKG}/data`);
    expect(fold()).toHaveAttribute('aria-expanded', 'false');
  });

  it('a bookmark to the hook list opens it by itself, marks the hook entry current, and writes no cookie', () => {
    renderAt(`/studio/${PKG}/metadata/hook?package=${PKG}`);
    expect(fold()).toHaveAttribute('aria-expanded', 'true');
    expect(entry('type:hook')).toBeVisible();
    expect(entry('type:hook')).toHaveAttribute('aria-current', 'page');
    expect(cookie(STUDIO_MENU_ADVANCED_COOKIE)).toBeUndefined();
  });

  it('CONTROL: on a 常用 page it stays closed', () => {
    renderAt(`/studio/${PKG}/metadata/object?package=${PKG}`);
    expect(fold()).toHaveAttribute('aria-expanded', 'false');
  });

  it('the author can still close it on a 高级 page', () => {
    renderAt(`/studio/${PKG}/owd`);
    expect(fold()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(fold());
    expect(fold()).toHaveAttribute('aria-expanded', 'false');
    expect(cookie(STUDIO_MENU_ADVANCED_COOKIE)).toBe('false');
  });

  it('the search ignores it: a 高级 entry matches while the fold is closed, and no fold is drawn', () => {
    renderAt(`/studio/${PKG}/data`);
    fireEvent.change(screen.getByTestId('studio-menu-search'), { target: { value: 'hook' } });
    expect(entry('type:hook')).toBeVisible();
    expect(screen.queryByTestId('studio-menu-advanced-toggle')).toBeNull();
    fireEvent.change(screen.getByTestId('studio-menu-search'), { target: { value: '' } });
    expect(fold()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('~org and ~all draw no fold (objectstack#37201)', () => {
  it.each([
    ['~org', '/studio/~org/metadata/flow?source=runtime'],
    ['~all', '/studio/~all/metadata'],
  ])('%s: its entries flat, in the table\'s order, under their groups\' labels', (segment, path) => {
    renderAt(path, segment);
    expect(screen.queryByTestId('studio-menu-advanced-toggle')).toBeNull();
    expect(screen.queryByTestId('studio-menu-advanced')).toBeNull();
    const security = screen.getByTestId('studio-menu-group-security');
    expect(within(security).getAllByRole('link').map((a) => a.getAttribute('data-testid'))).toEqual([
      'studio-menu-entry-type:permission',
      'studio-menu-entry-type:position',
      'studio-menu-entry-environment',
    ]);
    for (const a of within(security).getAllByRole('link')) expect(a).toBeVisible();
    expect(security.querySelector('[data-sidebar="group-label"]')).toHaveTextContent(/^Access$/);
    expect(screen.getByTestId('studio-menu-entry-orgFlows')).toBeVisible();
    // objectstack#37211 — no count above Organization flows (it read "0 types" over the group's one entry).
    const automation = screen.getByTestId('studio-menu-group-automation');
    expect(automation.querySelector('[data-sidebar="group-label"]')).toHaveTextContent(/^Automation$/);
    expect(screen.queryByTestId('studio-menu-group-count-automation')).toBeNull();
    expect(within(automation).getAllByRole('link').map((a) => a.getAttribute('data-testid'))).toEqual(['studio-menu-entry-orgFlows']);
  });
});

describe('全部类型 All types (objectstack#37360, ADR-0084 amended 2026-11-25)', () => {
  it('is the fold\'s last row, below its groups and under no group\'s label, and opens the type directory', () => {
    renderAt(`/studio/${PKG}/data`);
    fireEvent.click(fold());
    const row = entry('allTypes');
    expect(row).toBeVisible();
    expect(row).toHaveTextContent(/^All types$/);
    expect(row).toHaveAttribute('href', `/studio/${PKG}/metadata`);
    // Last: no link of the fold comes after it, and every group of the fold comes before it.
    const links = within(foldRegion()).getAllByRole('link');
    expect(links[links.length - 1]).toBe(row);
    const groups = [...foldRegion().querySelectorAll('[data-testid^="studio-menu-advanced-group-"]')];
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect(g.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Under no group: no group holds it, and no group label sits over it.
    expect(row.closest('[data-testid^="studio-menu-advanced-group-"], [data-testid^="studio-menu-group-"]')).toBeNull();
    expect(row.closest('[data-sidebar="group"]')).toBeNull();
    expect(screen.getByTestId('studio-menu-all-types').querySelector('[data-sidebar="group-label"]')).toBeNull();
  });

  it('on the type directory it is the current page, and the fold opens by itself without writing its cookie', () => {
    renderAt(`/studio/${PKG}/metadata`);
    expect(fold()).toHaveAttribute('aria-expanded', 'true');
    expect(entry('allTypes')).toHaveAttribute('aria-current', 'page');
    expect(cookie(STUDIO_MENU_ADVANCED_COOKIE)).toBeUndefined();
  });

  it('a search lists it last when its name matches, and not otherwise', () => {
    renderAt(`/studio/${PKG}/data`);
    const search = screen.getByTestId('studio-menu-search');
    fireEvent.change(search, { target: { value: 'all types' } });
    expect(within(screen.getByTestId('studio-menu')).getAllByRole('link').map((a) => a.getAttribute('data-testid'))).toEqual([
      'studio-menu-entry-allTypes',
    ]);
    expect(screen.queryByTestId('studio-menu-no-matches')).toBeNull();
    fireEvent.change(search, { target: { value: 'flow' } });
    expect(screen.queryByTestId('studio-menu-entry-allTypes')).toBeNull();
  });

  it('CONTROL: the fold still leaves out a 高级 type the package holds none of', () => {
    reads.entries = [...SERVED, { type: 'email_template', domain: 'system' }];
    renderAt(`/studio/${PKG}/data`);
    fireEvent.click(fold());
    expect(entry('allTypes')).toBeVisible();
    expect(entry('type:hook')).toBeVisible();
    expect(screen.queryByTestId('studio-menu-entry-type:email_template')).toBeNull();
    expect(screen.queryByTestId('studio-menu-entry-type:position')).toBeNull();
  });

  it.each([
    ['~org', '/studio/~org/metadata/flow?source=runtime'],
    ['~all', '/studio/~all/metadata'],
  ])('%s draws no fold and no 全部类型 row', (segment, path) => {
    renderAt(path, segment);
    expect(screen.queryByTestId('studio-menu-entry-allTypes')).toBeNull();
    expect(screen.queryByTestId('studio-menu-all-types')).toBeNull();
  });
});

describe('drawn as the app\'s menu (objectstack#37452)', () => {
  const groupLabel = (testId: string) =>
    screen.getByTestId(testId).querySelector<HTMLElement>('[data-sidebar="group-label"]')!;

  it('a group\'s label is the app menu\'s disclosure button: open by default, closing it hides its entries', () => {
    renderAt(`/studio/${PKG}/data`);
    const label = groupLabel('studio-menu-group-data');
    expect(label.tagName).toBe('BUTTON');
    expect(label).toHaveAccessibleName('Data');
    expect(label).toHaveAttribute('aria-expanded', 'true');
    // The group's list is named by its label.
    expect(entry('type:object').closest('ul')).toHaveAttribute('aria-labelledby', label.id);
    expect(entry('type:object')).toBeVisible();

    fireEvent.click(label);
    expect(label).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('studio-menu-entry-type:object')).toBeNull();
    // CONTROL: the other groups stay open.
    expect(entry('type:flow')).toBeVisible();
    // No count is drawn on a closed group: a number in this menu is an entry's items.
    expect(label).toHaveTextContent(/^Data$/);

    fireEvent.click(label);
    expect(entry('type:object')).toBeVisible();
  });

  // On ~all the groups are drawn flat with and without a search, so the
  // group the author closed is the same group the search lists into.
  it('a search lists its matches in a group the author closed', () => {
    renderAt('/studio/~all/metadata', '~all');
    const label = groupLabel('studio-menu-group-security');
    fireEvent.click(label);
    expect(label).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('studio-menu-entry-type:position')).toBeNull();
    fireEvent.change(screen.getByTestId('studio-menu-search'), { target: { value: 'position' } });
    expect(entry('type:position')).toBeVisible();
    expect(groupLabel('studio-menu-group-security')).toHaveAttribute('aria-expanded', 'true');
    // Drawn open, chevron included: the chevron is turned down as on any open group.
    const chevron = () => groupLabel('studio-menu-group-security').querySelector('svg')!;
    expect(chevron()).toHaveClass('rotate-90');
    // A click while the search holds it open changes nothing.
    fireEvent.click(groupLabel('studio-menu-group-security'));
    expect(groupLabel('studio-menu-group-security')).toHaveAttribute('aria-expanded', 'true');
    expect(chevron()).toHaveClass('rotate-90');
    expect(entry('type:position')).toBeVisible();
    // The author's choice is kept: clearing the search closes it again.
    fireEvent.change(screen.getByTestId('studio-menu-search'), { target: { value: '' } });
    expect(screen.queryByTestId('studio-menu-entry-type:position')).toBeNull();
    expect(chevron()).not.toHaveClass('rotate-90');
  });

  it('a click on an open group\'s label during a search is not taken: the group is still open once the search is cleared', () => {
    renderAt('/studio/~all/metadata', '~all');
    fireEvent.change(screen.getByTestId('studio-menu-search'), { target: { value: 'position' } });
    fireEvent.click(groupLabel('studio-menu-group-security'));
    expect(groupLabel('studio-menu-group-security')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(screen.getByTestId('studio-menu-search'), { target: { value: '' } });
    expect(groupLabel('studio-menu-group-security')).toHaveAttribute('aria-expanded', 'true');
    expect(entry('type:position')).toBeVisible();
  });

  it('in the phone drawer a group\'s label is the app menu\'s 44 px tap target; CONTROL: docked it is not', async () => {
    setWidth(390);
    renderAt(`/studio/${PKG}/data`);
    fireEvent.click(toggle());
    const drawer = await screen.findByRole('dialog');
    const label = within(drawer).getByTestId('studio-menu-group-data').querySelector('[data-sidebar="group-label"]')!;
    expect(label).toHaveClass('min-h-[44px]');
    cleanup();
    setWidth(1280);
    renderAt(`/studio/${PKG}/data`);
    expect(groupLabel('studio-menu-group-data')).not.toHaveClass('min-h-[44px]');
  });

  it('an entry draws a bare line icon before its name, on the app menu\'s row', () => {
    renderAt(`/studio/${PKG}/data`);
    for (const key of ['type:object', 'type:flow', 'type:permission']) {
      const icon = screen.getByTestId(`studio-menu-icon-${key}`);
      expect(icon.tagName.toLowerCase()).toBe('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      // No tile: the icon is the row's own child, the first one.
      expect(icon.parentElement).toBe(entry(key));
      expect(entry(key).firstElementChild).toBe(icon);
      expect(entry(key)).toHaveAttribute('data-sidebar', 'menu-button');
    }
    // A type and an entry that is not one each draw an icon, the fold's too.
    fireEvent.click(fold());
    expect(screen.getByTestId('studio-menu-icon-type:hook').tagName.toLowerCase()).toBe('svg');
    expect(screen.getByTestId('studio-menu-icon-owd').tagName.toLowerCase()).toBe('svg');
  });

  it('the current entry is the primitive\'s active row (the pill and its left bar), and only it', () => {
    renderAt(`/studio/${PKG}/metadata/flow?package=${PKG}`);
    expect(entry('type:flow')).toHaveAttribute('data-active', 'true');
    expect(entry('type:object')).toHaveAttribute('data-active', 'false');
    // Its count is not muted: it reads with the selected name.
    expect(screen.getByTestId('studio-menu-count-type:flow')).not.toHaveClass('text-muted-foreground');
  });

  describe('the selected entry is tinted by Studio\'s graphite whatever the app\'s theme colour is', () => {
    const ROOT_TOKENS = ['--primary', '--primary-foreground', '--ring', '--sidebar-primary', '--sidebar-ring', '--accent', '--accent-foreground'];

    function Branded({ children }: { children: ReactNode }) {
      // A non-default app theme: a rose primary and an amber accent, written on the page root by the app shell's own hook.
      useAppShellBranding({ primaryColor: '#e11d48', accentColor: '#f59e0b' });
      return <>{children}</>;
    }

    afterEach(() => {
      for (const token of ROOT_TOKENS) document.documentElement.style.removeProperty(token);
      for (const token of ['--brand-primary', '--brand-primary-hsl', '--brand-accent', '--brand-accent-hsl']) document.documentElement.style.removeProperty(token);
    });

    /** The declarations a class string makes: `[--x:a_b]` and `dark:[--x:a_b]`, underscores read as spaces. */
    function declarations(classes: string, dark: boolean): Map<string, string> {
      const out = new Map<string, string>();
      for (const cls of classes.split(/\s+/)) {
        const m = /^(dark:)?\[(--[\w-]+):(.+)\]$/.exec(cls);
        if (m && !!m[1] === dark) out.set(m[2], m[3].replace(/_/g, ' '));
      }
      return out;
    }

    it('every theme token the app\'s branding writes on the page root is rebound to graphite over the selected entry, light and dark', () => {
      render(
        <MemoryRouter initialEntries={[`/studio/${PKG}/metadata/flow?package=${PKG}`]}>
          <Branded>
            <Routes>
              <Route path="*" element={<Shell segment={PKG} />} />
            </Routes>
          </Branded>
        </MemoryRouter>,
      );
      // CONTROL: the app's theme is not the default — its colour is on the page root.
      const root = document.documentElement.style;
      const written = [...Array.from({ length: root.length }, (_, i) => root.item(i))].filter(
        // `--brand-*` are the hook's hex aliases; no sidebar or menu class reads them.
        (token) => token.startsWith('--') && !token.startsWith('--brand-'),
      );
      expect(written).toContain('--primary');
      expect(written).toContain('--accent');
      expect(root.getPropertyValue('--primary').trim()).not.toBe(STUDIO_ACCENT_HSL.light);

      // The selected entry is the active row, and it sits inside Studio's accent scope.
      const selected = entry('type:flow');
      expect(selected).toHaveAttribute('data-active', 'true');
      const scope = selected.closest<HTMLElement>('[data-studio-accent]');
      expect(scope).not.toBeNull();
      for (const cls of STUDIO_ACCENT.split(/\s+/)) expect(scope).toHaveClass(cls);
      // Nothing between the scope and the entry writes a theme token back.
      for (let el: HTMLElement | null = selected; el && el !== scope; el = el.parentElement) {
        for (const token of written) expect(el.style.getPropertyValue(token), `${token} on ${el.tagName}`).toBe('');
      }

      const light = declarations(STUDIO_ACCENT, false);
      const dark = declarations(STUDIO_ACCENT, true);
      for (const token of written) {
        expect(light.has(token), `${token} rebound in the light theme`).toBe(true);
        expect(dark.has(token), `${token} rebound in the dark theme`).toBe(true);
      }
      expect(light.get('--primary')).toBe(STUDIO_ACCENT_HSL.light);
      expect(dark.get('--primary')).toBe(STUDIO_ACCENT_HSL.dark);
    });
  });
});
