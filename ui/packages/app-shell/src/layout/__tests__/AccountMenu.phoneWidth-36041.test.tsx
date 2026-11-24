// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The account menu stays inside a phone screen in every interface language
 * (objectstack#36041).
 *
 * The menu sizes to its longest line. At 375 px, with the desktop notification
 * hint showing (a blocked or unsupported Notification API, as on iOS Safari),
 * the German, French, Russian, Spanish and Portuguese hints widened it past the
 * screen, and the language control rode off the right edge with it: the
 * language list could not be opened at all. Below `md` the menu is now capped
 * at the screen less a 1 rem gutter each side, so long lines wrap.
 *
 * The language list is its own dropdown under the globe, opening below it (or
 * above, where only that fits), never to the side; with the globe back on the
 * screen it opens on the screen. The list itself is shared with the sign-in
 * page and is unchanged.
 *
 * jsdom has no layout, so what is pinned here is what the menu asks for: the
 * phone-only cap on the content, the list's placement, and that every language
 * row picks its language. The 375 px readings in all eleven languages, before
 * and after, are in the pull request.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { SidebarProvider } from '@object-ui/components';
import { PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Lin Yue', email: 'linyue@example.com' },
    signOut: vi.fn(),
    isAuthEnabled: true,
    organizations: [],
    activeOrganization: null,
    isOrganizationsLoading: false,
    getAuthConfig: undefined,
  }),
  getUserInitials: () => 'LY',
}));

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [] }),
}));

import { AccountMenu } from '../AccountMenu';

/** The phone-only cap: the screen less a 1 rem gutter each side. */
const PHONE_CAP = 'max-md:max-w-[calc(100vw-2rem)]';

const classesOf = (el: Element) => el.className.split(/\s+/);

function mount(trigger: 'avatar' | 'sidebar', language = 'de') {
  const menu = <AccountMenu trigger={trigger} />;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter>{trigger === 'sidebar' ? <SidebarProvider>{menu}</SidebarProvider> : menu}</MemoryRouter>
    </I18nProvider>,
  );
}

/** Open the account menu from its trigger and return its content. */
function openAccountMenu(): HTMLElement {
  const trigger = screen.getAllByRole('button', { name: 'Kontomenü' })[0];
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.getAllByRole('menu')[0];
}

/** Open the language list from the globe inside the account menu. */
function openLanguageList(menu: HTMLElement): HTMLElement {
  const globe = within(menu).getByRole('button', { name: 'Sprache' });
  fireEvent.keyDown(globe, { key: 'Enter' });
  const menus = screen.getAllByRole('menu');
  return menus[menus.length - 1];
}

beforeEach(() => {
  document.documentElement.lang = '';
});

describe('the account menu at phone width (objectstack#36041)', () => {
  it('caps the menu at the screen less the gutter below md, and only below md', () => {
    mount('avatar');
    const classes = classesOf(openAccountMenu());
    expect(classes).toContain(PHONE_CAP);
    // Desktop keeps today's width: no unscoped max width rides on the content.
    expect(classes.filter((c) => c.startsWith('max-w-'))).toEqual([]);
  });

  it('opens the language list below the globe, not to the side', () => {
    mount('avatar');
    const list = openLanguageList(openAccountMenu());
    expect(['bottom', 'top']).toContain(list.getAttribute('data-side'));
    expect(within(list).getAllByRole('menuitem')).toHaveLength(PLATFORM_LOCALE_TAGS.length);
  });

  it('picks every language from the list', async () => {
    const { container } = mount('avatar');
    const picked: string[] = [];
    for (let i = 0; i < PLATFORM_LOCALE_TAGS.length; i++) {
      // The trigger is found by its role in the DOM, not its name: the menu
      // relabels in each language it picks.
      const trigger = container.querySelector('button[aria-haspopup="menu"]');
      if (!trigger) throw new Error('no account menu trigger');
      fireEvent.keyDown(trigger, { key: 'Enter' });
      const menu = screen.getAllByRole('menu')[0];
      const globe = within(menu)
        .getAllByRole('button')
        .find((b) => b.getAttribute('aria-haspopup') === 'menu' && b.querySelector('.lucide-globe'));
      if (!globe) throw new Error('no language control in the account menu');
      fireEvent.keyDown(globe, { key: 'Enter' });
      const menus = screen.getAllByRole('menu');
      const rows = within(menus[menus.length - 1]).getAllByRole('menuitem');
      expect(rows).toHaveLength(PLATFORM_LOCALE_TAGS.length);
      await act(async () => {
        fireEvent.click(rows[i]);
      });
      // Close whatever is still open before the next round.
      for (const open of screen.queryAllByRole('menu')) fireEvent.keyDown(open, { key: 'Escape' });
      await waitFor(() => expect(screen.queryAllByRole('menu')).toHaveLength(0));
      picked.push(document.documentElement.lang);
    }
    expect([...picked].sort()).toEqual([...PLATFORM_LOCALE_TAGS].sort());
  });

  it('CONTROL — the desktop sidebar trigger keeps its placement: above, aligned to the start', () => {
    mount('sidebar');
    fireEvent.keyDown(screen.getByTestId('sidebar-account-menu'), { key: 'Enter' });
    const menu = screen.getAllByRole('menu')[0];
    expect(menu.getAttribute('data-side')).toBe('top');
    expect(menu.getAttribute('data-align')).toBe('start');
  });
});
