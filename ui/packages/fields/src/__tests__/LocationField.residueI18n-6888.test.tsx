/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6888 — `LocationField`'s THIRD refusal sentence reaches the packs.
 *
 * objectui#6755 ruled that a widget's own refusal sentence goes through
 * `useFieldTranslation` + `FIELD_DEFAULTS`, and named three sentences. The
 * residue arm (`12abc, 34` — a half that is only PARTLY a number) landed from
 * objectui#6715 AFTER that ruling was written, so it was outside the count and
 * stayed a literal. Triage ruled applying the same principle to it in-lane
 * execution rather than a new adjudication.
 *
 * The consequence this file pins is not "one more English string": all three
 * arms render through the SAME `<p>` and the same `refusalError`, so one line
 * spoke the reader's language on two arms and English on the third —
 * objectui#4028's shape ("four Chinese labels around one English one")
 * compressed into a single sentence position.
 *
 * ## ⭐ The arity question this arm had to answer, and what is asserted about it
 *
 * The other two sentences have no grammatical number. This one did: `verb` was
 * `is not a number` / `are not numbers`, chosen in TypeScript. Passing that
 * through a `{{hole}}` hands a pack an English verb form it cannot inflect
 * around — Arabic has a DUAL, and two halves is exactly the case where it
 * applies.
 *
 * The answer taken, and asserted below, is this repo's OWN plural convention:
 * two SIBLING keys picked at the call site (`refusedResidue` /
 * `refusedResidueOne`), ⛔ not an i18next `_one`/`_other` family. The precedent
 * followed is `RecordPickerDialog`'s `lookup.recordCount` / `recordCountOne` —
 * the same package, the same `FIELD_DEFAULTS` map — with
 * `list.recordCount`/`recordCountOne` and `detail.reactionCount`/
 * `reactionCountOne` as the same shape elsewhere. `ReactionPicker` states the
 * reason in source: zh/ja/ko have no separate singular form, would legitimately
 * omit a `_one` half, and `all-locales-key-parity` reads that as a missing key.
 *
 * ⭐ `ARITY_IS_IN_THE_VALUE` below is the assertion that distinguishes this
 * answer from the one that was NOT taken. If the verb were a hole, every pack's
 * two sentences would differ only where the widget substituted an English word,
 * and `ar`'s dual could not exist at all. So the test demands that each pack's
 * one-half and two-half sentences differ in their own script — and pins the
 * Arabic dual (`ليسا رقمين`) by name.
 *
 * ## Shape inherited from `widget-diagnostics-i18n-6755.test.tsx`
 *
 * - **Positive AND negative together.** `createSafeTranslation` falls back to
 *   `FIELD_DEFAULTS[key]`, which is byte-identical to the literal it replaced —
 *   so a pack that resolves NOTHING renders exactly what the hard-coded string
 *   used to. Only "says the translated thing" plus "no English survives"
 *   separates keyed from still-hard-coded.
 * - **A positive control for the pack read, in this run.** `AddressField`'s
 *   `fields.address.*` keys were keyed by objectui#4028; if the provider were
 *   dead, that control fails too and no negative assertion here could be read
 *   as a pass.
 * - **`en` and provider-less are NO-OP pins.** The English values are
 *   byte-identical to the literal, which is why objectui#6715's own
 *   `LocationField.strictNumeric.test.tsx` and `plugin-form`'s
 *   `ObjectForm.locationResidue.test.tsx` are untouched by this card. Asserting
 *   them here states that as a fact of THIS change rather than a hope.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

import { LocationField } from '../widgets/LocationField';
import { AddressField } from '../widgets/AddressField';

const locationField = { name: 'site', label: 'Site', type: 'location' } as any;
const addressField = { name: 'billing_address', type: 'address' } as any;

/** Text whose FIRST half is a number with residue after it; the second is clean. */
const ONE_HALF = '12abc, 34';
/** Text whose SECOND half is the offending one — the other order. */
const OTHER_HALF = '30.27, 120abc';
/** Text where BOTH halves carry residue. */
const BOTH_HALVES = '12abc, 34xyz';

/** The English sentences this card keyed — byte-identical to the old literal. */
const EN_ONE_HALF =
  'Not saved: latitude "12abc" is not a number. Enter plain decimals (example: 30.2741, 120.1551).';
const EN_OTHER_HALF =
  'Not saved: longitude "120abc" is not a number. Enter plain decimals (example: 30.2741, 120.1551).';
const EN_BOTH_HALVES =
  'Not saved: latitude "12abc" and longitude "34xyz" are not numbers. ' +
  'Enter plain decimals (example: 30.2741, 120.1551).';

/**
 * English fragments that must NOT survive a translated render.
 *
 * The verb and the conjunction are the grammar the old implementation chose in
 * TypeScript; the two nouns are the words it never let a pack see. All four are
 * the defect, so all four are asserted absent rather than just the sentence.
 */
