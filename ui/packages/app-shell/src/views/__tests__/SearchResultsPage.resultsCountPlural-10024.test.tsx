/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10024 — the query branch of the results-count ternary picks its key
 * on `totalCount === 1`: `search.resultsCount` at exactly one result,
 * `search.resultsCountPlural` at every other count. Two slots are enough for
 * the two CLDR categories `en` has. They are not enough for `ru` (one: 1, 21,
 * 31…; few: 2-4, 22-24…; many: 0, 5-20, 25-30…) or for `ar` (zero, one, two,
 * few 3-10, many 11-99, other 100-102…).
 *
 * What shipped before this card: the `ru` plural slot held the `many` form, so
 * a Russian session read `2 результатов` at two results (the language needs
 * `результата`) and `21 результатов` at twenty-one (it needs `результат`); and
 * the two `ar` slots were byte-identical, so the switch bought Arabic nothing.
 *
 * ## The repair, and why it keeps the two-key switch
 *
 * The count ≠ 1 half is phrased count-INVARIANTLY in `ru` and `ar` — a label
 * followed by the number, so no noun has to agree with it. That is the device
 * this repo already uses for exactly this limit: `ru`
 * `collaboration.commentCount` (`Комментариев: {{count}}`) sits on the same
 * two-key convention, and the base keys of the `_one`/`_other` families
 * (`detail.fileCount` `Файлов: {{count}}`, `ar` `calendar.a11y.dayCell`
 * `عدد الأحداث: {{count}}`) carry it for the categories a family cannot spell.
 *
 * ## objectui#11445 — the real few-form, now
 *
 * The route this card left open was taken: objectui#11432 let a pack hold every
 * CLDR slot its language selects, and objectui#11445 made `search.resultsCount`
 * an i18next count family. The page passes `count`, i18next picks the slot, and
 * `search.resultsCountPlural` left all ten packs — so `ru` reads «2 результата»
 * and «21 результат», and `ar` its dual at 2. The strings below are those.
 *
 * ## What this file measures
 *
 * The strings a user reads, through a real render of the page inside a real
 * i18next instance booted in the session's language — no mocked `t`, so
 * i18next's own `count` handling (it looks up `_few`/`_many`/… before the bare
 * key) is part of what is measured. `en` is the control: its two strings are
 * unchanged by this card.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

/** Mutable across cases: the app's nav items, each one a query match. */
const app = vi.hoisted(() => ({ navigation: [] as unknown[] }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ appName: 'crm' }),
  // Every nav item below is labelled `Object N`, so this query matches all of
  // them and the page's `totalCount` is exactly the number of items.
  useSearchParams: () => [new URLSearchParams('q=Object'), vi.fn()],
  Link: ({
    to,
    children,
    ...rest
  }: { to: unknown; children?: React.ReactNode } & Record<string, unknown>) => (
    <a href={typeof to === 'string' ? to : ''} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // No record hits: the count on screen is the nav-match count alone.
    useRecordSearch: () => ({ results: [], isSearching: false, error: undefined }),
  };
});

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'crm', label: 'CRM', navigation: app.navigation }],
    objects: [],
  }),
}));

vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ find: vi.fn(), searchAll: vi.fn() }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { SearchResultsPage } from '../SearchResultsPage';

/** `n` object nav items that all match the query `Object`. */
const navItems = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    type: 'object',
    objectName: `crm_object_${i}`,
    label: `Object ${i}`,
  }));

type Lang = 'en' | 'ru' | 'ar';

/** The results-count line a session in `lang` reads with `count` matches. */
function countLine(lang: Lang, count: number): string {
  app.navigation = navItems(count);
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  // The instance really booted in the language under test; otherwise every
  // string below would be `en` read through `fallbackLng`.
  expect(i18n.language).toBe(lang);
  const { container } = render(
    <I18nProvider instance={i18n}>
      <SearchResultsPage />
    </I18nProvider>,
  );
  // The count line is the only leaf span that quotes the query back (the nav
  // hits show `Object N` unquoted), so it is found by what a user reads rather
  // than by a class name.
  const lines = Array.from(container.querySelectorAll('span')).filter(
    (span) => span.children.length === 0 && (span.textContent ?? '').includes('"Object"'),
  );
  expect(lines, `${lang} at ${count}: count line not found exactly once`).toHaveLength(1);
  const text = lines[0].textContent ?? '';
  cleanup();
  return text;
}

