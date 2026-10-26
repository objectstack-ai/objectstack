/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11432 — every count plural family reads its own form at every CLDR
 * category, through a REAL i18next instance over the shipped packs.
 *
 * ## What was broken
 *
 * The 14 i18next count plural families held `_one` (and, in half of them,
 * `_other`) plus a base key. i18next asks `Intl.PluralRules` for the ONE suffix a
 * number needs; a pack without that slot fell to its base key, which can hold only
 * one string. In `ru` the AI usage indicator therefore read "Сброс через 3 часов"
 * where Russian needs "часа" — `few` (2-4, 22-24, …) was served by the `many` form.
 * `ar` served zero, two, few and many from one parenthesised "singular(plural)"
 * marker, and its `_other` (100-102, …) held the 3-10 plural.
 *
 * ## What this file owns, and what it does not
 *
 * That every slot EXISTS is `all-locales-key-parity.test.ts`'s third section — key
 * sets, computed from `Intl.PluralRules`. This file owns the other half: that
 * i18next really SELECTS each slot written there. A slot spelled `_feww`, or an
 * `ar` `_zero` that i18next's count-0 lookup did not reach, is a full key set that
 * renders the wrong string; only a lookup can see it. `returnDetails` names the key
 * that answered, so a base key or an English fallback standing in for a category
 * fails here even where its words happen to match.
 *
 * The named `ru` counts below are the triage's (1, 3, 5 and 21 on
 * `console.ai.usage.resetsWeeklyHours`): one, few, many, and the `one` that a
 * "1 is singular, the rest plural" model gets wrong.
 */
import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import { builtInLocales } from '../locales';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'] as const;

function leaves(node: unknown, prefix = ''): string[] {
  return node !== null && typeof node === 'object'
    ? Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
        leaves(v, prefix ? `${prefix}.${k}` : k),
      )
    : [prefix];
}

const at = (pack: unknown, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

/** The families, read the way i18next reads them: any leaf ending in a CLDR suffix
 *  makes its stem a family. Union over all ten packs. */
const FAMILIES = [
  ...new Set(
    LANGS.flatMap((lang) =>
      leaves(builtInLocales[lang]).flatMap((path) => {
        const suffix = SUFFIXES.find((s) => path.endsWith(s) && path.length > s.length);
        return suffix === undefined ? [] : [path.slice(0, -suffix.length)];
      }),
    ),
  ),
].sort();

/**
 * One number per category the language selects, found by asking `Intl.PluralRules`
 * — never written down. Integers first; `fr`/`es`/`pt` `many` lives at exact
 * millions; `ru` `other` is only reached by a fraction.
 */
function sampleCounts(lang: string): Map<string, number> {
  const rules = new Intl.PluralRules(lang);
  const out = new Map<string, number>();
  for (const n of [...Array.from({ length: 201 }, (_, i) => i), 1_000_000, 1.5]) {
    const category = rules.select(n);
    if (!out.has(category)) out.set(category, n);
  }
  return out;
}

// The i18next this package ships with, configured the way `createI18n` configures
// it (`fallbackLng: 'en'`, no escaping). With `resources` inline and `initAsync`
// off, `init` completes before it returns — no hook, no await.
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

/** `t` with the details i18next records about which key answered. */
function lookup(lang: LocaleCode, key: string, count: number) {
  return instance.getFixedT(lang)(key, { count, date: 'D', returnDetails: true }) as unknown as {
    res: string;
    exactUsedKey: string;
    usedLng: string;
  };
}

const render = (template: string, count: number) =>
  template.replace('{{count}}', String(count)).replace('{{date}}', 'D');

describe('every plural slot is the one i18next selects, in every pack (objectui#11432)', () => {
  it('the matrix is real — families, packs and categories are all non-empty', () => {
    expect(FAMILIES.length).toBeGreaterThanOrEqual(5);
    expect(LANGS).toHaveLength(10);
    // Every category of every language has a sample, so no slot goes unjudged.
    for (const lang of LANGS) {
      expect([...sampleCounts(lang).keys()].sort(), lang).toEqual(
        [...new Intl.PluralRules(lang).resolvedOptions().pluralCategories].sort(),
      );
    }
    expect(sampleCounts('ar').get('zero')).toBe(0);
    expect(sampleCounts('fr').get('many')).toBe(1_000_000);
    expect(sampleCounts('ru').get('other')).toBe(1.5);
  });

  it.each(LANGS)('%s: each category is answered by its own slot, in this pack', (lang) => {
    const wrong: string[] = [];
    for (const base of FAMILIES) {
      for (const [category, count] of sampleCounts(lang)) {
        const slot = `${base}_${category}`;
        const details = lookup(lang, base, count);
        const template = at(builtInLocales[lang], slot);
        if (details.exactUsedKey !== slot || details.usedLng !== lang) {
          wrong.push(`${slot} @ ${count}: answered by ${details.usedLng}:${details.exactUsedKey}`);
        } else if (typeof template !== 'string' || details.res !== render(template, count)) {
          wrong.push(`${slot} @ ${count}: rendered "${details.res}"`);
        }
      }
    }
    expect(wrong, `${lang}: ${wrong.length} slot(s) not selected`).toEqual([]);
  });

  it('ru reads "Сброс через N час/часа/часов" at 1, 3, 5 and 21 — the counts triage named', () => {
    const K = 'console.ai.usage.resetsWeeklyHours';
    const t = instance.getFixedT('ru');
    expect([1, 3, 5, 21].map((n) => new Intl.PluralRules('ru').select(n))).toEqual([
      'one',
      'few',
      'many',
      'one',
    ]);
    expect(t(K, { count: 1 })).toBe('Сброс через 1 час');
    expect(t(K, { count: 3 })).toBe('Сброс через 3 часа');
    expect(t(K, { count: 5 })).toBe('Сброс через 5 часов');
    expect(t(K, { count: 21 })).toBe('Сброс через 21 час');
    // …and NOT the string the base key served before this card.
    expect(t(K, { count: 3 })).not.toBe('Сброс через 3 часов');
  });
});
