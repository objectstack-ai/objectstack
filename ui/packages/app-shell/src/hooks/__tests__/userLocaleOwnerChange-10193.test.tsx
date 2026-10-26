/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10193 (ruling B) — a browser that changes hands must not keep the
 * previous owner's UI language.
 *
 * The state pinned is the boot that leaks: the persisted owner pointer still
 * names A, both device language slots hold A's language, and the cookie
 * session belongs to B (an SSO redirect, or a sign-in in another window). The
 * boot resolves its language before anyone is signed in, so it paints A's.
 * Then the session resolves and `SessionUserScope.adopt(B)` runs, exactly as
 * `AuthProvider` runs it — the purge clears storage, and the assertion is on
 * the LIVE language every consumer renders from, not on the slots: an
 * assertion over the slots alone is green before this fix too, because the
 * objectui#5664 purge already empties them.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import {
  I18nProvider,
  LOCALE_SEED_STORAGE_KEY,
  LOCALE_STORAGE_KEY,
  useObjectTranslation,
} from '@object-ui/i18n';
// Not on the `@object-ui/auth` barrel; the vitest alias maps that barrel to
// `packages/auth/src`, so this deep path is the SAME module instance the hook's
// `getSessionOwnerChangeCount` reads.
import { SessionUserScope } from '../../../../auth/src/ActiveOrganizationStorage';

const session = vi.hoisted(() => ({
  user: null as { id: string } | null,
  adapter: null as unknown,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: session.user,
    isAuthenticated: Boolean(session.user),
    isLoading: false,
  }),
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => session.adapter,
}));

import { useSignedInUserLocale } from '../useUserLocale';

const USER_A = 'u_alice';
const USER_B = 'u_bob';
const POINTER_KEY = 'auth-session-user-id';
/** A's language: not the browser's (`en`), so "still A's" is observable. */
const A_LANGUAGE = 'ja';

function userRow(id: string, locale: string | null) {
  return { findOne: vi.fn(async () => ({ id, locale })), update: vi.fn() };
}

function Probe() {
  useSignedInUserLocale();
  const { language } = useObjectTranslation();
  return <span data-testid="language">{language}</span>;
}

/** No `config`, as the console mounts it. */
const mount = () =>
  render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );

const shownLanguage = () => screen.getByTestId('language').textContent;

/** The browser A left behind: pointer, explicit slot, seed. */
function leaveAsResidue() {
  window.localStorage.setItem(POINTER_KEY, USER_A);
  window.localStorage.setItem(LOCALE_STORAGE_KEY, A_LANGUAGE);
  window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, A_LANGUAGE);
}

beforeEach(() => {
  window.localStorage.clear();
  SessionUserScope._resetForTests();
  session.user = null;
  session.adapter = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a change of owner re-resolves the UI language (objectui#10193)', () => {
  it("B, with no language of their own, does not keep A's language after adopt(B)", async () => {
    leaveAsResidue();
    const adapter = userRow(USER_B, null);
    session.user = { id: USER_B };
    session.adapter = adapter;

    mount();
    // The leaking boot really is in A's language — without this the pin below
    // could go green on a boot that never inherited anything.
    expect(shownLanguage()).toBe(A_LANGUAGE);

    let purged: unknown;
    act(() => {
      purged = SessionUserScope.adopt(USER_B);
    });

    await waitFor(() => expect(shownLanguage()).not.toBe(A_LANGUAGE));
    // Asserted after the language, so the pin goes red on the defect itself —
    // before this fix `adopt` returned nothing at all.
    expect(purged).toBe(true);
    await waitFor(() => expect(adapter.findOne).toHaveBeenCalled());
    expect(shownLanguage()).toBe('en');
    // The reset is nobody's choice, so it is not left in the explicit slot, and
    // A's seed is gone with the purge.
    await waitFor(() => expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull());
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBeNull();
  });

  it("B's own column still wins, landing after the reset rather than under it", async () => {
    leaveAsResidue();
    session.user = { id: USER_B };
    session.adapter = userRow(USER_B, 'de');

    mount();
    act(() => {
      SessionUserScope.adopt(USER_B);
    });

    await waitFor(() => expect(shownLanguage()).toBe('de'));
    // And stays there: a reset queued first must not land last.
    await new Promise((r) => setTimeout(r, 50));
    expect(shownLanguage()).toBe('de');
  });

  it("B's column is applied even when it happens to equal A's language", async () => {
    // Decided while A's `ja` is still showing, so a "same as now, skip" check
    // taken at that moment would let the reset land last and leave B in `en`.
    leaveAsResidue();
    const adapter = userRow(USER_B, A_LANGUAGE);
    session.user = { id: USER_B };
    session.adapter = adapter;

    mount();
    act(() => {
      SessionUserScope.adopt(USER_B);
    });

    await waitFor(() => expect(adapter.findOne).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(shownLanguage()).toBe(A_LANGUAGE);
  });

  it('a shell that mounts AFTER the purge still resets', async () => {
    leaveAsResidue();
    // The boot's instance is created from A's residue before adopt runs…
    session.user = { id: USER_B };
    session.adapter = userRow(USER_B, null);
    const { rerender } = render(
      <I18nProvider>
        <span data-testid="language">boot</span>
      </I18nProvider>,
    );
    act(() => {
      SessionUserScope.adopt(USER_B);
    });
    // …and the shell's reader arrives only now.
    rerender(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    await waitFor(() => expect(shownLanguage()).toBe('en'));
  });

  it('control: re-adopting the same owner changes nothing', async () => {
    window.localStorage.setItem(POINTER_KEY, USER_B);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, A_LANGUAGE);
    const adapter = userRow(USER_B, null);
    session.user = { id: USER_B };
    session.adapter = adapter;

    mount();
    let purged = true;
    act(() => {
      purged = SessionUserScope.adopt(USER_B);
    });
    expect(purged).toBe(false);

    await waitFor(() => expect(adapter.findOne).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    // Same owner, so this is B's own device choice and it stands.
    expect(shownLanguage()).toBe(A_LANGUAGE);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(A_LANGUAGE);
  });
});
