/**
 * `detail.showEmptyRelated` renders in the user's own language at EVERY plural
 * category — objectui#3863, the base-key fix, asserted through the real i18next.
 *
 * ## What was broken
 *
 * This was the repo's only pre-existing i18next plural family, and all ten packs
 * defined exactly two slots: `_one` and `_other`. i18next asks `Intl.PluralRules`
 * for the ONE suffix a language needs for that number and, finding no such slot,
 * walks `fallbackLng` to `en` — so the button rendered ENGLISH at:
 *
 *   - `ru` counts 2-4 (`few`) and 5-20, 25-30, … (`many`)
 *   - `ar` counts 0 (`zero`), 2 (`two`), 3-10 (`few`), 11-99 (`many`)
 *
 * The call site is the collapsed-empties button in
 * `packages/plugin-detail/src/renderers/record-reference-rail.tsx`, whose count is
 * `emptyTitles.length` — so 2 to 4 are the *most common* values it ever takes, and a
 * Russian user essentially always saw English.
 *
 * ## Why the fix is a base key and not `_few`/`_many`
 *
 * `all-locales-key-parity.test.ts` requires the ten packs to hold IDENTICAL key sets,
 * so giving `ru` a `_few` would be "a key `en` lacks" and fails by design. The base
 * key (no suffix) is always in i18next's lookup chain, so every category a pack did
 * not enumerate lands on it — in that pack's language — while the key set stays
 * identical everywhere. Established by objectui#3546 slice six for `perm.facet.*`
 * (`perm-home-namespace-3546.test.tsx`, the template this file follows); that slice
 * filed this family rather than fixing it, and this is that debt.
 *
 * The rule itself ("a plural family must carry a base key") lives in
 * `all-locales-key-parity.test.ts` — pack-intrinsic, so the NEXT plural family fails
 * at PR time without needing a call site to exist. This file pins the rendering.
 *
 * ⚠️ The parity argument above is historical. objectui#11432 gave the parity rule
 * one computed exception — a pack may hold the slot of an `en` family for a category
 * its OWN language selects — and then required those slots: the base kept `ru` and
 * `ar` in their own language but in one form, which cannot agree with every count.
 * So this family now has `ru` `_few`/`_many` and `ar` `_zero`/`_two`/`_few`/`_many`,
 * and the assertions below compute which slot answers from the pack itself.
 *
 * ## Why these assertions are the ones that discriminate
 *
 * `en` output is identical before and after (its categories are exactly `one`/`other`,
 * so it never reaches the base key), and so is `de`/`zh`/`ja`/`ko` output. Every
 * assertion that can tell the fix from its absence is a `ru` or `ar` one — the rest
 * prove reachability and prove the English wording did not move.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '../provider';
import { createSafeTranslation } from '../useSafeTranslation';
import { builtInLocales } from '../locales/index';

/**
 * The repo root, derived from THIS FILE's own location — never from
 * `process.cwd()` (objectui#7799).
 *
 * It was `process.cwd()` until then, on the reasoning that
 * `scripts/vitest-invocation-guard.mjs` refuses any invocation whose vitest root
 * is not the repo root. That guard is real, but it is a DIFFERENT invariant:
 * `--root` moves VITEST's root and moves nothing about `process.cwd()`. This
 * package's own `test` script — `vitest run --root ../.. packages/i18n/`, which
 * is what `pnpm --filter … test` and `turbo run test` both run — leaves cwd at
 * `packages/i18n/`, so every read below resolved against the package directory
 * and the assertions guarding them failed.
 *
 * Spelled in string operations, copying the landed precedent of objectui#7791
 * (PR #7796): `new URL(rel, import.meta.url)` is REWRITTEN by Vite into a
 * `http://localhost:3000/@fs/…` dev-server URL, so only bare `import.meta.url`
 * is read here and taken apart by hand. Measured on this card under both cwds
 * and in both the `unit` and the `dom` project, it is
 * `file:///…/packages/i18n/src/__tests__/<this file>`.
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / i18n / src / __tests__ / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');


const KEY = 'detail.showEmptyRelated';
const SLOTS = [KEY, `${KEY}_one`, `${KEY}_other`] as const;

/** Derived from the map, not `string[]`: `Object.keys` erases which keys it
 *  enumerated, making `builtInLocales[lang]` an implicit-`any` index (TS7053). */
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

