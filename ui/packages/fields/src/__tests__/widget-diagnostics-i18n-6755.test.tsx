/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6755 — a widget's OWN refusal sentence must reach the locale packs.
 *
 * `ObjectField` and `LocationField` each render a diagnostic they author
 * themselves — the widget's answer to input it refused — and each was a string
 * literal in the source while the same package carried a locale channel that 11
 * of its 55 widgets already used. So, in the card's words, *"a zh / ja / ar user
 * who mistypes a coordinate or a JSON blob is told why in English, inside a
 * product whose labels, gate hints and validation copy are all translated"*. The
 * defect is not that the string is English (AGENTS.md #-1 requires exactly that
 * in the codebase); it is that a translatable surface was never routed through
 * the channel that already existed beside it.
 *
 * Ruled 2026-08-29 by the maintainer: key them, ten pack entries each, bound
 * from then on by `check:i18n-drift`. Scope is those THREE sentences — see
 * "What is deliberately NOT here" below.
 *
 * ## What each group asserts, and why in this shape
 *
 * - **Non-`en` positive AND English-literal negative, together.** A positive-only
 *   assertion cannot tell a keyed sentence from one that fell back to English,
 *   because the fallback IS the English sentence — `createSafeTranslation`
 *   resolves `defaults[key]` when a pack has no entry, so a missing pack value
 *   renders exactly what the hard-coded literal used to render. Only the pair
 *   distinguishes "keyed" from "still hard-coded".
 * - **`en` and provider-less are NO-OP pins, not defect reproducers.** The three
 *   pack values are byte-identical to the literals they replace, so English was
 *   green before this change too. Only a positive assertion can see that the swap
 *   left English alone — and provider-less rendering is what the widget tests of
 *   objectui#6716 / #6715 and `plugin-form`'s two refusal suites all measure.
 * - **A POSITIVE CONTROL for the pack read, in this same file.** Every negative
 *   assertion here ("no English survives") is satisfied by a widget that renders
 *   NOTHING, and every positive one by a pack that happens to be loaded. So one
 *   test renders `AddressField`, whose `fields.address.*` keys already resolve
 *   through this very channel (objectui#4028), and asserts its Chinese labels in
 *   the same run: if the provider or the packs were not live, that control fails
 *   too, and a blank or English result here cannot be read as a pass.
 * - **The RANGE arm's `{{detail}}` stays the spec's own words.** The widget
 *   builds that sentence from `LocationValueSchema`'s issues, deliberately
 *   (objectui#6714/#6716: a hand-copied bound is a second contract). Keying it
 *   therefore keys the FRAME — the part this widget authors — and the interpolated
 *   detail remains whatever the spec says. The zh assertion below pins exactly
 *   that division rather than pretending the whole sentence is translated.
 *
 * ## What is deliberately NOT here
 *
 * `LocationField`'s THIRD refusal sentence — the residue arm added by
 * objectui#6715 after this card was filed and after the ruling was written — is
 * still a hard-coded literal. The ruling locks scope to the three sentences it
 * names, so it is reported rather than fixed here, and no assertion in this file
 * pins its English text: pinning it would read as endorsement of the state the
 * follow-up card exists to remove.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { valueSchemaFor } from '@objectstack/spec/data';

import { ObjectField } from '../widgets/ObjectField';
import { LocationField } from '../widgets/LocationField';
import { AddressField } from '../widgets/AddressField';

const LOCATION_SCHEMA = valueSchemaFor({ type: 'location' } as any)!;

const jsonField = { name: 'payload', label: 'Payload', type: 'object' } as any;
const locationField = { name: 'site', label: 'Site', type: 'location' } as any;
const addressField = { name: 'billing_address', type: 'address' } as any;

/** The English sentences this card keyed — the literals that used to be inline. */
const EN_INVALID_JSON = 'Invalid JSON';
const EN_REFUSED_FORMAT =
  'Not saved: enter a latitude, longitude pair (example: 30.2741, 120.1551).';
/** The frame of the range arm; `{{detail}}` is the spec's own complaint. */
const EN_RANGE_PREFIX = 'Not saved: ';

/**
 * What the SPEC says about a pair. Same oracle as
 * `LocationField.refusalDiagnostic.test.tsx`: never the literal bounds, which
 * would be a second contract that keeps passing on the day the schema moves.
 */
function specDetail(pair: unknown): string {
  const parsed = LOCATION_SCHEMA.safeParse(pair);
  if (parsed.success) throw new Error('specDetail called on a pair the spec ACCEPTS');
  return parsed.error.issues
    .map((i: any) => `${i.path.join('.') || 'value'}: ${i.message}`)
    .join('; ');
}

/** Mount inside a provider pinned to one language, the way #4028's suite does. */
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
  const control = container.querySelector('textarea') ?? container.querySelector('input');
  fireEvent.change(control as HTMLElement, { target: { value: text } });
}

beforeEach(() => {
  cleanup();
});

/* -------------------------------------------------------------------------- */
/* The control: a key that ALREADY resolves through this channel.              */
/* -------------------------------------------------------------------------- */

describe('the locale channel is live in this run (control for objectui#6755)', () => {
  it('resolves fields.address.* — a key keyed before this card — under zh', () => {
    // If this fails, nothing else in this file means anything: a blank or
    // English diagnostic below would be a dead provider, not a missing key.
    renderIn('zh', <AddressField value={{}} onChange={vi.fn()} field={addressField} />);
    expect(screen.getByLabelText('街道地址')).toBeInTheDocument();
    expect(screen.getByLabelText('城市')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* ObjectField — "Invalid JSON".                                               */
/* -------------------------------------------------------------------------- */

describe('ObjectField announces an unparsable draft in the reader\'s language (objectui#6755)', () => {
  it('keeps the English sentence byte-identical under an en provider', () => {
    const { container } = renderIn('en', <ObjectField value={null} onChange={vi.fn()} field={jsonField} />);
    typeInto(container, '{ not json');
    expect(diagnostic(container)).toBe(EN_INVALID_JSON);
  });

  it('keeps the English sentence byte-identical with NO provider at all', () => {
    const { container } = render(<ObjectField value={null} onChange={vi.fn()} field={jsonField} />);
    typeInto(container, '{ not json');
    expect(diagnostic(container)).toBe(EN_INVALID_JSON);
  });

  it.each([
    ['zh', 'JSON 无效'],
    ['ja', 'JSON が不正です'],
    ['ar', 'JSON غير صالح'],
  ])('says it in %s, with no English literal left behind', (language, expected) => {
    const { container } = renderIn(language, <ObjectField value={null} onChange={vi.fn()} field={jsonField} />);
    typeInto(container, '{ not json');
    expect(diagnostic(container)).toBe(expected);
    // The negative half: the fallback renders the English literal, so a
    // positive-only assertion could not tell a keyed value from a missing one.
    expect(container.textContent).not.toContain(EN_INVALID_JSON);
  });
});

/* -------------------------------------------------------------------------- */
/* LocationField — the FORMAT refusal.                                          */
/* -------------------------------------------------------------------------- */

describe('LocationField announces a FORMAT refusal in the reader\'s language (objectui#6755)', () => {
  it('keeps the English sentence byte-identical under an en provider', () => {
    const { container } = renderIn('en', <LocationField value={null} onChange={vi.fn()} field={locationField} />);
    typeInto(container, 'not a coordinate');
    expect(diagnostic(container)).toBe(EN_REFUSED_FORMAT);
  });

  it('keeps the English sentence byte-identical with NO provider at all', () => {
    const { container } = render(<LocationField value={null} onChange={vi.fn()} field={locationField} />);
    typeInto(container, 'not a coordinate');
    expect(diagnostic(container)).toBe(EN_REFUSED_FORMAT);
  });

  it.each([
    ['zh', '未保存：请输入纬度, 经度坐标对（例如 30.2741, 120.1551）。'],
    ['ja', '保存されていません: 緯度, 経度 の組で入力してください（例: 30.2741, 120.1551）。'],
    ['ar', 'لم يتم الحفظ: أدخل زوجًا من خط العرض وخط الطول (مثال: 30.2741, 120.1551).'],
  ])('says it in %s, with no English literal left behind', (language, expected) => {
    const { container } = renderIn(language, <LocationField value={null} onChange={vi.fn()} field={locationField} />);
    typeInto(container, 'not a coordinate');
    expect(diagnostic(container)).toBe(expected);
    expect(container.textContent).not.toContain(EN_REFUSED_FORMAT);
    // The example coordinates stay ASCII digits in every pack: they are what
    // the box asks the person to TYPE, not prose.
    expect(diagnostic(container)).toContain('30.2741, 120.1551');
  });

  it('still refuses the value it announced about', () => {
    const onChange = vi.fn();
    const { container } = renderIn('zh', <LocationField value={null} onChange={onChange} field={locationField} />);
    typeInto(container, 'not a coordinate');
    // objectui#6714/#6716's rule, unchanged by keying the sentence.
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('input')).toHaveAttribute('aria-invalid', 'true');
  });
});

/* -------------------------------------------------------------------------- */
/* LocationField — the RANGE refusal (frame keyed, spec detail interpolated).    */
/* -------------------------------------------------------------------------- */

describe('LocationField announces a RANGE refusal in the reader\'s language (objectui#6755)', () => {
  it('keeps the English sentence byte-identical under an en provider', () => {
    const { container } = renderIn('en', <LocationField value={null} onChange={vi.fn()} field={locationField} />);
    typeInto(container, '999, 999');
    expect(diagnostic(container)).toBe(EN_RANGE_PREFIX + specDetail({ lat: 999, lng: 999 }));
  });

  it('keeps the English sentence byte-identical with NO provider at all', () => {
    const { container } = render(<LocationField value={null} onChange={vi.fn()} field={locationField} />);
    typeInto(container, '999, 999');
    expect(diagnostic(container)).toBe(EN_RANGE_PREFIX + specDetail({ lat: 999, lng: 999 }));
  });

  it.each([
    ['zh', '未保存：'],
    ['ja', '保存されていません: '],
    ['ar', 'لم يتم الحفظ: '],
  ])('translates the FRAME in %s and interpolates the spec\'s own complaint', (language, framePrefix) => {
    const { container } = renderIn(language, <LocationField value={null} onChange={vi.fn()} field={locationField} />);
    typeInto(container, '999, 999');
    const detail = specDetail({ lat: 999, lng: 999 });
    expect(diagnostic(container)).toBe(framePrefix + detail);
    // The frame is this widget's own words and is translated; the detail is the
    // spec's and is not. Pinning both halves keeps the division deliberate.
    expect(container.textContent).not.toContain(EN_RANGE_PREFIX);
    expect(diagnostic(container)).toContain(detail);
  });
});
