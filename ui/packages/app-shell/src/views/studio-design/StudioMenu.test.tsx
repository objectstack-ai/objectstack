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
 * The provider, the sidebar primitive and the router are real; only the
 * metadata reads are doubled.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => ({}),
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        { type: 'object', domain: 'data' },
        { type: 'flow', domain: 'automation' },
        { type: 'permission', domain: 'security' },
      ],
    }),
    useGlobalDiagnostics: () => ({ countsByType: { object: 3 }, packagesByType: {}, reload: () => {} }),
  };
});

import { StudioMenu, StudioMenuProvider, StudioMenuTrigger } from './StudioMenu';
import { STUDIO_MENU_COOKIE } from './studioMenuModel';

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

function Shell() {
  return (
    <StudioMenuProvider>
      <header>
        <StudioMenuTrigger locale="en" />
      </header>
      <StudioMenu segment={PKG} locale="en" />
    </StudioMenuProvider>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<Shell />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const toggle = () => screen.getByTestId('studio-menu-toggle');
const entry = (key: string) => screen.getByTestId(`studio-menu-entry-${key}`);
/** The docked menu's open state, as the sidebar primitive draws it. */
const docked = () => document.querySelector('[data-side="left"][data-state]')?.getAttribute('data-state');

beforeEach(() => {
  clearCookies();
  setWidth(1280);
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

  it('draws each group\'s type count and an entry\'s item count', () => {
    renderAt(`/studio/${PKG}/data`);
    expect(screen.getByTestId('studio-menu-group-count-data')).toHaveTextContent('1');
    expect(entry('type:object')).toHaveTextContent(/3$/);
  });

  it('narrows the entries by name, and says so when none match', () => {
    renderAt(`/studio/${PKG}/data`);
    const search = screen.getByTestId('studio-menu-search');
    expect(search).toHaveAccessibleName('Search the menu');

    fireEvent.change(search, { target: { value: 'flow' } });
    const links = within(screen.getByTestId('studio-menu')).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('data-testid'))).toEqual(['studio-menu-entry-type:flow']);

    fireEvent.change(search, { target: { value: 'zzz-nothing' } });
    expect(within(screen.getByTestId('studio-menu')).queryAllByRole('link')).toEqual([]);
    expect(screen.getByTestId('studio-menu-no-matches')).toHaveAttribute('role', 'status');
  });

  it('focus order: the toggle, then the search, then the entries', () => {
    renderAt(`/studio/${PKG}/data`);
    const order = [toggle(), screen.getByTestId('studio-menu-search'), entry('type:object')];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    for (const el of order) expect(el.getAttribute('tabindex') ?? '0').not.toBe('-1');
    expect(screen.getByRole('navigation', { name: 'Studio menu' })).toBe(screen.getByTestId('studio-menu'));
  });
});
