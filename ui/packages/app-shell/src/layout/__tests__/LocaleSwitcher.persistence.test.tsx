// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * LocaleSwitcher — the console's language choice survives a reload
 * (objectstack#5406).
 *
 * The bug was reported against this exact surface (avatar menu → Preferences →
 * Language): the switch localized the UI immediately and was gone on the next
 * F5. The persistence itself lives in `@object-ui/i18n`'s provider; this test
 * covers the console path end to end, so a future switcher that bypasses the
 * i18n context (calling into some other API) turns red here instead of
 * silently reverting to `en` again.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { I18nProvider, LOCALE_STORAGE_KEY } from '@object-ui/i18n';

// Passthrough dropdown primitives — the open/close choreography is Radix's
// business; what matters here is what a click on a language item leaves behind.
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Button: (p: any) => <button {...p} />,
  DropdownMenu: (p: any) => <div>{p.children}</div>,
  DropdownMenuTrigger: (p: any) => <div>{p.children}</div>,
  DropdownMenuContent: (p: any) => <div>{p.children}</div>,
  DropdownMenuItem: ({ onClick, children }: any) => <div onClick={onClick}>{children}</div>,
}));
vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Globe: () => <span />,
}));

import { LocaleSwitcher } from '../LocaleSwitcher';

/** A page load: a fresh provider building a fresh i18next instance. */
function load() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <LocaleSwitcher />
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('LocaleSwitcher persistence', () => {
  it('remembers the picked language across a reload', async () => {
    const first = load();
    // English before the switch — the switcher's own sr-only label localizes.
    expect(screen.getByText('Language')).toBeInTheDocument();

    fireEvent.click(screen.getByText('中文'));

    await waitFor(() => expect(screen.getByText('语言')).toBeInTheDocument());
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh');

    first.unmount();

    // Reload: nothing carries over but localStorage.
    load();
    expect(screen.getByText('语言')).toBeInTheDocument();
    expect(screen.queryByText('Language')).not.toBeInTheDocument();
  });
});
