/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every ⌘K palette command closes the palette (objectui#12683).
 *
 * `runCommand` closes the palette, then runs the command. It was memoised with
 * an empty dependency list, so it kept the `setOpen` of the palette's first
 * render, and that `setOpen` closes over the URL of that render. Two faces,
 * both measured in a browser on `main` before the fix:
 *
 *  - Opened after the page loaded (the header button, ⌘K), the first render's
 *    URL had no `?palette=1`, so the stale `setOpen(false)` thought the palette
 *    was already closed and did nothing: Dark / Light Theme applied the theme
 *    and left the palette open. A navigating command only seemed to close it,
 *    because the navigation replaced the URL; Back then reopened it.
 *  - Opened by the `?palette=1` deep link, the stale `setOpen(false)` did act,
 *    with that render's router state: after a navigating command, a theme
 *    command run from the next page took the user back to the deep-linked page.
 *
 * Pinned through the real `CommandPalette` + `CommandPaletteProvider` (and so
 * the real `useUrlOverlay`) and the real `ThemeProvider`, in a `MemoryRouter`
 * whose first entry is a sentinel, so Back can count the entries a command
 * adds. The palette is opened the way the header button opens it — the
 * provider's `openCommandPalette` — or by the ⌘K accelerator.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { CommandPalette } from './CommandPalette';
import { ThemeProvider } from './ThemeProvider';
import { CommandPaletteProvider, useCommandPalette } from '../context/CommandPaletteProvider';

const SHOWCASE = {
  name: 'showcase_app',
  label: 'Showcase',
  navigation: [
    { id: 'nav_accounts', type: 'object', objectName: 'showcase_account', label: 'Accounts' },
    { id: 'nav_map', type: 'page', pageName: 'showcase_capability_map', label: 'Capability Map' },
  ],
};
const OBJECTS = [{ name: 'showcase_account', label: 'Account' }];

const SENTINEL = '/before-the-app';
const PAGE = '/apps/showcase_app/page/showcase_capability_map';
const ACCOUNTS = '/apps/showcase_app/showcase_account';
const THEME_KEY = 'objectui-12683-theme';

/** Renders where the router is, the header button's open handler, and Back. */
function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  const { openCommandPalette } = useCommandPalette();
  return (
    <>
      <span data-testid="location" data-path={location.pathname} data-search={location.search} />
      <button type="button" data-testid="open-palette" onClick={openCommandPalette} />
      <button type="button" data-testid="go-back" onClick={() => navigate(-1)} />
    </>
  );
}

function mount(entry: string) {
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <ThemeProvider defaultTheme="light" storageKey={THEME_KEY}>
        <MemoryRouter initialEntries={[SENTINEL, entry]} initialIndex={1}>
          <CommandPaletteProvider>
            <Probe />
            <CommandPalette
              apps={[SHOWCASE]}
              activeApp={SHOWCASE}
              objects={OBJECTS}
              onAppChange={() => {}}
            />
          </CommandPaletteProvider>
        </MemoryRouter>
      </ThemeProvider>
    </I18nProvider>,
  );
}

const OPENERS = {
  'the header button': () => fireEvent.click(screen.getByTestId('open-palette')),
  'the ⌘K accelerator': () => fireEvent.keyDown(document, { key: 'k', metaKey: true }),
} as const;

function where(): { path: string; search: string } {
  const el = screen.getByTestId('location');
  return { path: el.getAttribute('data-path') ?? '', search: el.getAttribute('data-search') ?? '' };
}

function paletteMounted(): boolean {
  return document.querySelector('[data-testid="overlay:command-palette"]') !== null;
}

/** Type `query` into the open palette and click the item whose value starts with `prefix`. */
function run(query: string, prefix: string) {
  const input = document.querySelector('[cmdk-input]');
  if (!input) throw new Error('the palette is not open');
  fireEvent.change(input, { target: { value: query } });
  const item = document.querySelector(`[cmdk-item][data-value^="${prefix}"]`);
  if (!item) throw new Error(`no rendered item starts with "${prefix}"`);
  fireEvent.click(item);
}

function back() {
  fireEvent.click(screen.getByTestId('go-back'));
}

afterEach(() => {
  cleanup();
  localStorage.removeItem(THEME_KEY);
  document.documentElement.classList.remove('light', 'dark');
});

describe('a palette command closes the palette (objectui#12683)', () => {
  it.each(Object.keys(OPENERS) as Array<keyof typeof OPENERS>)(
    'a non-navigating command (Dark Theme) closes a palette opened by %s and leaves the page where it was',
    (opener) => {
      mount(PAGE);
      expect(paletteMounted()).toBe(false);

      OPENERS[opener]();
      expect(paletteMounted()).toBe(true);
      expect(where()).toEqual({ path: PAGE, search: '?palette=1' });

      run('dark', 'theme dark');

      // The command ran: the theme applied.
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      // And the palette closed, with `?palette=1` gone from the page's URL.
      expect(paletteMounted()).toBe(false);
      expect(where()).toEqual({ path: PAGE, search: '' });

      // Opening and closing replaced the page's entry; neither pushed one.
      back();
      expect(where()).toEqual({ path: SENTINEL, search: '' });
    },
  );

  it('a navigating command lands on its route with the palette closed, adding one history entry', () => {
    mount(PAGE);
    OPENERS['the header button']();
    expect(where()).toEqual({ path: PAGE, search: '?palette=1' });

    run('accounts', 'object Accounts');

    expect(where()).toEqual({ path: ACCOUNTS, search: '' });
    expect(paletteMounted()).toBe(false);

    // Back returns to the page the command was run from, with the palette
    // closed: the command closed it before navigating.
    back();
    expect(where()).toEqual({ path: PAGE, search: '' });
    expect(paletteMounted()).toBe(false);

    // One entry was added, the route's: the next Back is the sentinel.
    back();
    expect(where()).toEqual({ path: SENTINEL, search: '' });
  });

  it('a palette opened by the deep link: a later theme command, run from another page, stays on that page', () => {
    mount(`${PAGE}?palette=1`);
    expect(paletteMounted()).toBe(true);

    run('accounts', 'object Accounts');
    expect(where()).toEqual({ path: ACCOUNTS, search: '' });

    OPENERS['the header button']();
    expect(where()).toEqual({ path: ACCOUNTS, search: '?palette=1' });

    run('dark', 'theme dark');

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(paletteMounted()).toBe(false);
    expect(where()).toEqual({ path: ACCOUNTS, search: '' });
  });
});
