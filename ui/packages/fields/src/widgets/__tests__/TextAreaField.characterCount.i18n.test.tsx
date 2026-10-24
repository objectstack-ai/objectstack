/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `TextAreaField`'s character counter announces itself in the session locale —
 * objectui#3406.
 *
 * The counter block is rendered only when the field declares `maxLength`, and
 * what a sighted user sees (`{n}/{max}`) is digits, so nothing about this was
 * visible on screen. The block carries `aria-live="polite"`, and its accessible
 * name was the English literal `Character count: ${n} of ${max}` — so a zh/ja/ar
 * session had an English sentence read out on every keystroke, and only screen
 * reader users could perceive it.
 *
 * Unlike objectui#3404 (keys existed, this path did not consume them), no
 * `characterCount` key existed in any of the ten packs. `fields.textarea.characterCount`
 * is new here, in all ten, with `{{count}}` / `{{max}}`.
 *
 * ## What the cases assert, and why in this shape
 *
 * - **`en` is a NO-OP pin, not a defect reproducer.** The default in
 *   `FIELD_DEFAULTS` is byte-identical to the literal it replaced, so the
 *   English case was green before this change too. It is here to prove the
 *   swap did not alter English rendering — only a positive assertion sees that
 *   direction. Its exact expected string is repeated verbatim in
 *   `TextAreaField.characterCount.no-provider.test.tsx`; together the two pin
 *   pack-default equality across a boundary the packages cannot import across.
 * - **Non-`en` positive AND English-literal negative, together.** A re-inlined
 *   literal sitting next to a translated sibling still satisfies a
 *   positive-only assertion.
 * - **`ja` carries the load-bearing ORDER check.** Its translation puts the cap
 *   BEFORE the count ("of {{max}} characters, {{count}}"). An implementation
 *   that assembled the sentence from parts in code — "label + count + separator +
 *   max" — cannot produce that order, so it passes a zh-only check by luck and
 *   fails here. This is the case that justifies one interpolated key over a
 *   per-part assembly.
 * - **`ru` and `ar` are the plural-resolution check.** `count` is not an
 *   ordinary interpolation variable to i18next: passing it activates plural
 *   lookup (`key_one` / `key_few` / `key_many` / …) BEFORE the base key. Both
 *   packs declare the base key only, and both languages have multi-form plural
 *   rules, so these two prove the base-key fallback actually resolves rather
 *   than leaving the user with a raw key. `{{count}}` is the spelling this
 *   repo already uses for counts (`table.selected`, `lookup.recordCount`), and
 *   this pins that it keeps working for a pack with no plural forms declared.
 * - **Recompute-on-input.** The name is derived per render. Pinned so a future
 *   memo cannot freeze it at the mount-time length while the visible digits
 *   move on.
 *
 * ## objectui#3408 — same key, different place, plus a sibling
 *
 * The sentence is no longer an `aria-live` region's `aria-label`. It is the
 * textarea's accessible DESCRIPTION (`aria-describedby`), read once on focus
 * instead of re-announced on every keystroke, and the cases above resolve it
 * through that association. The expected strings did not change: the ten packs
 * still serve them, and this file still guards the same drift (backfilled
 * English, a code-assembled sentence that cannot reproduce ja's word order, a
 * raw key surfacing where plural lookup fails).
 *
 * `fields.textarea.charactersRemaining` is the sibling #3408 added — the only
 * thing the widget still SPEAKS while typing, and therefore the one the
 * English-backfill risk now applies to. Its cases sit at the bottom, with fake
 * timers, because reaching it requires crossing the near-limit threshold and
 * then pausing.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';

import { TextAreaField } from '../TextAreaField';
import type { FieldMetadata } from '@object-ui/types';

const textareaField = (extra: Record<string, unknown> = {}) =>
  ({ name: 'notes', type: 'textarea', ...extra }) as unknown as FieldMetadata;

function renderIn(language: string, element: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {element}
    </I18nProvider>,
  );
}

