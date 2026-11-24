/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The phone navigation drawer's accessible name follows the session locale —
 * objectstack#37018.
 *
 * Below the mobile breakpoint `Sidebar` renders a Sheet, a dialog whose
 * `sr-only` header upstream fills with the English literals "Sidebar" /
 * "Displays the mobile sidebar.". The declared `sidebar-drawer-label-*`
 * patches (`ui/scripts/shadcn-local-patches.mjs`) name it with
 * `console.nav.menuLabel` and drop the description with
 * `aria-describedby={undefined}`; `scripts/__tests__/shadcn-local-patches.test.ts`
 * holds the anchors to registry bytes, this file holds the rendered result.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import * as React from 'react';
import { Sidebar, SidebarProvider, useSidebar } from '../ui/sidebar';

const originalInnerWidth = window.innerWidth;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  // `useIsMobile` reads `window.innerWidth` against the 768px breakpoint and
  // subscribes through `matchMedia`, which jsdom does not implement.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  window.matchMedia = originalMatchMedia;
});

// Opens the phone drawer the way the shell's trigger does: on a phone,
// `toggleSidebar` flips the provider's `openMobile`.
function OpenOnMount() {
  const { isMobile, setOpenMobile } = useSidebar();
  React.useEffect(() => {
    if (isMobile) setOpenMobile(true);
  }, [isMobile, setOpenMobile]);
  return null;
}

function drawer(children: React.ReactNode = <p>menu</p>) {
  return (
    <SidebarProvider>
      <OpenOnMount />
      <Sidebar>{children}</Sidebar>
    </SidebarProvider>
  );
}

describe('Sidebar phone drawer — accessible name (objectstack#37018)', () => {
  it('reads the zh-Hans pack value under a zh-Hans session', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh-Hans', detectBrowserLanguage: false }}>
        {drawer()}
      </I18nProvider>,
    );

    const dialog = await screen.findByRole('dialog', { name: '应用导航' });
    expect(dialog.getAttribute('data-mobile')).toBe('true');
    // The literals this replaced, asserted negatively so a re-inlined English
    // title or a second dialog cannot hide behind the positive match.
    expect(screen.queryByRole('dialog', { name: 'Sidebar' })).toBeNull();
    expect(screen.queryByText('Displays the mobile sidebar.')).toBeNull();
    // The description is dropped, not translated: nothing describes the dialog.
    expect(dialog.hasAttribute('aria-describedby')).toBe(false);
  });

  it('reads "App navigation" under an en session and with no provider at all', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        {drawer()}
      </I18nProvider>,
    );
    expect(await screen.findByRole('dialog', { name: 'App navigation' })).toBeTruthy();
    cleanup();

    render(drawer());
    expect(await screen.findByRole('dialog', { name: 'App navigation' })).toBeTruthy();
  });

  // Measured for objectstack#37018: the `@radix-ui/react-dialog` this package
  // resolves logs nothing about a missing Description or Title, and leaves
  // `aria-describedby` off when no Description is mounted, so this holds with
  // or without `aria-describedby={undefined}` today (the ablation stayed
  // green). It is kept as the guard for a Radix change that brings the
  // missing-description warning back, which the explicit prop exists to quiet.
  it('opens without Radix warning about a missing Description', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(drawer());
    await screen.findByRole('dialog', { name: 'App navigation' });

    const radixNotices = [...warn.mock.calls, ...error.mock.calls]
      .map((args) => args.map(String).join(' '))
      .filter((line) => /Description|aria-describedby|DialogTitle/.test(line));
    expect(radixNotices).toEqual([]);
  });
});