const ENGLISH_FRAGMENTS = ['is not a number', 'are not numbers', ' and ', 'latitude', 'longitude'];

function renderIn(language: string, element: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {element}
    </I18nProvider>,
  );
}

/** The widget's own diagnostic line, or `null` when it announces nothing. */
function diagnostic(container: HTMLElement): string | null {
  const p = container.querySelector('p');
  return p ? p.textContent : null;
}

function typeInto(container: HTMLElement, text: string) {
  fireEvent.change(container.querySelector('input') as HTMLElement, { target: { value: text } });
}

/** Render `text` into a fresh widget under `language` and read the diagnostic. */
function refusalIn(language: string | null, text: string): string | null {
  const element = <LocationField value={null} onChange={vi.fn()} field={locationField} />;
  const { container } = language === null ? render(element) : renderIn(language, element);
  typeInto(container, text);
  return diagnostic(container);
}

beforeEach(() => {
  cleanup();
});

/* -------------------------------------------------------------------------- */
/* The control: a key that ALREADY resolves through this channel.              */
/* -------------------------------------------------------------------------- */

describe('the locale channel is live in this run (control for objectui#6888)', () => {
  it('resolves fields.address.* — keyed by objectui#4028 — under zh', () => {
    // Without this, a blank or English diagnostic below would be a dead
    // provider rather than a missing key, and every negative assertion in this
    // file would pass for the wrong reason.
    renderIn('zh', <AddressField value={{}} onChange={vi.fn()} field={addressField} />);
    expect(screen.getByLabelText('街道地址')).toBeInTheDocument();
    expect(screen.getByLabelText('城市')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* English is byte-identical — the claim #6715's and plugin-form's pins rest on. */
/* -------------------------------------------------------------------------- */

describe('the English default is byte-identical after keying (objectui#6888)', () => {
  it.each([
    ['one half', ONE_HALF, EN_ONE_HALF],
    ['the other half', OTHER_HALF, EN_OTHER_HALF],
    ['both halves', BOTH_HALVES, EN_BOTH_HALVES],
  ])('renders the same sentence for %s under an en provider', (_label, typed, expected) => {
    expect(refusalIn('en', typed)).toBe(expected);
  });

  it.each([
    ['one half', ONE_HALF, EN_ONE_HALF],
    ['the other half', OTHER_HALF, EN_OTHER_HALF],
    ['both halves', BOTH_HALVES, EN_BOTH_HALVES],
  ])('renders the same sentence for %s with NO provider at all', (_label, typed, expected) => {
    expect(refusalIn(null, typed)).toBe(expected);
  });

  it('still names only the offending half, as objectui#6715 requires', () => {
    // The half-selection rule is the widget's, not the locale's: keying the
    // sentence must not start naming a coordinate that parsed cleanly.
    expect(refusalIn('en', OTHER_HALF)).not.toContain('latitude');
    expect(refusalIn('en', ONE_HALF)).not.toContain('longitude');
  });
});

/* -------------------------------------------------------------------------- */
/* The reader's language, on BOTH arities, with no English left behind.        */
/* -------------------------------------------------------------------------- */

describe('the residue refusal speaks the reader\'s language (objectui#6888)', () => {
  it.each([
    ['zh', '未保存：纬度“12abc”不是数字。请输入普通小数（例如 30.2741, 120.1551）。'],
    ['ja', '保存されていません: 緯度「12abc」は数値ではありません。通常の小数で入力してください（例: 30.2741, 120.1551）。'],
    ['ar', 'لم يتم الحفظ: خط العرض «12abc» ليس رقمًا. أدخل أرقامًا عشرية عادية (مثال: 30.2741, 120.1551).'],
  ])('says the ONE-half refusal in %s', (language, expected) => {
    expect(refusalIn(language, ONE_HALF)).toBe(expected);
  });

  it.each([
    ['zh', '未保存：纬度“12abc”和经度“34xyz”不是数字。请输入普通小数（例如 30.2741, 120.1551）。'],
    ['ja', '保存されていません: 緯度「12abc」と経度「34xyz」は数値ではありません。通常の小数で入力してください（例: 30.2741, 120.1551）。'],
    ['ar', 'لم يتم الحفظ: خط العرض «12abc» وخط الطول «34xyz» ليسا رقمين. أدخل أرقامًا عشرية عادية (مثال: 30.2741, 120.1551).'],
  ])('says the TWO-half refusal in %s', (language, expected) => {
    expect(refusalIn(language, BOTH_HALVES)).toBe(expected);
  });

  it.each([
    ['zh', ONE_HALF],
    ['zh', BOTH_HALVES],
    ['ja', ONE_HALF],
    ['ja', BOTH_HALVES],
    ['ar', ONE_HALF],
    ['ar', BOTH_HALVES],
  ])('leaves no English grammar behind in %s for %s', (language, typed) => {
    const message = refusalIn(language, typed) ?? '';
    // The negative half of the pair. `createSafeTranslation` renders the
    // English default when a key does not resolve, so this is what tells a
    // keyed sentence from a still-hard-coded one.
    for (const fragment of ENGLISH_FRAGMENTS) {
      expect(message, `${language} kept the English fragment "${fragment}"`).not.toContain(fragment);
    }
    // The typed text and the example coordinates DO stay ASCII: one is what
    // the person wrote, the other is what the box asks them to type.
    expect(message).toContain('30.2741, 120.1551');
    expect(message).toContain('12abc');
  });
});

/* -------------------------------------------------------------------------- */
/* ⭐ The arity answer itself, asserted against the design NOT taken.           */
/* -------------------------------------------------------------------------- */

describe('arity lives in the pack VALUE, not in a hole (objectui#6888)', () => {
  const LANGS = ['en', 'zh', 'ja', 'ko', 'de', 'es', 'fr', 'pt', 'ru', 'ar'] as const;

  /**
   * One pack's `fields.location` block, READ THROUGH ITS REAL TYPE.
   *
   * ⛔ Deliberately not `(builtInLocales as any)[lang]`. `builtInLocales` is an
   * `as const` object, so typing the access makes a renamed or dropped key a
   * COMPILE error in `type-check` rather than a runtime miss that a `?.` or a
   * `toContain` on `undefined` could swallow.
   */
  const locationPack = (lang: (typeof LANGS)[number]) => builtInLocales[lang].fields.location;

  it('gives every pack two SIBLING keys, not an i18next _one/_other family', () => {
    // `_one` would be a key `en` could carry and zh/ja/ko could not, which
    // `all-locales-key-parity` fails by design (objectstack#5430); the suffix
    // form would also need a base key for the categories no pack enumerates
    // (ru few/many, ar two/zero — objectui#3863).
    for (const lang of LANGS) {
      const location = locationPack(lang);
      expect(Object.keys(location), `${lang}`).toEqual(
        expect.arrayContaining(['refusedResidue', 'refusedResidueOne', 'latitude', 'longitude']),
      );
      expect(Object.keys(location).filter((k) => k.includes('_one') || k.includes('_other'))).toEqual([]);
    }
  });

  it('lets each pack inflect its own verb — the two arities differ in every language', () => {
    // ⭐ THE assertion that separates the answer taken from the rejected one.
    // With `verb` as a hole, both values would be one sentence and the
    // difference would be an English word the widget substituted.
    for (const lang of LANGS) {
      const location = locationPack(lang);
      const one = location.refusedResidueOne.replace(/\{\{\w+\}\}/g, '');
      const two = location.refusedResidue.replace(/\{\{\w+\}\}/g, '');
      expect(one, `${lang} states both arities identically`).not.toBe(two);
    }
  });

  it('lets ar use its DUAL, which an English verb hole could not express', () => {
    // Arabic distinguishes two from many. Two halves is exactly two, so the
    // dual is the correct form and it exists only because the whole sentence —
    // verb included — is the pack's to write.
    expect(locationPack('ar').refusedResidue).toContain('ليسا رقمين');
    expect(locationPack('ar').refusedResidueOne).toContain('ليس رقمًا');
  });

  it('keys each coordinate noun ONCE, so no pack holds two spellings of it', () => {
    // The nouns are interpolated into both arities from a single key rather
    // than written into each sentence, which is why `fields.location.latitude`
    // exists at all.
    for (const lang of LANGS) {
      const location = locationPack(lang);
      expect(location.refusedResidueOne, `${lang}`).toContain('{{name}}');
      expect(location.refusedResidue, `${lang}`).toContain('{{name}}');
      expect(location.refusedResidue, `${lang}`).toContain('{{otherName}}');
      expect(typeof location.latitude).toBe('string');
      expect(typeof location.longitude).toBe('string');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Keying the sentence changed the sentence only.                              */
/* -------------------------------------------------------------------------- */

describe('the refusal itself is unchanged by keying it (objectui#6888)', () => {
  it('still refuses the value it announced about, under a translated provider', () => {
    const onChange = vi.fn();
    const { container } = renderIn('zh', <LocationField value={null} onChange={onChange} field={locationField} />);
    typeInto(container, BOTH_HALVES);
    // objectui#6715's rule, inherited rather than re-decided here.
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('input')).toHaveAttribute('aria-invalid', 'true');
    // The refused text stays in the box so the message has something to point at.
    expect(container.querySelector('input')).toHaveValue(BOTH_HALVES);
  });

  it('shares ONE diagnostic element with the other two arms', () => {
    // The reason this card exists: a second `<p>` would have made the mixed
    // languages two separate lines rather than one, and far less confusing.
    const { container } = renderIn('zh', <LocationField value={null} onChange={vi.fn()} field={locationField} />);
    typeInto(container, 'not a coordinate');
    expect(container.querySelectorAll('p')).toHaveLength(1);
    typeInto(container, BOTH_HALVES);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    // Both arms now speak the same language in that one element.
    expect(diagnostic(container)).toContain('未保存：');
  });
});
