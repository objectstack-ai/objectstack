/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The activity-feed reaction chrome speaks the session locale —
 * objectstack#5430.
 *
 * Two names were still English literals after #5407 fixed `detail.addReaction`:
 *   - the picker popup's `role="listbox"` name ("Emoji picker")
 *   - each reaction chip's name, which was built by string concatenation with
 *     English pluralization baked in:
 *     `${emoji} ${count} reaction${count !== 1 ? 's' : ''}`
 *
 * The chip renders only an emoji and a bare number, so that label IS the
 * button to a screen reader.
 *
 * The plural one uses this repo's TWO-KEY convention
 * (`detail.reactionCount` / `detail.reactionCountOne`, mirroring
 * `detail.relatedRecords`/`relatedRecordOne` and
 * `lookup.recordCount`/`recordCountOne`) — deliberately NOT an i18next
 * `_one`/`_other` pair, which `all-locales-key-parity` would reject: zh/ja/ko
 * have no separate singular form, so those packs would legitimately omit the
 * `_one` half and the gate would read that as a lost key.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ReactionPicker } from '../ReactionPicker';

/** count === 1 takes the `…One` key; count !== 1 takes the plural key. */
const reactions = [
  { emoji: '👍', count: 3, reacted: false },
  { emoji: '🎉', count: 1, reacted: true },
];

function renderPickerIn(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ReactionPicker reactions={reactions as any} onToggleReaction={() => {}} />
    </I18nProvider>,
  );
}

afterEach(() => cleanup());

describe('ReactionPicker chip label — two-key plural (objectstack#5430)', () => {
  it('still reads English under an en session, both keys', () => {
    renderPickerIn('en');

    // plural key — detail.reactionCount
    expect(screen.getByRole('button', { name: '👍 3 reactions' })).toBeTruthy();
    // singular key — detail.reactionCountOne
    expect(screen.getByRole('button', { name: '🎉 1 reaction' })).toBeTruthy();
  });

  it('reads the es bundle values under an es session, both keys', () => {
    renderPickerIn('es');

    expect(screen.getByRole('button', { name: '👍 3 reacciones' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '🎉 1 reacción' })).toBeTruthy();
    // The literals this replaced.
    expect(screen.queryByRole('button', { name: '👍 3 reactions' })).toBeNull();
    expect(screen.queryByRole('button', { name: '🎉 1 reaction' })).toBeNull();
  });

  it('reads the zh bundle value under a zh session (single form for both counts)', () => {
    renderPickerIn('zh');

    // zh has no separate singular — both keys carry the same phrasing, which is
    // exactly why the `_one`/`_other` suffix scheme is wrong for this repo.
    expect(screen.getByRole('button', { name: '👍 3 个回应' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '🎉 1 个回应' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '👍 3 reactions' })).toBeNull();
  });
});

describe('ReactionPicker popup — accessible name (objectstack#5430)', () => {
  function openPicker(language: string) {
    renderPickerIn(language);
    // The trigger is `detail.addReaction` (already localized by #5407), so its
    // name is locale-dependent — address it by DOM order instead: the chips
    // render first, the add-reaction trigger last.
    const triggers = screen.getAllByRole('button');
    fireEvent.click(triggers[triggers.length - 1]);
  }

  it('still reads English under an en session', () => {
    openPicker('en');

    expect(screen.getByRole('listbox', { name: 'Emoji picker' })).toBeTruthy();
  });

  it('reads the ja bundle value under a ja session', () => {
    openPicker('ja');

    expect(screen.getByRole('listbox', { name: '絵文字ピッカー' })).toBeTruthy();
    expect(screen.queryByRole('listbox', { name: 'Emoji picker' })).toBeNull();
  });

  it('reads the fr bundle value under a fr session', () => {
    openPicker('fr');

    expect(screen.getByRole('listbox', { name: "Sélecteur d'émojis" })).toBeTruthy();
    expect(screen.queryByRole('listbox', { name: 'Emoji picker' })).toBeNull();
  });
});
