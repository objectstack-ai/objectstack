/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9664 — `search.itemsAvailable` broke ENGLISH at one item.
 *
 * The full-page search header is one ternary with two branches. The browse
 * branch asked for `search.itemsAvailable` at every count, so `en`'s
 * `{{count}} items available` shipped `1 items available` at a single
 * searchable item — in the default language. `de`/`es`/`fr`/`pt` read the same
 * way (`1 Elemente verfügbar`, …).
 *
 * ## The repair, twice
 *
 * objectui#9664 added a code-selected singular sibling, `search.itemsAvailableOne`,
 * picked on `=== 1` — the shape the repo's other count labels used then. Two
 * keys give a language two forms, so `ru` and `ar` had to phrase the plural half
 * count-invariantly to stay right (objectui#10425).
 *
 * objectui#11445 made the key an i18next count family: the page passes `count`
 * and i18next picks the slot `Intl.PluralRules` selects, so `ar` reads its own
 * form at 2, 3-10, 11-99 and 100+, and the sibling left all ten packs. The
 * defect this file was written for is now the family's `_one` slot.
 *
 * ## What this file owns, and what it does not
 *
 * That every slot exists is `all-locales-key-parity.test.ts`'s; that i18next
 * selects each is `plural-categories-11432.test.ts`'s; that the page asks the
 * family is `SearchResultsPage.itemsAvailablePlural-9664.test.tsx`'s. This file
 * owns the VALUES: that the `_one` slot is a singular wherever the language has
 * one, that `ru` keeps its noun-free phrasing, and that no slot carries a
 * parenthesised plural marker.
 */
import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import { builtInLocales } from '../locales';

type LocaleCode = keyof typeof builtInLocales;

const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const at = (pack: unknown, dotted: string) =>
  dotted.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], pack);

const KEY = 'search.itemsAvailable';

/** Every slot this family has in one pack — the categories its language selects. */
const slotsOf = (lang: LocaleCode) =>
  new Intl.PluralRules(lang).resolvedOptions().pluralCategories.map((c) => `${KEY}_${c}`);

// The i18next this package ships with, configured the way `createI18n` does.
const instance = i18next.createInstance();
void instance.init({
  resources: Object.fromEntries(
    LANGS.map((lang) => [lang, { translation: builtInLocales[lang] as unknown as Record<string, unknown> }]),
  ),
  lng: 'en',
  fallbackLng: 'en',
  initAsync: false,
  interpolation: { escapeValue: false },
});

describe('search.itemsAvailable reads a singular at one item, in every pack (objectui#9664)', () => {
  it('the walk covers all ten packs — not an empty assertion', () => {
    expect(LANGS).toHaveLength(10);
    for (const lang of LANGS) expect(slotsOf(lang).length, lang).toBeGreaterThan(0);
  });

  it('English at exactly one item reads "1 item available" — the shipped defect, through i18next', () => {
    const t = instance.getFixedT('en');
    expect(t(KEY, { count: 1 })).toBe('1 item available');
    expect(t(KEY, { count: 1 })).not.toBe('1 items available');
    expect(t(KEY, { count: 0 })).toBe('0 items available');
    expect(t(KEY, { count: 2 })).toBe('2 items available');
  });

  it('the code-selected sibling is gone from every pack (objectui#11445)', () => {
    for (const lang of LANGS) {
      expect(at(builtInLocales[lang], 'search.itemsAvailableOne'), `${lang} itemsAvailableOne`).toBeUndefined();
    }
  });

  it('the `_one` slot differs from the slot two items read, wherever the language has a singular', () => {
    // `ru` phrases the label WITHOUT a noun («{{count}} доступно»), so it has
    // no word to agree with the number and every slot is one string; zh/ja/ko
    // select only `other`. The five Latin packs and `ar` have a singular — and
    // in `ar` the slot two items read is the dual, `_two`, not `_other` (which
    // serves 100+ with the singular noun, as Arabic does).
    const singular: LocaleCode[] = ['en', 'de', 'fr', 'es', 'pt', 'ar'];
    for (const lang of singular) {
      const atTwo = `${KEY}_${new Intl.PluralRules(lang).select(2)}`;
      expect(at(builtInLocales[lang], `${KEY}_one`), `${lang} _one vs ${atTwo}`).not.toBe(
        at(builtInLocales[lang], atTwo),
      );
    }
    for (const slot of slotsOf('ru')) {
      expect(at(builtInLocales.ru, slot), `ru ${slot}`).toBe('{{count}} доступно');
    }
    expect(instance.getFixedT('de')(KEY, { count: 1 })).toBe('1 Element verfügbar');
    expect(instance.getFixedT('ar')(KEY, { count: 2 })).toBe('عنصران متاحان (2)');
  });

  it('no slot carries a parenthesised plural marker, in any pack', () => {
    // `ar` once wrote BOTH numbers into one string as `عنصر(عناصر) متاح(ة)`; a
    // family has a slot per category, so no slot needs the device.
    //
    // The class is Unicode-aware on purpose (objectui#3866): JS `\w` is
    // [A-Za-z0-9_] with or without `u`, so an ASCII formulation is constant-false
    // for exactly the non-Latin packs this guard is written to watch. The bound
    // is `{1,6}` because `عنصر(عناصر)` holds five letters in its parentheses.
    const MARKER = /\([\p{L}]{1,6}\)/u;
    for (const lang of LANGS) {
      for (const slot of [KEY, ...slotsOf(lang)]) {
        expect(MARKER.test(String(at(builtInLocales[lang], slot))), `${lang} ${slot} has a "(s)" marker`).toBe(false);
      }
    }
    expect(MARKER.test('عنصر(عناصر)')).toBe(true);
    expect(MARKER.test('متاح(ة)')).toBe(true);
    expect(/\(\w{1,6}\)/.test('عنصر(عناصر)')).toBe(false);
  });
});
