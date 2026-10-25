/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `PresenceAvatars` speaks the session language — objectui#3440 (follow-up to
 * #3424, which wired the package up but only converted `CommentThread`).
 *
 * This is not a dormant export: the console renders it in two places under
 * whatever language the session is in — `app-shell/src/layout/AppHeader.tsx`
 * (tenant presence next to the lifecycle badge) and
 * `app-shell/src/views/RecordDetailView.tsx` (who else is on this record).
 * The stack itself is images and initials, so its `aria-label` IS the control
 * as far as a screen reader is concerned, and it announced "4 users present"
 * inside a Chinese console.
 *
 * ── Directions: predicted BEFORE running ──────────────────────────────────
 * Reverting `PresenceAvatars.tsx` to `origin/main` and keeping this file turns
 * every `zh` / `de` / `ru` / `ja` case RED and leaves the `en` cases GREEN.
 *
 * The `en` cases being green on BOTH sides is the invariant, not a gap. The
 * English `origin/main` produced was already correct — `` `${n} user${n !== 1
 * ? 's' : ''} present` `` has a real singular branch, so this is NOT the "1
 * items" defect objectui#3423 fixed on the tab badge. What was wrong is that
 * the plural RULE was compiled into the component: `n !== 1 ? 's' : ''` is
 * English grammar in a render path, and no locale could ever apply its own.
 * The `de` cases below are what pin the rule having MOVED — German inflects
 * the adjective, so "1 anwesender Benutzer" vs "2 anwesende Benutzer" differ
 * in a way the deleted ternary could not express under any locale pack. `ru`
 * pins a language that needs three forms and `ja` one that needs none.
 *
 * The provider-less English fallback is asserted in
 * `presence-avatars-no-provider-fallback.test.tsx` and cannot live here: see
 * that file's header for the react-i18next module-global instance reason.
 */

import type { ComponentProps } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider, en } from '@object-ui/i18n';
import { PresenceAvatars } from '../PresenceAvatars';
import { COLLAB_DEFAULT_TRANSLATIONS } from '../useCollaborationTranslation';
import type { PresenceUser } from '../usePresence';

const at = '2026-01-01T00:00:00.000Z';

/** Three statuses across the visible slots, so all three enum values render. */
const users: PresenceUser[] = [
  { userId: 'u_alice', userName: 'Alice Chen', color: '#e74c3c', status: 'active', lastActivity: at },
  { userId: 'u_bob', userName: 'Bob Ito', color: '#3498db', status: 'idle', lastActivity: at },
  { userId: 'u_carol', userName: 'Carol Diaz', color: '#2ecc71', status: 'away', lastActivity: at },
  { userId: 'u_dan', userName: 'Dan Meyer', color: '#f39c12', status: 'active', lastActivity: at },
  { userId: 'u_eve', userName: 'Eve Novak', color: '#9b59b6', status: 'idle', lastActivity: at },
];

function renderStack(
  language: string,
  overrides: Partial<ComponentProps<typeof PresenceAvatars>> = {},
) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <PresenceAvatars users={users} maxVisible={3} showStatus {...overrides} />
    </I18nProvider>,
  );
}

/** The avatar group's accessible name — the only name this control has. */
const groupLabel = () => screen.getByRole('group').getAttribute('aria-label');

afterEach(() => cleanup());

describe('PresenceAvatars group label (objectui#3440)', () => {
  it('announces the present-user count in English under an en session', () => {
    renderStack('en');

    expect(groupLabel()).toBe('5 users present');
  });

  it('announces the present-user count in Chinese under a zh session', () => {
    renderStack('zh');

    expect(groupLabel()).toBe('5 人在线');
    // The English literal is gone, not merely shadowed.
    expect(screen.queryByLabelText('5 users present')).toBeNull();
  });

  it('announces a one-user stack with a real singular under an en session', () => {
    renderStack('en', { users: [users[0]] });

    expect(groupLabel()).toBe('1 user present');
  });

  /**
   * The plural-rule pin. German inflects the attributive adjective, so the
   * singular and plural differ in a way `n !== 1 ? 's' : ''` could not have
   * produced for any locale — the rule now lives in the pack, not the render
   * path.
   */
  it('applies German adjective inflection, which the deleted ternary could not', () => {
    renderStack('de', { users: [users[0]] });
    expect(groupLabel()).toBe('1 anwesender Benutzer');
    cleanup();

    renderStack('de');
    expect(groupLabel()).toBe('5 anwesende Benutzer');
  });

  /**
   * A language that needs three forms; the pack picks, not the component. A
   * count family since objectui#11445, so 5 reads the `many` noun form where
   * the code-selected pair's plural half could only give a count label.
   */
  it('uses the Russian pack’s own one / many forms', () => {
    renderStack('ru', { users: [users[0]] });
    expect(groupLabel()).toBe('Присутствует 1 пользователь');
    cleanup();

    renderStack('ru');
    expect(groupLabel()).toBe('Присутствует 5 пользователей');
  });

  /** A language that needs none — one form for both, and no stray `s`. */
  it('keeps one Japanese form for both counts', () => {
    renderStack('ja', { users: [users[0]] });
    expect(groupLabel()).toBe('オンライン 1 人');
    cleanup();

    renderStack('ja');
    expect(groupLabel()).toBe('オンライン 5 人');
  });
});

