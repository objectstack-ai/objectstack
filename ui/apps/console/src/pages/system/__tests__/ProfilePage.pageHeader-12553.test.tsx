// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Profile — the page is named by the console's one page header, the one an
 * object list, a dashboard and the Approvals Inbox draw (objectui#12553).
 *
 * The page drew its own `h1` with a subtitle line beneath it, and no icon. It
 * now renders `ConsolePageHeader`, the console page header
 * `@object-ui/app-shell` exports: the title and the subtitle beside it, in one
 * row. A page that drew no icon gets no chip. The same page answers
 * `/system/profile` and the Account app's `account:profile_card` ref, which
 * `ComponentNavView` mounts bare, so neither host draws a second header.
 *
 * What this file pins, through the real page and the real header:
 *   - `page-header` holds the page's one `h1` and the subtitle in the title's
 *     row, each through its unchanged `profile.*` key, with no icon chip;
 *   - the header spans the page above the padded body, not inside it.
 *
 * jsdom applies no stylesheet, so structure is what is asserted; the one-row
 * shape and its `sm` breakpoint are app-shell's `PageHeader.oneRow-12423` pins.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

const { ADAPTER } = vi.hoisted(() => ({
  // A STABLE adapter, as the app's provider hands out (see the sibling suites).
  ADAPTER: { findOne: async () => ({ id: 'usr_1' }), update: async () => ({}) },
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'usr_1', name: 'Ada', email: 'ada@example.com' },
    updateUser: async () => {},
    isLoading: false,
    changePassword: async () => {},
    setInitialPassword: async () => {},
    hasLocalPassword: async () => true,
  }),
}));

vi.mock('@object-ui/providers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUpload: () => ({ upload: async () => ({ url: '' }) }),
}));

/** Each call site's key, so the pin names the pack key it reads. */
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (key: string) => `«${key}»`, offerableLanguages: ['en'] }),
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePermissions: () => ({ isLoaded: true, checkField: () => true }),
}));

// Imported after the mocks so the page picks them up.
const { ProfilePage } = await import('../ProfilePage');

afterEach(cleanup);

/** Render, and let the language card's row read settle. */
async function renderPage() {
  const utils = render(<ProfilePage />);
  await waitFor(() => expect(screen.getByTestId('profile-language-select')).toBeInTheDocument());
  return utils;
}

describe('Profile — the console page header (objectui#12553)', () => {
  it('`page-header` holds the one h1 and the subtitle in its row, with no icon chip', async () => {
    const { container } = await renderPage();
    const header = screen.getByTestId('page-header');

    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(header.contains(h1s[0])).toBe(true);
    expect(h1s[0].textContent).toBe('«profile.title»');

    const line = within(header).getByText('«profile.subtitle»');
    expect(line.tagName).toBe('P');
    expect(line.parentElement).toBe(h1s[0].parentElement);

    // The page drew no icon, so the header draws no chip.
    expect(header.querySelector('svg')).toBeNull();
  });

  it('the header spans the page above the padded body, not inside it', async () => {
    await renderPage();
    const header = screen.getByTestId('page-header');
    const body = header.nextElementSibling as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body!.className.split(' ')).toEqual(expect.arrayContaining(['p-4', 'sm:p-6', 'max-w-2xl']));
    expect(header.closest('.max-w-2xl')).toBeNull();
    expect(body!.contains(screen.getByTestId('profile-language-select'))).toBe(true);
  });
});
