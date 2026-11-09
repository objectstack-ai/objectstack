/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30338 — a language picked on the sign-in page is kept when the
 * person who signs in is not the browser's last owner.
 *
 * The state pinned is the sign-in page-load: the persisted owner pointer names
 * A, A's language is in both device slots, and someone picks a language in the
 * sign-in page's menu (signed out, so `useLanguageSelection` is a bare local
 * switch). Then B signs in and `SessionUserScope.adopt(B)` runs, exactly as
 * `AuthProvider` runs it. The console then leaves by a full navigation, so
 * what the next page-load boots from is the STORAGE this page-load leaves —
 * that, not the live language, is what these pins read.
 *
 * objectui#10193 ruling B stands and is pinned beside it: what A left, with no
 * pick made since, is still swept.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import {
  I18nProvider,
  LOCALE_SEED_STORAGE_KEY,
  LOCALE_STORAGE_KEY,
  useObjectTranslation,
} from '@object-ui/i18n';
// Not on the `@object-ui/auth` barrel; the vitest alias maps that barrel to
// `packages/auth/src`, so this deep path is the SAME module instance the hook's
// `subscribeSessionOwnerChange` registers with.
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

import {
  __resetSignedOutPickForTests,
  hasSignInLanguagePick,
  saveSignInLanguagePick,
  useLanguageSelection,
  useSignedInUserLocale,
} from '../useUserLocale';

const USER_A = 'u_alice';
const USER_B = 'u_bob';
const USER_C = 'u_carol';
const POINTER_KEY = 'auth-session-user-id';
/** A's language, and not the browser's (`en`). */
const A_LANGUAGE = 'ja';
/** The language picked on the sign-in page. */
const PICK = 'fr';

function userRow(id: string, locale: string | null) {
  return { findOne: vi.fn(async () => ({ id, locale })), update: vi.fn(async () => ({})) };
}

/** The sign-in page's language menu: a switch through `useLanguageSelection`. */
function Menu({ to }: { to: string }) {
  const select = useLanguageSelection();
  const { language } = useObjectTranslation();
  return (
    <>
      <span data-testid="language">{language}</span>
      <button type="button" onClick={() => void select(to)}>
        pick
      </button>
    </>
  );
}

/** The shell, for the page-load that does not navigate away. */
function Shell({ to }: { to: string }) {
  useSignedInUserLocale();
  return <Menu to={to} />;
}

const shownLanguage = () => screen.getByTestId('language').textContent;
const storedChoice = () => window.localStorage.getItem(LOCALE_STORAGE_KEY);

/** The browser A left behind: pointer, explicit slot, seed. */
function leaveAsResidue() {
  window.localStorage.setItem(POINTER_KEY, USER_A);
  window.localStorage.setItem(LOCALE_STORAGE_KEY, A_LANGUAGE);
  window.localStorage.setItem(LOCALE_SEED_STORAGE_KEY, A_LANGUAGE);
}

async function pickOnSignInPage(to = PICK) {
  fireEvent.click(screen.getByRole('button', { name: 'pick' }));
  await waitFor(() => expect(shownLanguage()).toBe(to));
  // The switch persisted itself, as every switch does.
  expect(storedChoice()).toBe(to);
}

