// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13130 — the console shell's first Tab stop is "Skip to content".
 *
 * Measured in the console walkthrough (Showcase → Contacts, keyboard only from
 * page load): the focus order walked the app bar, then every sidebar entry
 * twice (its link and its "More actions for …" button), so a list's New was
 * about the 60th stop, and there was no skip link anywhere in the shell.
 *
 * Pinned here: the link is the first Tab stop, ahead of the sidebar on a
 * desktop (which draws no app bar since objectstack#36112) and ahead of the
 * app bar on a phone; activating it moves focus to the route slot, the element that
 * holds the page, without writing a hash into the URL; the next Tab lands on
 * the page's own first control; and the slot is focusable by script only.
 *
 * ## Real subjects
 *
 * `ConsoleLayout` with its real `AppShell` and the real English pack. The
 * chrome is stubbed with stand-ins that carry real Tab stops, so "first" is
 * measured against an app bar control and a sidebar entry, not against an
 * empty shell. Tab order is `@testing-library/user-event`'s.
 */

import '@testing-library/jest-dom/vitest';
// The layout reaches `import('@objectstack/lint')` (the draft bar's publish
// preflight); pay its first load at collection, never inside a clocked case.
import '@objectstack/lint';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../UnifiedSidebar', () => ({
  UnifiedSidebar: () => (
    <nav>
      <a href="/apps/crm/contact">Contacts</a>
      <button type="button">More actions for Contacts</button>
    </nav>
  ),
}));
vi.mock('../AppHeader', () => ({
  AppHeader: () => <button type="button">App launcher</button>,
}));
vi.mock('../ConsoleNotificationBanners', () => ({ ConsoleNotificationBanners: () => null }));
vi.mock('../../preview/DraftPreviewBar', () => ({ DraftPreviewBar: () => null }));
vi.mock('../../preview/UnpublishedAppBar', () => ({ UnpublishedAppBar: () => null }));

import { ConsoleLayout } from '../ConsoleLayout';
import { NavigationProvider } from '../../context/NavigationContext';

const APP = { name: 'crm', label: 'CRM', active: true, navigation: [] };

function mountConsole(width = 1440) {
  // 1440 px: the sidebar stays open, so no collapsed-sidebar expand button
  // sits at the top of the page.
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  return render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/crm/contact']}>
        <NavigationProvider>
          <ConsoleLayout activeAppName="crm" activeApp={APP} onAppChange={vi.fn()} objects={[]}>
            <div data-testid="route-content">
              <button type="button">New</button>
            </div>
          </ConsoleLayout>
        </NavigationProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

const skipLink = () => screen.getByRole('link', { name: 'Skip to content' });

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true });
});

describe('the console shell opens with a skip link (objectui#13130)', () => {
  it('the first Tab stop is the skip link, ahead of the sidebar (a desktop draws no app bar)', async () => {
    mountConsole();
    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: 'App launcher' })).toBeNull();
    await user.tab();
    expect(document.activeElement).toBe(skipLink());
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Contacts' }));
  });

  it('on a phone the first Tab stop is the skip link, ahead of the app bar', async () => {
    mountConsole(390);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(skipLink());
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'App launcher' }));
  });

  it('activating it moves focus to the route slot that holds the page, and the next Tab reaches the page', async () => {
    mountConsole();
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard('{Enter}');
    const slot = screen.getByTestId('console-route');
    expect(document.activeElement).toBe(slot);
    expect(slot).toContainElement(screen.getByTestId('route-content'));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New' }));
  });

  it('writes no hash into the URL: the click is handled, not followed', () => {
    mountConsole();
    // `fireEvent` returns false when a handler called `preventDefault()`.
    expect(fireEvent.click(skipLink())).toBe(false);
    expect(document.activeElement).toBe(screen.getByTestId('console-route'));
  });

  it('the route slot is the link target, focusable by script and never a Tab stop of its own', () => {
    mountConsole();
    const slot = screen.getByTestId('console-route');
    expect(skipLink()).toHaveAttribute('href', `#${slot.id}`);
    expect(slot.id).not.toBe('');
    expect(slot).toHaveAttribute('tabindex', '-1');
  });

  it('stays out of sight until it has focus', () => {
    mountConsole();
    expect(skipLink()).toHaveClass('sr-only', 'focus:not-sr-only');
  });
});
