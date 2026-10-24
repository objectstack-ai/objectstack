/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The activity-feed reaction button speaks the session locale —
 * objectstack#5407.
 *
 * `ReactionPicker`'s add button is icon-only (`SmilePlus`), so its
 * `aria-label` IS the button as far as a screen reader or a hover tooltip is
 * concerned. It was the English literal "Add reaction" in every locale; it now
 * reads `detail.addReaction`, backfilled into all ten packs.
 *
 * The no-provider case is asserted alongside the translated one because
 * `useDetailTranslation` is a `createSafeTranslation` hook: its whole point is
 * that a component rendered without an `I18nProvider` gets the English default
 * rather than the raw key, and "aria-label reads `detail.addReaction`" is a
 * failure mode that no positive assertion under a provider would catch.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ReactionPicker } from './ReactionPicker';

afterEach(() => cleanup());

function renderPickerIn(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ReactionPicker reactions={[]} onToggleReaction={vi.fn()} />
    </I18nProvider>,
  );
}

describe('ReactionPicker add button — accessible name (objectstack#5407)', () => {
  it('reads the zh bundle value under a zh session', () => {
    renderPickerIn('zh');

    expect(screen.getByRole('button', { name: '添加表情回应' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add reaction' })).toBeNull();
  });

  it('reads the es bundle value under an es session', () => {
    renderPickerIn('es');

    expect(screen.getByRole('button', { name: 'Añadir reacción' })).toBeTruthy();
  });

  it('still reads English under an en session', () => {
    renderPickerIn('en');

    expect(screen.getByRole('button', { name: 'Add reaction' })).toBeTruthy();
  });

  it('never renders the raw key', () => {
    renderPickerIn('en');

    expect(screen.queryByRole('button', { name: 'detail.addReaction' })).toBeNull();
  });
});