describe('PresenceAvatars overflow badge (objectui#3440)', () => {
  it('labels the +N badge in the session language, plural and singular', () => {
    renderStack('en');
    expect(screen.getByTitle('2 more users')).toBeTruthy();
    cleanup();

    renderStack('en', { users: users.slice(0, 4) });
    expect(screen.getByTitle('1 more user')).toBeTruthy();
  });

  it('labels the +N badge in Chinese under a zh session', () => {
    renderStack('zh');

    expect(screen.getByTitle('另有 2 人')).toBeTruthy();
    expect(screen.queryByTitle('2 more users')).toBeNull();
  });

  it('applies German inflection to the +N badge too', () => {
    renderStack('de', { users: users.slice(0, 4) });
    expect(screen.getByTitle('1 weiterer Benutzer')).toBeTruthy();
    cleanup();

    renderStack('de');
    expect(screen.getByTitle('2 weitere Benutzer')).toBeTruthy();
  });
});

describe('PresenceAvatars status tooltip (objectui#3440)', () => {
  it('renders name and status in English under an en session', () => {
    renderStack('en');

    expect(screen.getByTitle('Alice Chen (active)')).toBeTruthy();
    expect(screen.getByTitle('Bob Ito (idle)')).toBeTruthy();
    expect(screen.getByTitle('Carol Diaz (away)')).toBeTruthy();
  });

  /**
   * The status is a display-layer translation: the raw enum value is data and
   * stays untouched everywhere except this render exit. The bracket shape is
   * part of the translation too, so each pack owns its own spacing — `zh`
   * drops the space English puts before `(`, matching that pack's existing
   * `edited: '(已编辑)'`, instead of inheriting English-shaped glue.
   */
  it('translates the status enum for display under a zh session', () => {
    renderStack('zh');

    expect(screen.getByTitle('Alice Chen(活跃)')).toBeTruthy();
    expect(screen.getByTitle('Bob Ito(空闲)')).toBeTruthy();
    expect(screen.getByTitle('Carol Diaz(离开)')).toBeTruthy();
    // Neither the English enum value nor the English bracket glue survives.
    expect(screen.queryByTitle('Alice Chen (active)')).toBeNull();
    expect(screen.queryByTitle('Alice Chen (活跃)')).toBeNull();
  });

  it('translates the status enum under a de session', () => {
    renderStack('de');

    expect(screen.getByTitle('Alice Chen (aktiv)')).toBeTruthy();
    expect(screen.getByTitle('Bob Ito (inaktiv)')).toBeTruthy();
    expect(screen.getByTitle('Carol Diaz (abwesend)')).toBeTruthy();
  });

  /**
   * Presence users arrive from a host-supplied transport, so a status outside
   * the declared union is reachable at runtime whatever the type says. It must
   * render as ITSELF — not as an invented label, not as a raw i18n key, and
   * not as an empty bracket pair.
   */
  it('falls back to the raw value for a status outside the union', () => {
    const offUnion = {
      ...users[0],
      status: 'online' as PresenceUser['status'],
    };
    renderStack('zh', { users: [offUnion] });

    expect(screen.getByTitle('Alice Chen(online)')).toBeTruthy();
    expect(screen.queryByTitle('Alice Chen()')).toBeNull();
    expect(screen.queryByTitle(/collaboration\.status/)).toBeNull();
  });

  it('keeps the tooltip when status dots are hidden', () => {
    // `showStatus` governs the coloured dot, not the accessible copy — the
    // tooltip is the only place a status is readable at all.
    renderStack('zh', { showStatus: false });

    expect(screen.getByTitle('Alice Chen(活跃)')).toBeTruthy();
  });
});

describe('the collaboration defaults map mirrors the en pack (objectui#3440)', () => {
  /**
   * `useCollaborationTranslation`'s docblock states that
   * `COLLAB_DEFAULT_TRANSLATIONS` "must stay byte-identical to the `en` locale
   * pack's `collaboration` namespace". Nothing enforced it, and this change
   * adds eight keys to BOTH places — the exact shape that drifts. A key added
   * to only one of them is invisible at runtime: with a provider the pack
   * wins, without one the map does, so each path looks fine on its own.
   *
   * Only the `collaboration.` prefix is compared; the four `common.*` entries
   * are deliberately borrowed from the shared namespace.
   */
  it('agrees key-for-key and value-for-value with en.collaboration', () => {
    const fromMap = Object.fromEntries(
      Object.entries(COLLAB_DEFAULT_TRANSLATIONS)
        .filter(([k]) => k.startsWith('collaboration.'))
        .map(([k, v]) => [k.slice('collaboration.'.length), v]),
    );

    expect(fromMap).toEqual({ ...en.collaboration });
  });

  it('carries the presence keys this change added (the two counts as families, objectui#11445)', () => {
    for (const key of [
      'presentUserCount',
      'presentUserCount_one',
      'presentUserCount_other',
      'moreUserCount',
      'moreUserCount_one',
      'moreUserCount_other',
      'userStatusTitle',
      'statusActive',
      'statusIdle',
      'statusAway',
    ]) {
      expect(en.collaboration).toHaveProperty(key);
      expect(COLLAB_DEFAULT_TRANSLATIONS).toHaveProperty(`collaboration.${key}`);
    }
  });
});