/**
 * Where the sentence lives moved in objectui#3408: it was the `aria-label` of
 * the visible counter, which was ALSO the `aria-live` region — so the whole
 * sentence was re-announced on every keystroke. It is now the textarea's
 * accessible DESCRIPTION, read once when focus lands.
 *
 * These helpers therefore resolve it the way an assistive technology does —
 * follow `aria-describedby`, concatenate the referenced nodes — instead of
 * reading an attribute off a node found by selector. That keeps the
 * ASSOCIATION under assertion here too, and it is why the cases below did not
 * need their expected strings changed: the same ten-pack key still produces
 * them, in a place a screen reader reaches without typing.
 *
 * The digits stay queryable separately (`visibleCounter`) because several
 * cases assert that the visible half is unchanged. The behaviour half of
 * #3408 — how often the live region speaks — is pinned in
 * `TextAreaField.characterCount.announcements.test.tsx`.
 */
const visibleCounter = () => document.querySelector('[data-testid="textarea-character-count"]');
const describedText = () => {
  const box = screen.getByRole('textbox');
  const ids = (box.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
};

describe('TextAreaField character counter is translated (objectui#3406)', () => {
  it('renders the English sentence under an en provider', () => {
    renderIn(
      'en',
      <TextAreaField value="hello" onChange={vi.fn()} field={textareaField({ maxLength: 200 })} />,
    );

    // Byte-identical to the literal this replaced, so `en` is a no-op change.
    expect(describedText()).toBe('Character count: 5 of 200');
    expect(visibleCounter()).toHaveTextContent('5/200');
  });

  it('renders the sentence in Chinese under a zh provider', () => {
    renderIn(
      'zh',
      <TextAreaField value="hello" onChange={vi.fn()} field={textareaField({ maxLength: 200 })} />,
    );

    expect(describedText()).toBe('已输入 5 个字符，最多 200 个');
    // The literal, asserted absent — a re-inlined one would still satisfy a
    // positive-only check on a sibling case.
    expect(describedText()).not.toMatch(/character count/i);
    // The digits stay language-independent; only the accessible name moved.
    expect(visibleCounter()).toHaveTextContent('5/200');
  });

  it('renders the sentence in Japanese, with the cap interpolated BEFORE the count', () => {
    renderIn(
      'ja',
      <TextAreaField value="hello" onChange={vi.fn()} field={textareaField({ maxLength: 200 })} />,
    );

    // `{{max}}` precedes `{{count}}` in this pack. Code-side concatenation
    // cannot produce this order — that is the point of the assertion.
    expect(describedText()).toBe('文字数: 200 文字中 5 文字');
    expect(describedText()!.indexOf('200')).toBeLessThan(describedText()!.indexOf('5'));
    expect(describedText()).not.toMatch(/character count/i);
  });

  it('resolves the base key under ru, whose plural rules i18next consults first', () => {
    renderIn(
      'ru',
      <TextAreaField value="hello" onChange={vi.fn()} field={textareaField({ maxLength: 200 })} />,
    );

    expect(describedText()).toBe('Количество символов: 5 из 200');
    // The failure this guards: plural lookup missing and no base-key fallback
    // would surface the raw key instead of a sentence.
    expect(describedText()).not.toContain('fields.textarea');
  });

  it('resolves the base key under ar as well', () => {
    renderIn(
      'ar',
      <TextAreaField value="hello" onChange={vi.fn()} field={textareaField({ maxLength: 200 })} />,
    );

    expect(describedText()).toBe('عدد الأحرف: 5 من 200');
    expect(describedText()).not.toContain('fields.textarea');
  });

  it('recomputes the spoken count as the user types', () => {
    // Derived per render, not memoized at mount. A frozen name would keep
    // announcing "5" while the visible digits read 11.
    const Host = () => {
      const [v, setV] = React.useState('hello');
      return <TextAreaField value={v} onChange={setV} field={textareaField({ maxLength: 200 })} />;
    };
    renderIn('zh', <Host />);
    expect(describedText()).toBe('已输入 5 个字符，最多 200 个');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello world' } });

    expect(describedText()).toBe('已输入 11 个字符，最多 200 个');
    expect(visibleCounter()).toHaveTextContent('11/200');
  });

  it('reads the spec maxLength only — the retired snake_case max_length draws no counter (objectui#11070)', () => {
    // The widget dual-read `maxLength ?? max_length` from framework#1878 §3
    // until objectui#11070 retired the snake_case spelling: the spec refuses it
    // by name and `TextareaFieldMetadata` declares `maxLength` alone.
    renderIn(
      'zh',
      <TextAreaField value="hello" onChange={vi.fn()} field={textareaField({ max_length: 80 })} />,
    );

    expect(visibleCounter()).toBeNull();
  });

  it('renders no counter at all when the field declares no maxLength', () => {
    // The block is `{maxLength && …}`. Translating it must not make it
    // unconditional — an always-present live region would announce on every
    // keystroke in every long-text field in the app.
    renderIn('zh', <TextAreaField value="hello" onChange={vi.fn()} field={textareaField()} />);

    expect(visibleCounter()).toBeNull();
  });

  it('renders no counter in the readonly branch', () => {
    // The translation hook had to move ABOVE the readonly early return
    // (rules-of-hooks). This pins that the hoist changed nothing a user sees
    // on that branch.
    renderIn(
      'zh',
      <TextAreaField
        value="hello"
        onChange={vi.fn()}
        readonly
        field={textareaField({ maxLength: 200 })}
      />,
    );

    expect(visibleCounter()).toBeNull();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});

/**
 * The near-limit warning — the sentence that IS spoken mid-typing
 * (objectui#3408). Reaching it needs the value inside the last 10% / 20
 * characters of the cap AND a pause, so these render already-near-full values
 * and advance fake timers rather than typing 490 characters.
 */
describe('TextAreaField near-limit warning is translated (objectui#3408)', () => {
  afterEach(() => vi.useRealTimers());

  // Scoped to its own container and unmounted before returning: some cases
  // call this twice, and a document-wide query would read the FIRST mount's
  // region — green for the previous language, not the one under test.
  const nearLimit = (language: string) => {
    vi.useFakeTimers();
    const { container, unmount } = renderIn(
      language,
      <TextAreaField value={'x'.repeat(190)} onChange={vi.fn()} field={textareaField({ maxLength: 200 })} />,
    );
    act(() => { vi.advanceTimersByTime(1000); });
    const spoken = container.querySelector('[aria-live="polite"]')?.textContent ?? '';
    unmount();
    vi.useRealTimers();
    return spoken;
  };

  it('renders the English sentence under an en provider', () => {
    expect(nearLimit('en')).toBe('Characters remaining: 10');
  });

  it('renders the sentence in Chinese under a zh provider', () => {
    expect(nearLimit('zh')).toBe('还可输入 10 个字符');
    // A backfilled English string is invisible at runtime — the whole defect
    // class is English reaching a non-English screen reader.
    expect(nearLimit('zh')).not.toMatch(/characters remaining/i);
  });

  it('renders the sentence in Japanese', () => {
    expect(nearLimit('ja')).toBe('残り 10 文字');
  });

  it('resolves the base key under ru and ar, whose plural rules i18next consults first', () => {
    // Same mechanism as `characterCount` above: `count` sends i18next to
    // `key_one` / `key_few` / … before the base key, and these packs declare
    // the base key only. A raw key reaching a screen-reader-only string is
    // invisible to everyone who could report it.
    expect(nearLimit('ru')).toBe('Осталось символов: 10');
    expect(nearLimit('ar')).toBe('الأحرف المتبقية: 10');
    expect(nearLimit('ru')).not.toContain('fields.textarea');
    expect(nearLimit('ar')).not.toContain('fields.textarea');
  });
});

// The provider-LESS leg lives in `TextAreaField.characterCount.no-provider.test.tsx`.
// It cannot share this file: mounting `I18nProvider` installs its instance as
// react-i18next's GLOBAL default, so after any case above there is no "no
// provider" state left in this module graph to observe (measured in
// objectui#3404 — see that file's header).