beforeEach(() => {
  window.localStorage.clear();
  SessionUserScope._resetForTests();
  __resetSignedOutPickForTests();
  session.user = null;
  session.adapter = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a language picked on the sign-in page survives a change of owner (objectstack#30338)', () => {
  it('B signs in after picking: the pick stays stored for the next page-load, A’s seed does not', async () => {
    leaveAsResidue();
    render(
      <I18nProvider>
        <Menu to={PICK} />
      </I18nProvider>,
    );
    expect(shownLanguage()).toBe(A_LANGUAGE);
    await pickOnSignInPage();

    let purged: unknown;
    act(() => {
      purged = SessionUserScope.adopt(USER_B);
    });

    // The purge really ran (A's seed is gone) — and the pick was put back.
    expect(purged).toBe(true);
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBeNull();
    expect(storedChoice()).toBe(PICK);
    expect(window.localStorage.getItem(POINTER_KEY)).toBe(USER_B);
  });

  it('control (objectui#10193 ruling B): with no pick since A, A’s language is still swept', async () => {
    leaveAsResidue();
    render(
      <I18nProvider>
        <Menu to={PICK} />
      </I18nProvider>,
    );

    act(() => {
      SessionUserScope.adopt(USER_B);
    });

    expect(storedChoice()).toBeNull();
    expect(window.localStorage.getItem(LOCALE_SEED_STORAGE_KEY)).toBeNull();
  });

  it('the pick goes to the next sign-in only: it does not come back at a later change of owner', async () => {
    leaveAsResidue();
    render(
      <I18nProvider>
        <Menu to={PICK} />
      </I18nProvider>,
    );
    await pickOnSignInPage();
    act(() => {
      SessionUserScope.adopt(USER_B);
    });
    expect(storedChoice()).toBe(PICK);

    // B's page-load ends; C signs in on the same tab without picking anything.
    SessionUserScope._resetForTests();
    act(() => {
      SessionUserScope.adopt(USER_C);
    });

    expect(storedChoice()).toBeNull();
  });

  it('a signed-in switch replaces the pick, so the next owner change does not restore it', async () => {
    leaveAsResidue();
    const { rerender } = render(
      <I18nProvider>
        <Menu to={PICK} />
      </I18nProvider>,
    );
    await pickOnSignInPage();

    // The first owner of a clean pointer is not an owner change: no purge, no
    // event. B is signed in and switches to German from the globe.
    window.localStorage.removeItem(POINTER_KEY);
    act(() => {
      SessionUserScope.adopt(USER_B);
    });
    session.user = { id: USER_B };
    session.adapter = userRow(USER_B, null);
    rerender(
      <I18nProvider>
        <Menu to="de" />
      </I18nProvider>,
    );
    await pickOnSignInPage('de');

    // C signs in next: neither B's German nor the earlier pick is C's.
    SessionUserScope._resetForTests();
    act(() => {
      SessionUserScope.adopt(USER_C);
    });
    expect(storedChoice()).toBeNull();
  });

  it('with the shell mounted (no navigation), B keeps the pick live and stored after the reset', async () => {
    leaveAsResidue();
    const adapter = userRow(USER_B, null);
    const { rerender } = render(
      <I18nProvider>
        <Shell to={PICK} />
      </I18nProvider>,
    );
    await pickOnSignInPage();

    session.user = { id: USER_B };
    session.adapter = adapter;
    rerender(
      <I18nProvider>
        <Shell to={PICK} />
      </I18nProvider>,
    );
    act(() => {
      SessionUserScope.adopt(USER_B);
    });

    await waitFor(() => expect(adapter.findOne).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(shownLanguage()).toBe(PICK);
    expect(storedChoice()).toBe(PICK);
  });
});

/**
 * objectstack#30399 — the saved half of objectstack#30338: the sign-in page
 * saves the pick as the signed-in person's own language when they have none,
 * through the column's one write door, before it navigates away. The sign-in
 * page's side (it awaits this before every exit) is pinned in the console's
 * `signInLanguagePick-30399.test.tsx`.
 */
describe('a language picked on the sign-in page is saved as the person’s own when they have none (objectstack#30399)', () => {
  function renderSignInMenu() {
    render(
      <I18nProvider>
        <Menu to={PICK} />
      </I18nProvider>,
    );
  }

  it('B signs in after picking, with no language of their own: the pick is written to sys_user.locale', async () => {
    leaveAsResidue();
    renderSignInMenu();
    await pickOnSignInPage();
    act(() => {
      SessionUserScope.adopt(USER_B);
    });

    expect(hasSignInLanguagePick()).toBe(true);
    const writer = userRow(USER_B, null);
    await saveSignInLanguagePick(USER_B, writer);

    expect(writer.findOne).toHaveBeenCalledWith('sys_user', USER_B);
    expect(writer.update).toHaveBeenCalledTimes(1);
    expect(writer.update).toHaveBeenCalledWith('sys_user', USER_B, { locale: PICK });
    // Spent: it reaches one person.
    expect(hasSignInLanguagePick()).toBe(false);
  });

  it('the browser’s last owner signs in again (no owner change): the pick is still saved', async () => {
    leaveAsResidue();
    renderSignInMenu();
    await pickOnSignInPage();
    let purged: unknown;
    act(() => {
      purged = SessionUserScope.adopt(USER_A);
    });
    expect(purged).toBe(false);

    const writer = userRow(USER_A, null);
    await saveSignInLanguagePick(USER_A, writer);
    expect(writer.update).toHaveBeenCalledWith('sys_user', USER_A, { locale: PICK });
  });

  it('a language of their own already saved is kept: read, never overwritten', async () => {
    leaveAsResidue();
    renderSignInMenu();
    await pickOnSignInPage();

    const writer = userRow(USER_B, 'de');
    await saveSignInLanguagePick(USER_B, writer);

    expect(writer.findOne).toHaveBeenCalledTimes(1);
    expect(writer.update).not.toHaveBeenCalled();
  });

  it('CONTROL: no pick on the sign-in page, no request at all', async () => {
    leaveAsResidue();
    renderSignInMenu();

    expect(hasSignInLanguagePick()).toBe(false);
    const writer = userRow(USER_B, null);
    await saveSignInLanguagePick(USER_B, writer);

    expect(writer.findOne).not.toHaveBeenCalled();
    expect(writer.update).not.toHaveBeenCalled();
  });

  it('a second call saves nothing: the pick reached the first person only', async () => {
    leaveAsResidue();
    renderSignInMenu();
    await pickOnSignInPage();
    await saveSignInLanguagePick(USER_B, userRow(USER_B, null));

    const next = userRow(USER_C, null);
    await saveSignInLanguagePick(USER_C, next);
    expect(next.findOne).not.toHaveBeenCalled();
    expect(next.update).not.toHaveBeenCalled();
  });

  it('a signed-in switch replaces the pick: nothing is left to save', async () => {
    leaveAsResidue();
    const { rerender } = render(
      <I18nProvider>
        <Menu to={PICK} />
      </I18nProvider>,
    );
    await pickOnSignInPage();
    session.user = { id: USER_B };
    session.adapter = userRow(USER_B, null);
    rerender(
      <I18nProvider>
        <Menu to="de" />
      </I18nProvider>,
    );
    await pickOnSignInPage('de');

    expect(hasSignInLanguagePick()).toBe(false);
  });

  it('a failed write never rejects, says so at error, and leaves the pick stored on this device', async () => {
    leaveAsResidue();
    renderSignInMenu();
    await pickOnSignInPage();
    act(() => {
      SessionUserScope.adopt(USER_B);
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const writer = {
      findOne: vi.fn(async () => ({ id: USER_B, locale: null })),
      update: vi.fn(async () => {
        throw Object.assign(new Error('refused'), { status: 403 });
      }),
    };

    await expect(saveSignInLanguagePick(USER_B, writer)).resolves.toBeUndefined();
    expect(writer.update).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(storedChoice()).toBe(PICK);
  });

  it('a failed read writes nothing: an unknown column is not overwritten', async () => {
    leaveAsResidue();
    renderSignInMenu();
    await pickOnSignInPage();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const writer = {
      findOne: vi.fn(async () => {
        throw new Error('network');
      }),
      update: vi.fn(async () => ({})),
    };

    await expect(saveSignInLanguagePick(USER_B, writer)).resolves.toBeUndefined();
    expect(writer.update).not.toHaveBeenCalled();
  });
});
