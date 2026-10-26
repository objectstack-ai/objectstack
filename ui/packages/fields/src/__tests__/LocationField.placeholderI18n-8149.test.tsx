/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8149 — `LocationField`'s fallback placeholder reaches the packs.
 *
 * When the field author declares no `placeholder`, the box used to show the
 * English literal `latitude, longitude`. objectui#6888 had already keyed the
 * two coordinate NOUNS for the residue refusal, so on a zh form the box and the
 * refusal one line beneath it named the same coordinate in two languages.
 *
 * The decision this pins extends objectui#6755's principle (a widget's own copy
 * is keyed) to placeholder copy, as objectui#3342 did for `TagsField`. The
 * resolution chain is:
 *
 *   1. `field.placeholder` — the author's declaration always wins, in every
 *      language;
 *   2. the two noun keys `fields.location.latitude` / `longitude`, joined by
 *      the widget;
 *   3. their `FIELD_DEFAULTS` rows with no provider mounted — that leg lives in
 *      `LocationField.placeholder.no-provider-8149.test.tsx`, a separate file
 *      because mounting `I18nProvider` installs a global react-i18next instance
 *      and leaves no provider-less state to observe here (the same split as
 *      `TagsField.placeholder.no-provider.test.tsx`).
 *
 * ## ⭐ Why the separator is the widget's, and what is asserted about it
 *
 * `parseDraft` splits the typed text on an ASCII `,` and reads the first part
 * as the latitude. So the placeholder's order and separator are the box's INPUT
 * GRAMMAR, not punctuation a pack may restyle. A joiner key or a pair value
 * would let a pack write its own script's comma, and the hint would then teach
 * a format the box refuses. The block `the separator is the parser's` measures
 * that refusal for each of those commas, so the reason is a reading rather
 * than a claim; the block after it asserts every pack's rendered hint reads,
 * under the parser's own split, as that pack's two nouns in the parser's order.
 *
 * This follows objectui#8148's settlement of the comma-decimal concern: the
 * widget fills the example digits in ASCII, so no pack spells a digit. Here no
 * pack spells the separator.
 *
 * ## Shape inherited from `LocationField.residueI18n-6888.test.tsx`
 *
 * - **Positive AND negative together**: "says the translated pair" plus "no
 *   English noun survives".
 * - **A positive control for the pack read, in this run**: `AddressField`'s
 *   `fields.address.*` labels (objectui#4028). If the provider were dead, the
 *   control fails too and no negative assertion here could be read as a pass.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

import { LocationField } from '../widgets/LocationField';
import { AddressField } from '../widgets/AddressField';

type LocationFieldMeta = React.ComponentProps<typeof LocationField>['field'];

const undeclared: LocationFieldMeta = { name: 'site', label: 'Site', type: 'location' };
const AUTHORED = 'Office GPS (lat, lng)';
const declared: LocationFieldMeta = { ...undeclared, placeholder: AUTHORED };

/** The literal this card replaced, and what `en` must still read. */
const EN_PAIR = 'latitude, longitude';

function renderIn(language: string, element: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {element}
    </I18nProvider>,
  );
}

function placeholderIn(language: string, field: LocationFieldMeta): string | null {
  const { container } = renderIn(
    language,
    <LocationField value={null} onChange={vi.fn()} field={field} />,
  );
  return (container.querySelector('input') as HTMLInputElement).getAttribute('placeholder');
}

beforeEach(() => {
  cleanup();
});

/* -------------------------------------------------------------------------- */
/* The control: a key that ALREADY resolves through this channel.              */
/* -------------------------------------------------------------------------- */

