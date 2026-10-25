/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every string objectui#3440 moved out of `PresenceAvatars` still resolves to
 * ENGLISH when no `I18nProvider` is mounted.
 *
 * `PresenceAvatars` is an exported component and its host may mount no ObjectUI
 * shell at all. Routing a literal through `t()` without a working default is
 * exactly how an accessible name turns into a raw dotted key
 * (`collaboration.presentUserCount`) in someone else's app — silently, because
 * `fallbackLng: 'en'` never fires when there is no i18next instance to fall
 * back inside of. `COLLAB_DEFAULT_TRANSLATIONS` is what has to hold here.
 *
 * ── Directions: predicted BEFORE running ──────────────────────────────────
 * **Every** assertion in this file is GREEN on BOTH sides of the change. That
 * is the invariant, not a missing test: the English copy is byte-identical
 * before and after (`origin/main`'s ternary already produced a correct
 * singular), so a flip here would mean the copy moved. What this file catches
 * is a break introduced by *this* change — a key wired into the component but
 * missing or misspelled in `COLLAB_DEFAULT_TRANSLATIONS` goes red here and
 * nowhere else, because the provider-backed file resolves against the locale
 * packs instead.
 *
 * The one genuinely new English string is the status tooltip's fallback for an
 * off-union status: `origin/main` interpolated the raw value directly, and it
 * still must.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, which registers that
 * instance as react-i18next's **module-global default**. The registration
 * survives unmount and `cleanup()`. So the moment any test in a file mounts
 * `<I18nProvider config={{ defaultLanguage: 'zh' }}>`, every later "no
 * provider" render in that same file silently resolves against the Chinese
 * instance — a file that looks green while asserting nothing, or a baffling
 * red where a provider-less stack renders 中文.
 *
 * Vitest's `dom` project runs with `isolate: true`, so a file that never mounts
 * a provider gets a genuinely clean global. Keep it that way: **do not import
 * or mount `I18nProvider` here.**
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PresenceAvatars } from '../PresenceAvatars';
import { COLLAB_DEFAULT_TRANSLATIONS } from '../useCollaborationTranslation';
import type { PresenceUser } from '../usePresence';

const at = '2026-01-01T00:00:00.000Z';

const users: PresenceUser[] = [
  { userId: 'u_alice', userName: 'Alice Chen', color: '#e74c3c', status: 'active', lastActivity: at },
  { userId: 'u_bob', userName: 'Bob Ito', color: '#3498db', status: 'idle', lastActivity: at },
  { userId: 'u_carol', userName: 'Carol Diaz', color: '#2ecc71', status: 'away', lastActivity: at },
  { userId: 'u_dan', userName: 'Dan Meyer', color: '#f39c12', status: 'active', lastActivity: at },
  { userId: 'u_eve', userName: 'Eve Novak', color: '#9b59b6', status: 'idle', lastActivity: at },
];

function renderBare(overrides: Record<string, unknown> = {}) {
  return render(<PresenceAvatars users={users} maxVisible={3} showStatus {...overrides} />);
}

const groupLabel = () => screen.getByRole('group').getAttribute('aria-label');

afterEach(() => cleanup());

describe('PresenceAvatars with no I18nProvider — English fallback (objectui#3440)', () => {
  it('names the avatar group in English, plural and singular', () => {
    renderBare();
    expect(groupLabel()).toBe('5 users present');
    cleanup();

    renderBare({ users: [users[0]] });
    expect(groupLabel()).toBe('1 user present');
    expect(screen.queryByLabelText('1 users present')).toBeNull();
  });

  it('labels the overflow badge in English, plural and singular', () => {
    renderBare();
    expect(screen.getByTitle('2 more users')).toBeTruthy();
    cleanup();

    renderBare({ users: users.slice(0, 4) });
    expect(screen.getByTitle('1 more user')).toBeTruthy();
    expect(screen.queryByTitle('1 more users')).toBeNull();
  });

  it('renders every status enum value as English display copy', () => {
    renderBare();

    expect(screen.getByTitle('Alice Chen (active)')).toBeTruthy();
    expect(screen.getByTitle('Bob Ito (idle)')).toBeTruthy();
    expect(screen.getByTitle('Carol Diaz (away)')).toBeTruthy();
  });

  it('falls back to the raw value for a status outside the union', () => {
    renderBare({ users: [{ ...users[0], status: 'online' as PresenceUser['status'] }] });

    expect(screen.getByTitle('Alice Chen (online)')).toBeTruthy();
  });

  /**
   * The failure mode this whole file exists to catch: a key wired into the
   * component but absent from the defaults map renders as its own dotted name
   * — here inside an `aria-label`, where nothing on screen would show it.
   */
  it('never renders a raw i18n key or an unsubstituted placeholder', () => {
    const { container } = renderBare();

    const names = [
      groupLabel() ?? '',
      ...[...container.querySelectorAll('[title]')].map((el) => el.getAttribute('title') ?? ''),
    ].join(' | ');

    expect(names).not.toMatch(/collaboration\.\w+/);
    expect(names).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe('COLLAB_DEFAULT_TRANSLATIONS covers the presence stack', () => {
  /**
   * The defaults map is the only English copy left in the package, so an
   * absent key would make the assertions above pass for the wrong reason: a
   * key that resolves to itself still "renders" something.
   */
  it('has real English copy for every presence key, never the key itself', () => {
    for (const key of [
      'collaboration.presentUserCount',
      'collaboration.presentUserCount_one',
      'collaboration.presentUserCount_other',
      'collaboration.moreUserCount',
      'collaboration.moreUserCount_one',
      'collaboration.moreUserCount_other',
      'collaboration.userStatusTitle',
      'collaboration.statusActive',
      'collaboration.statusIdle',
      'collaboration.statusAway',
    ]) {
      const value = COLLAB_DEFAULT_TRANSLATIONS[key];
      expect(value, `${key} has no English copy`).toBeTruthy();
      expect(value, `${key} is just its own key`).not.toBe(key);
    }
  });

  it('keeps the count placeholder in every row of each count family (objectui#11445)', () => {
    for (const base of ['collaboration.presentUserCount', 'collaboration.moreUserCount']) {
      for (const key of [base, `${base}_one`, `${base}_other`]) {
        expect(COLLAB_DEFAULT_TRANSLATIONS[key], key).toContain('{{count}}');
      }
    }
  });

  it('gives the tooltip both of its placeholders', () => {
    const title = COLLAB_DEFAULT_TRANSLATIONS['collaboration.userStatusTitle'];
    expect(title).toContain('{{name}}');
    expect(title).toContain('{{status}}');
  });
});