/** The exact line per count, every count the card's pins name. */
const EXPECTED: Record<Lang, Array<[number, string]>> = {
  en: [
    [1, '1 result for "Object"'],
    [2, '2 results for "Object"'],
  ],
  ru: [
    [1, '1 результат по запросу "Object"'],
    [2, '2 результата по запросу "Object"'],
    [5, '5 результатов по запросу "Object"'],
    [21, '21 результат по запросу "Object"'],
    [22, '22 результата по запросу "Object"'],
    [25, '25 результатов по запросу "Object"'],
  ],
  ar: [
    [0, '0 نتيجة لـ "Object"'],
    [1, '1 نتيجة لـ "Object"'],
    [2, 'نتيجتان لـ "Object" (2)'],
    [3, '3 نتائج لـ "Object"'],
    [11, '11 نتيجة لـ "Object"'],
    [100, '100 نتيجة لـ "Object"'],
  ],
};

describe('search results count reads correctly at every CLDR category (objectui#10024)', () => {
  beforeEach(() => {
    app.navigation = [];
  });

  it.each(EXPECTED.en)('en control: %i result(s) — unchanged by this card', (count, line) => {
    expect(countLine('en', count)).toBe(line);
  });

  it.each(EXPECTED.ru)('ru at %i', (count, line) => {
    expect(countLine('ru', count)).toBe(line);
  });

  it.each(EXPECTED.ar)('ar at %i', (count, line) => {
    expect(countLine('ar', count)).toBe(line);
  });

  it('ru no longer binds the many-form noun to a few or one count', () => {
    // The shipped defect, named as the strings a Russian user read. `few` at 2
    // and 22 needs результата, `one` at 21 needs результат; the slot held
    // результатов for all three.
    expect(new Intl.PluralRules('ru').select(2)).toBe('few');
    expect(new Intl.PluralRules('ru').select(21)).toBe('one');
    expect(new Intl.PluralRules('ru').select(22)).toBe('few');
    expect(countLine('ru', 2)).not.toBe('2 результатов для "Object"');
    expect(countLine('ru', 21)).not.toBe('21 результатов для "Object"');
    expect(countLine('ru', 22)).not.toBe('22 результатов для "Object"');
  });

  it('ar says something different at one than at two — the family gives it the dual', () => {
    // Both `ar` slots once were the same bytes, so the line read identically
    // at every count but for the number. Compared with the number masked, so
    // this is about the sentence, not the digit.
    const shape = (text: string) => text.replace(/\d+/g, 'N');
    expect(shape(countLine('ar', 1))).not.toBe(shape(countLine('ar', 2)));
    expect(countLine('ar', 2)).not.toBe('2 نتيجة لـ "Object"');
    expect(new Intl.PluralRules('ar').select(2)).toBe('two');
    expect(new Intl.PluralRules('ar').select(3)).toBe('few');
  });

  it('interpolation is intact — the number and the query both reach the screen', () => {
    for (const lang of ['en', 'ru', 'ar'] as const) {
      for (const [count] of EXPECTED[lang]) {
        const text = countLine(lang, count);
        expect(text, `${lang} at ${count}`).toContain(String(count));
        expect(text, `${lang} at ${count}`).toContain('"Object"');
        expect(text, `${lang} at ${count} left a raw placeholder`).not.toContain('{{');
      }
    }
  });

  it('search.resultsCount is an i18next count family in ru and ar; the `Plural` sibling is gone', () => {
    // The mechanism of the objectui#11445 repair, on the pack values: every CLDR
    // slot the language selects is spelled, so i18next chooses the form.
    for (const lang of ['ru', 'ar'] as const) {
      const search = builtInLocales[lang].search as Record<string, string>;
      for (const category of new Intl.PluralRules(lang).resolvedOptions().pluralCategories) {
        expect(search[`resultsCount_${category}`], `${lang} resultsCount_${category}`).toEqual(expect.any(String));
      }
      expect(search.resultsCountPlural, `${lang} resultsCountPlural`).toBeUndefined();
    }
  });
});
