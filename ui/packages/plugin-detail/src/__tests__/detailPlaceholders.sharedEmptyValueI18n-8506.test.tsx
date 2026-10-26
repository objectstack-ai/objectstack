/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The accessible name of the shared placeholder is TRANSLATED at both detail
 * sites (objectui#8506).
 *
 * ## Why an `en` test cannot decide this
 *
 * objectui#8506 was filed as a decision — "adopting the shared `EmptyValue`
 * would trade a translated label for an untranslated one" — and the card names
 * the reason no English test could settle it: `detail.noValue`'s `en` value is
 * `"No value"`, byte-identical to the literal the old inline
 * `t('detail.noValue', { defaultValue: 'No value' })` would have fallen back to.
 * An `en` assertion is green whether the name comes from the pack or from a
 * hardcoded string. That trap is written up on objectui#7173, in one of these
 * very packages.
 *
 * So the measurement is made where the two answers differ:
 *
 *  - **`zh`** — `无`. A non-Latin pack, where a value byte-identical to `en`
 *    would be decidable evidence of an untranslated string.
 *  - **`de`** — `Kein Wert`. A Latin pack, where identity CAN be genuine, so
 *    the assertion names the German words rather than merely "not English".
 *
 * Expectations are written as LITERALS, never read back out of the pack: a test
 * that resolves its expectation through the table under test passes against any
 * table, including an empty one.
 *
 * ## Why the provider-less leg is a different FILE
 *
 * `createI18n` registers its instance as react-i18next's module-global default,
 * and the registration survives unmount and `cleanup()`. A "no provider"
 * assertion placed HERE would silently resolve against whichever language ran
 * last. That leg lives in `detailPlaceholders.sharedEmptyValue-8506.test.tsx`,
 * which mounts no provider at all. (Same split, same reason, as
 * `config-panel-footer-i18n-4750` / `-no-provider-4750`.)
 *
 * ## ⚠️ What this file does NOT decide — measured, not assumed
 *
 * Under the caricature run against the sibling file (`EmptyValue` returned
 * unconditionally from both sites, filled values included) all three cases here
 * go red — but every one of them through its CONTROL ("CONTROL: the filled row
 * rendered"), never through its headline. That is correct and worth writing
 * down: `aria-label === '无'` is perfectly true of a surface that has given up
 * on values entirely. These cases are a SCOPE DECLARATION about the locale axis;
 * the case that refuses an `EmptyValue`-everywhere implementation on its own
 * terms is `drawingAffordance([...])` in the sibling file.
 *
 * ## What the two sites resolve THROUGH, and why that is worth pinning
 *
 * They no longer resolve it themselves. `EmptyValue` calls
 * `useObjectTranslation` and reads the bare `detail.noValue`; `DetailSection`'s
 * surviving `title` still calls `useDetailTranslation`, which is
 * `createSafeTranslation(DETAIL_DEFAULT_TRANSLATIONS, 'detail.back')`. Two
 * different hooks over one key: `THE TWO PATHS AGREE` asserts they land on the
 * same bytes, which is the property that makes the surviving `title` safe.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';
import type { DetailViewSection } from '@object-ui/types';

afterEach(cleanup);

const objectSchema = {
  fields: {
    industry: { type: 'text', label: 'Industry' },
    notes: { type: 'text', label: 'Notes' },
  },
};

/** See the sibling file: the anchor is the field LABEL, never the placeholder. */
const boxOf = (label: string) => screen.getByText(label).parentElement as HTMLElement;

const emptyIn = (el: HTMLElement): HTMLElement | null =>
  el.querySelector('[data-slot="empty-value"]');

const inLocale = (language: string, ui: React.ReactElement) =>
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {ui}
    </I18nProvider>,
  );

const section = { title: 'Details', fields: [{ name: 'industry' }, { name: 'notes' }] } as DetailViewSection;

const body = (
  <DetailSection section={section} data={{ industry: 'Manufacturing', notes: '' }} objectSchema={objectSchema} />
);

const strip = (
  <HeaderHighlight
    fields={[{ name: 'industry', label: 'Industry' }, { name: 'notes', label: 'Notes' }] as any}
    data={{ industry: 'Manufacturing', notes: '   ' }}
    objectSchema={objectSchema}
  />
);

describe('The shared placeholder announces in the session language (#8506)', () => {
  it('zh — both sites announce `无`, not `No value`', () => {
    inLocale('zh', body);
    // CONTROL — the surface rendered a real value, so an absent name below
    // could not be explained by a section that drew nothing.
    expect(within(boxOf('industry')).queryByText('Manufacturing'), 'CONTROL: the filled row rendered')
      .not.toBeNull();
    const bodyName = emptyIn(boxOf('notes'))!.getAttribute('aria-label');
    cleanup();

    inLocale('zh', strip);
    expect(within(boxOf('Industry')).queryByText('Manufacturing'), 'CONTROL: the filled chip rendered')
      .not.toBeNull();
    const stripName = emptyIn(boxOf('Notes'))!.getAttribute('aria-label');

    expect(bodyName, 'the body grid announces the zh pack value').toBe('无');
    expect(stripName, 'and so does the strip').toBe('无');
    // Stated apart because it is the exact regression the card feared: an
    // English name reaching a zh screen-reader session.
    expect(bodyName, 'never the English literal').not.toBe('No value');
    expect(stripName, 'never the English literal').not.toBe('No value');
  });

  it('de — both sites announce `Kein Wert` (a Latin pack, named explicitly)', () => {
    inLocale('de', body);
    expect(within(boxOf('industry')).queryByText('Manufacturing'), 'CONTROL: the filled row rendered')
      .not.toBeNull();
    const bodyName = emptyIn(boxOf('notes'))!.getAttribute('aria-label');
    cleanup();

    inLocale('de', strip);
    expect(within(boxOf('Industry')).queryByText('Manufacturing'), 'CONTROL: the filled chip rendered')
      .not.toBeNull();
    const stripName = emptyIn(boxOf('Notes'))!.getAttribute('aria-label');

    expect(bodyName, 'the body grid announces the de pack value').toBe('Kein Wert');
    expect(stripName, 'and so does the strip').toBe('Kein Wert');
  });

  it('⭐ THE TWO PATHS AGREE — `EmptyValue`\'s hook and `useDetailTranslation` land on the same bytes', () => {
    // `DetailSection` keeps a `title`, and it is resolved by a DIFFERENT hook
    // from the one that now resolves the accessible name. If those two ever
    // disagreed, one control would announce `无` and hover `No value`.
    inLocale('zh', body);
    expect(within(boxOf('industry')).queryByText('Manufacturing'), 'CONTROL: the filled row rendered')
      .not.toBeNull();

    const placeholder = emptyIn(boxOf('notes'))!;
    expect(placeholder, 'CONTROL: the placeholder is on screen').not.toBeNull();
    expect(placeholder.getAttribute('title'), 'the tooltip is translated too').toBe('无');
    expect(
      placeholder.getAttribute('title'),
      'and it is the SAME string the accessible name resolved to',
    ).toBe(placeholder.getAttribute('aria-label'));
  });
});