/** The counts the card measured, plus 0 and 21 — `ru` 21 is `one` (not `other`),
 *  which is the trap a "1 is singular, everything else is plural" model falls into. */
const COUNTS = [0, 1, 2, 3, 5, 11, 21, 100] as const;

const CALL_SITE = 'packages/plugin-detail/src/renderers/record-reference-rail.tsx';
const DEFAULTS = 'packages/plugin-detail/src/useDetailTranslation.ts';

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

const wrapperFor = (lang: string) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
        {children}
      </I18nProvider>
    );
  };

/** Read a source file and prove the read landed, or assertions on it are vacuous.
 *  `import.meta.url` is not a file: URL in the dom project, so resolve from the
 *  vitest root — which the invocation guard pins to the repo root. */
function sourceOf(rel: string): string {
  const path = join(REPO_ROOT, rel);
  expect(existsSync(path), `source not found at ${path}`).toBe(true);
  return readFileSync(path, 'utf8');
}

beforeEach(() => {
  // The provider persists the last language (objectstack#5406); without this a stale
  // locale leaks into the next case.
  window.localStorage.clear();
});

describe('objectui#3863 — detail.showEmptyRelated carries a base key in all ten packs', () => {
  it('covers ten packs and three slots — guards the loops from emptying', () => {
    expect(LANGS).toHaveLength(10);
    expect(SLOTS).toHaveLength(3);
    expect(COUNTS.length).toBeGreaterThanOrEqual(7);
  });

  it.each(LANGS)('%s defines all three slots as non-empty strings', (lang) => {
    for (const slot of SLOTS) {
      const value = at(builtInLocales[lang], slot);
      expect(typeof value, `${lang}.${slot}`).toBe('string');
      expect((value as string).trim().length, `${lang}.${slot} is empty`).toBeGreaterThan(0);
    }
  });

  it('every slot in every pack interpolates exactly {{count}}', () => {
    // A translation that drops the hole renders a button with no number in it; one
    // that invents a second hole renders braces verbatim. Two regexes on purpose — a
    // /g regex is stateful and reusing it for `.test()` skips every other match.
    const HOLES = /\{\{\w+\}\}/g;
    for (const lang of LANGS) {
      for (const slot of SLOTS) {
        const holes = ((at(builtInLocales[lang], slot) as string).match(HOLES) ?? []).join(',');
        expect(holes, `${lang}.${slot}`).toBe('{{count}}');
      }
    }
  });

  it('the premise: the call site still asks for this key with a count', () => {
    // Everything below describes what that button renders. If it stopped passing
    // `count`, or moved to another key, these assertions would be about nothing.
    const src = sourceOf(CALL_SITE);
    expect(src).toContain("t('detail.showEmptyRelated', {");
    expect(src).toContain("defaultValue: '+ {{count}} empty',");
    expect(src).toContain('count: emptyTitles.length,');
  });

  describe('through the real i18next — provider mounted', () => {
    it.each(LANGS)('%s stays in its own language at every plural category', (lang) => {
      // THE assertion. `Intl.PluralRules` is the same resolver i18next uses, so
      // `select()` predicts which slot must answer: a category the pack enumerates
      // takes its suffixed slot (every category, since objectui#11432), anything else
      // falls to the base key. Computing the expectation from the pack (rather than
      // hard-coding strings) is what makes this fail loudly if a pack's WORDING moves
      // without its slots moving.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
      const rules = new Intl.PluralRules(lang);
      for (const count of COUNTS) {
        const category = rules.select(count);
        const own = `${KEY}_${category}`;
        const slot = typeof at(builtInLocales[lang], own) === 'string' ? own : KEY;
        const expected = (at(builtInLocales[lang], slot) as string).replace(
          '{{count}}',
          String(count),
        );
        expect(result.current.t(KEY, { count }), `${lang} at count=${count} (${category})`).toBe(
          expected,
        );
      }
    });

    it('ru renders Russian at few and many — the counts this button takes most often', () => {
      // Named rather than left to the loop above, because these are the exact values
      // the card measured rendering English, and the numbers are the point.
      expect(new Intl.PluralRules('ru').select(2)).toBe('few');
      expect(new Intl.PluralRules('ru').select(3)).toBe('few');
      expect(new Intl.PluralRules('ru').select(7)).toBe('many');
      expect(new Intl.PluralRules('ru').select(11)).toBe('many');
      // 21 is `one` in Russian — the base key must NOT swallow it.
      expect(new Intl.PluralRules('ru').select(21)).toBe('one');

      // Since objectui#11432 `few` and `many` have their own slots: the
      // substantivised adjective takes the genitive plural after 2-4 as after 5-20.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('ru') });
      const { t } = result.current;
      expect(t(KEY, { count: 3 })).toBe('+ 3 пустых');
      expect(t(KEY, { count: 7 })).toBe('+ 7 пустых');
      expect(t(KEY, { count: 11 })).toBe('+ 11 пустых');
      expect(t(KEY, { count: 1 })).toBe('+ 1 пустое');
      expect(t(KEY, { count: 21 })).toBe('+ 21 пустое');
      // …and NOT the English the fallback chain produced before the base key existed.
      expect(t(KEY, { count: 3 })).not.toBe('+ 3 empty');
      for (const count of COUNTS) {
        expect(t(KEY, { count }), `ru leaked English at ${count}`).not.toContain('empty');
      }
    });

    it('ar renders Arabic at zero, two, few and many', () => {
      expect(new Intl.PluralRules('ar').select(0)).toBe('zero');
      expect(new Intl.PluralRules('ar').select(2)).toBe('two');
      expect(new Intl.PluralRules('ar').select(5)).toBe('few');
      expect(new Intl.PluralRules('ar').select(30)).toBe('many');
      // 100 is `other` in Arabic: singular after a hundred, which objectui#11432
      // corrected (it held the 3-10 agreement).
      expect(new Intl.PluralRules('ar').select(100)).toBe('other');

      // Each category in its own slot since objectui#11432: dual at 2, the plural
      // agreement at 3-10, accusative singular at 11-99, singular at 1 and 100.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('ar') });
      const { t } = result.current;
      expect(t(KEY, { count: 2 })).toBe('+ فارغان (2)');
      expect(t(KEY, { count: 5 })).toBe('+ 5 فارغة');
      expect(t(KEY, { count: 30 })).toBe('+ 30 فارغًا');
      expect(t(KEY, { count: 1 })).toBe('+ 1 فارغ');
      expect(t(KEY, { count: 100 })).toBe('+ 100 فارغ');
      for (const count of COUNTS) {
        expect(t(KEY, { count }), `ar leaked English at ${count}`).not.toContain('empty');
      }
    });

    it('no pack leaks the English string at any count', () => {
      // The aggregate form of the defect, stated once over the whole matrix: "empty"
      // may appear ONLY in the pack that owns that word. Before the base key this was
      // false for 5 of the 8 ru counts and 5 of the 8 ar counts.
      const leaks: string[] = [];
      for (const lang of LANGS.filter((l) => l !== 'en')) {
        window.localStorage.clear();
        const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
        for (const count of COUNTS) {
          const value = result.current.t(KEY, { count });
          if (value === `+ ${count} empty`) leaks.push(`${lang} @ ${count}: ${value}`);
        }
      }
      expect(leaks).toEqual([]);
    });

    it('en is byte-for-byte unchanged — this fix must not move any English copy', () => {
      // The other half of a translation fix: the language that was already correct has
      // to stay correct, at every count and through every slot.
      const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor('en') });
      for (const count of COUNTS) {
        expect(result.current.t(KEY, { count }), `en at count=${count}`).toBe(`+ ${count} empty`);
      }
      for (const slot of SLOTS) {
        expect(at(builtInLocales.en, slot), `en.${slot}`).toBe('+ {{count}} empty');
      }
    });

    it('the packs that cannot reach the base key still render their own language', () => {
      // de/zh/ja/ko have no category outside `one`/`other`, so their base key is
      // ballast. Pinned anyway: a "fix" that accidentally routed everything through the
      // base key would be invisible in ru/ar (where base and _other agree in meaning)
      // and visible here only if someone asserts it.
      const CASES: Array<[LocaleCode, number, string]> = [
        ['de', 1, '+ 1 leer'],
        ['de', 7, '+ 7 leer'],
        ['zh', 3, '+ 3 个为空'],
        ['ja', 3, '+ 3 件（空）'],
        ['ko', 3, '+ 3개 비어 있음'],
        ['fr', 1, '+ 1 vide'],
        ['fr', 7, '+ 7 vides'],
        ['es', 7, '+ 7 vacíos'],
        ['pt', 7, '+ 7 vazios'],
      ];
      for (const [lang, count, expected] of CASES) {
        window.localStorage.clear();
        const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
        expect(result.current.t(KEY, { count }), `${lang} at ${count}`).toBe(expected);
      }
    });

    it('fr, es and pt answer a million from their own `_many` slot', () => {
      // Their third category is `many`, and CLDR uses it at exact millions. Since
      // objectui#11432 it has its own slot; on this key it repeats `_other`, because
      // the count governs no noun complement (the "de" of "un million de …" goes
      // before a noun, and this label has none).
      for (const lang of ['fr', 'es', 'pt'] as const) {
        expect(new Intl.PluralRules(lang).select(100)).toBe('other');
        expect(new Intl.PluralRules(lang).select(1_000_000)).toBe('many');
        window.localStorage.clear();
        const { result } = renderHook(() => useObjectTranslation(), { wrapper: wrapperFor(lang) });
        // This pack's own `_many` words — never English, never the base.
        expect(result.current.t(KEY, { count: 1_000_000 }), `${lang} at 1e6`).toBe(
          (at(builtInLocales[lang], `${KEY}_many`) as string).replace('{{count}}', '1000000'),
        );
      }
    });
  });

  describe('the provider-less path — the same key through the defaults table', () => {
    it('fallbackT reads the family rows i18next reads, and the base row without a count', () => {
      // objectui#3863 pinned the opposite: `createSafeTranslation`'s `fallbackT`
      // indexed the table with the key AS GIVEN, so the suffixed rows were kept only
      // for key-set parity and the base row was the one a provider-less host could
      // reach — without it, the raw key rendered. This case said a refactor teaching
      // `fallbackT` plural resolution "has to come past this comment"; objectui#11445
      // is that refactor. `fallbackT` now walks i18next's order — `key_<category>`
      // for a NUMERIC count, then the base row — because that card converted the
      // code-selected `xxxCountOne` pairs into families, and without it a
      // provider-less host would have lost the "1 reply" those pairs rendered.
      //
      // The table still carries all three rows, and still NEEDS the base one: it is
      // what a call made without a numeric count reads, on both paths.
      const defaults = sourceOf(DEFAULTS);
      expect(defaults).toContain("'detail.showEmptyRelated': '+ {{count}} empty',");
      expect(defaults).toContain("'detail.showEmptyRelated_one': '+ {{count}} empty',");
      expect(defaults).toContain("'detail.showEmptyRelated_other': '+ {{count}} empty',");
      // The behaviour, through the real factory, on rows that differ so the
      // assertions can tell the three apart.
      const useT = createSafeTranslation(
        {
          'objectui3863.anchor': 'Anchor',
          [KEY]: 'BASE {{count}}',
          [`${KEY}_one`]: 'ONE {{count}}',
          [`${KEY}_other`]: 'OTHER {{count}}',
        },
        'objectui3863.anchor',
      );
      const { result } = renderHook(() => useT());
      expect(result.current.t(KEY, { count: 1 })).toBe('ONE 1');
      expect(result.current.t(KEY, { count: 3 })).toBe('OTHER 3');
      expect(result.current.t(KEY, { count: '3' })).toBe('BASE 3');
      expect(result.current.t(KEY)).toBe('BASE {{count}}');
    });
  });

  it('the base key is what parity now requires of every plural family', () => {
    // The cross-reference that keeps this fix from being undone in isolation: the rule
    // lives next door, and it is stated over ALL families, not just this one.
    const parity = sourceOf('packages/i18n/src/__tests__/all-locales-key-parity.test.ts');
    expect(parity).toContain('every plural family carries a base key (objectui#3863)');
    expect(parity).toContain('defines the base key of every plural family it has');
  });
});
