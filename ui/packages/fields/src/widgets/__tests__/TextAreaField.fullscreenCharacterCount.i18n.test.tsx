/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The fullscreen dialog's character-count description follows the session
 * language — objectui#3417.
 *
 * The sentence is the SAME `fields.textarea.characterCount` key the inline
 * surface has used since objectui#3406, and reusing it rather than minting a
 * `fields.textarea.fullscreenCharacterCount` twin is the point: one form-level
 * setting (`ObjectFormSchema.mobile.fullscreenLongText`) projects onto both
 * surfaces of the same field, so two copies of this copy could only drift, and
 * a twin would mean editing ten locale packs to say what they already say.
 * (Same reasoning, same shape, as objectui#3404's decision to have
 * `FullscreenFieldEditor` consume the existing `form.fullscreen.*` keys.)
 *
 * ## Why this needs its own cases at all
 *
 * `TextAreaField.characterCount.i18n.test.tsx` already pins the key and its ten
 * packs — including the load-bearing `ja` word-order case, which no code-side
 * concatenation can satisfy. What it cannot see is whether the FULLSCREEN
 * surface routes through `t()` or re-inlines an English literal on the way to a
 * node only a screen reader reads. A footer that renders
 * `Character count: 5 of 500` in a zh session looks correct to everyone who
 * could file the bug. So: a positive translated assertion AND the English
 * literal asserted absent, on the fullscreen surface specifically.
 *
 * `ja` is carried over for the same reason it exists on the inline side — its
 * pack puts the cap BEFORE the count, so an implementation that assembled the
 * sentence from parts passes a zh-only check by luck and fails here.
 *
 * The provider-LESS leg lives in `TextAreaField.fullscreenCharacterCount.test.tsx`
 * and cannot share this file: mounting `I18nProvider` installs its instance as
 * react-i18next's GLOBAL default, so after any case below there is no "no
 * provider" state left in this module graph to observe (measured in
 * objectui#3404 — cases written inside the provider file stayed GREEN under a
 * reverse check that correctly reddened a separate file).
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';

import { TextAreaField } from '../TextAreaField';
import type { FieldMetadata } from '@object-ui/types';

const fieldMeta = (extra: Record<string, unknown> = {}) =>
  ({
    name: 'description',
    label: 'Description',
    type: 'textarea',
    mobile_fullscreen: true,
    ...extra,
  }) as unknown as FieldMetadata;

/**
 * Render, open the dialog, and return the dialog textarea's accessible
 * DESCRIPTION resolved the way an assistive technology resolves it — follow
 * `aria-describedby`, concatenate the referenced nodes. Scoped to its own mount
 * and unmounted before returning: every case here renders a different language,
 * and a document-wide read after a second mount would report the FIRST one.
 */
const fullscreenDescription = (language: string, maxLength = 200, value = 'hello') => {
  const { unmount } = render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <TextAreaField value={value} onChange={vi.fn()} field={fieldMeta({ maxLength })} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByTestId('textarea-fullscreen-toggle'));

  const input = screen.getByTestId('textarea-fullscreen-input');
  const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  const text = ids
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
  const digits =
    document.querySelector('[data-testid="textarea-fullscreen-character-count"]')?.textContent ??
    null;

  unmount();
  return { text, digits };
};

describe('the fullscreen counter description is translated (objectui#3417)', () => {
  it('renders the English sentence under an en provider', () => {
    // A no-op pin: `FIELD_DEFAULTS` and the `en` pack are byte-identical, so
    // this is here to prove routing through `t()` did not change English
    // rendering. Only a positive assertion sees that direction.
    const { text, digits } = fullscreenDescription('en');

    expect(text).toBe('Character count: 5 of 200');
    expect(digits).toBe('5/200');
  });

  it('renders the sentence in Chinese under a zh provider', () => {
    const { text, digits } = fullscreenDescription('zh');

    expect(text).toBe('已输入 5 个字符，最多 200 个');
    // The literal, asserted absent — a re-inlined one would still satisfy the
    // positive assertion on a sibling case, and in a screen-reader-only string
    // nobody who can see it is affected.
    expect(text).not.toMatch(/character count/i);
    // The digits stay language-independent; only the description is keyed.
    expect(digits).toBe('5/200');
  });

  it('renders the sentence in Japanese, with the cap interpolated BEFORE the count', () => {
    // `{{max}}` precedes `{{count}}` in this pack. Code-side concatenation
    // cannot produce this order — that is the point of the assertion.
    const { text } = fullscreenDescription('ja');

    expect(text).toBe('文字数: 200 文字中 5 文字');
    expect(text.indexOf('200')).toBeLessThan(text.indexOf('5'));
    expect(text).not.toMatch(/character count/i);
  });

  it('resolves the base key under ru, whose plural rules i18next consults first', () => {
    // `count` sends i18next to `key_one` / `key_few` / … BEFORE the base key,
    // and these packs declare the base key only. A raw key reaching a
    // screen-reader-only string is invisible to everyone who could report it.
    const { text } = fullscreenDescription('ru');

    expect(text).toBe('Количество символов: 5 из 200');
    expect(text).not.toContain('fields.textarea');
  });

  it('recomputes the sentence as the DRAFT changes, not the committed value', () => {
    // Derived per render from the draft. A memo frozen at open time would keep
    // describing the value the user opened the dialog with while the digits
    // beside it moved on.
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <TextAreaField value="hello" onChange={vi.fn()} field={fieldMeta({ maxLength: 200 })} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByTestId('textarea-fullscreen-toggle'));

    const input = screen.getByTestId('textarea-fullscreen-input');
    const describedText = () => {
      const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      return ids
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
    };

    expect(describedText()).toBe('已输入 5 个字符，最多 200 个');

    fireEvent.change(input, { target: { value: 'hello world' } });

    expect(describedText()).toBe('已输入 11 个字符，最多 200 个');
  });
});