describe('the locale channel is live in this run (control for objectui#8149)', () => {
  it.each(['zh', 'zh-CN'])('resolves fields.address.* — keyed by objectui#4028 — under %s', (language) => {
    renderIn(language, <AddressField value={{}} onChange={vi.fn()} field={{ name: 'a', type: 'address' }} />);
    expect(screen.getByLabelText('街道地址')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* The claim's three rows.                                                     */
/* -------------------------------------------------------------------------- */

describe('the fallback placeholder speaks the reader\'s language (objectui#8149)', () => {
  it.each(['zh-CN', 'zh'])('is the localized pair under %s', (language) => {
    const placeholder = placeholderIn(language, undeclared);
    expect(placeholder).toBe('纬度, 经度');
    // The negative half: a pack that resolved nothing would render the
    // English nouns, which is exactly what the literal did.
    expect(placeholder).not.toContain('latitude');
    expect(placeholder).not.toContain('longitude');
  });

  it('reads exactly as it did before under en', () => {
    expect(placeholderIn('en', undeclared)).toBe(EN_PAIR);
  });

  it.each(['en', 'zh-CN'])('lets an authored placeholder win under %s', (language) => {
    // The author's copy is theirs verbatim: a locale must never overwrite an
    // explicit declaration with the widget's own hint.
    const placeholder = placeholderIn(language, declared);
    expect(placeholder).toBe(AUTHORED);
    expect(placeholder).not.toContain('纬度');
  });

  it('names a coordinate with the same word as the refusal beneath it', () => {
    // The shape the card was filed about: the box said `latitude` while the
    // refusal one line below said the zh noun. Both now read ONE key.
    const { container } = renderIn(
      'zh-CN',
      <LocationField value={null} onChange={vi.fn()} field={undeclared} />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12abc, 34' } });
    const firstNoun = (input.getAttribute('placeholder') ?? '').split(',')[0].trim();
    expect(firstNoun).toBe('纬度');
    expect(container.querySelector('p')?.textContent).toContain(firstNoun);
  });
});

/* -------------------------------------------------------------------------- */
/* ⭐ The separator is the parser's — measured, not asserted.                   */
/* -------------------------------------------------------------------------- */

describe('the separator is the parser\'s, not the pack\'s (objectui#8149)', () => {
  /**
   * The comma each of these scripts writes in prose: U+FF0C FULLWIDTH COMMA
   * (zh), U+3001 IDEOGRAPHIC COMMA (ja), U+060C ARABIC COMMA (ar). Built from
   * numeric code points rather than written as characters, so a reader of a
   * diff can tell each one from an ASCII comma.
   */
  const SCRIPT_COMMAS = [
    ['U+FF0C', String.fromCodePoint(0xff0c)],
    ['U+3001', String.fromCodePoint(0x3001)],
    ['U+060C', String.fromCodePoint(0x060c)],
  ] as const;

  it.each(SCRIPT_COMMAS)('refuses a pair separated by %s — so no pack may spell the hint with it', (_name, comma) => {
    // Were the separator a pack's to choose, a pack writing this comma would
    // show a hint whose own format this box refuses.
    const onChange = vi.fn();
    const { container } = renderIn('zh-CN', <LocationField value={null} onChange={onChange} field={undeclared} />);
    fireEvent.change(container.querySelector('input') as HTMLElement, {
      target: { value: `30.27${comma} 120.15` },
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('input')).toHaveAttribute('aria-invalid', 'true');
  });

  it('accepts the ASCII separator the hint is written with', () => {
    // The positive control for the refusals above: the same pair, the
    // separator the placeholder shows, is a coordinate.
    const onChange = vi.fn();
    const { container } = renderIn('zh-CN', <LocationField value={null} onChange={onChange} field={undeclared} />);
    fireEvent.change(container.querySelector('input') as HTMLElement, { target: { value: '30.27, 120.15' } });
    expect(onChange).toHaveBeenCalledWith({ lat: 30.27, lng: 120.15 });
  });
});

/* -------------------------------------------------------------------------- */
/* Every pack, read through the parser's own split.                            */
/* -------------------------------------------------------------------------- */

describe('every pack\'s hint is its two nouns in the parser\'s order (objectui#8149)', () => {
  /**
   * The population is the packs object itself, not a hand-written list, so a
   * pack added later is covered without editing this file.
   */
  const LANGS = Object.keys(builtInLocales) as (keyof typeof builtInLocales)[];

  it('covers more than one pack (guards the population itself)', () => {
    expect(LANGS.length).toBeGreaterThan(1);
    expect(LANGS).toEqual(expect.arrayContaining(['en', 'zh']));
  });

  it.each(LANGS)('reads as [latitude, longitude] under the parser\'s split in %s', (language) => {
    const location = builtInLocales[language].fields.location;
    const placeholder = placeholderIn(language, undeclared) ?? '';
    // What `parseDraft` does to typed text: split on ASCII `,`, trim, and read
    // part 0 as the latitude.
    expect(placeholder.split(',').map((part) => part.trim())).toEqual([location.latitude, location.longitude]);
    expect(placeholder).toBe(`${location.latitude}, ${location.longitude}`);
  });

  it.each(LANGS)('writes its own refusedFormat example with the same ASCII separator in %s', (language) => {
    // The spelling the translators already chose for the pair's example, so
    // the hint and the refusal show one format.
    expect(builtInLocales[language].fields.location.refusedFormat).toContain('30.2741, 120.1551');
  });
});
