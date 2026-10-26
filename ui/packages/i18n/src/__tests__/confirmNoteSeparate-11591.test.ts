/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11591 — the package-less sheet's confirm note claims no atomicity
 * and names no package, in any of the ten packs, and the package sheet's note
 * keeps both.
 *
 * `preview.changes.confirmNote` is the package sheet's sentence: that Publish
 * promotes the package's drafts in one atomic pass, and it does. The
 * package-less "Organization flows" page publishes each draft by itself, so
 * its sheet reads `preview.changes.confirmNoteSeparate` instead. The defect
 * this pins is the package sentence reaching a surface that publishes draft
 * by draft; copied into the new family, the claim would come back in that
 * one language and no other gate would see it.
 *
 * ## How "claims atomicity" is read, per pack
 *
 * Each pack's package sentence spells the claim in its own words: an
 * "atomically" adverb where the language has one, "all at once" where it does
 * not (`ar` holds no atomic adverb at all). `CLAIM` names that spelling per
 * pack, and every one is CONTROLLED: it must occur in every form of that
 * pack's `confirmNote` family before its absence from `confirmNoteSeparate`
 * means anything. A marker that stopped matching the package sentence would
 * fail the control, not pass the check vacuously. `PACKAGE_WORD` is read and
 * controlled the same way.
 *
 * ⛔ What this file does not judge: whether a translation says the rest of
 * the sentence well — a translator does that. Slot completeness per CLDR
 * category is `all-locales-key-parity.test.ts`'s, and slot selection
 * `plural-categories-11432.test.ts`'s; both read this family by construction.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

/** The atomicity claim, as each pack's package sentence spells it. */
const CLAIM: Record<LocaleCode, RegExp> = {
  en: /atomically/u,
  de: /atomar/u,
  es: /atómicamente/u,
  fr: /atomiquement/u,
  pt: /atomicamente/u,
  ru: /атомарно/u,
  ar: /دفعة واحدة/u,
  ja: /アトミック|まとめて/u,
  ko: /원자적|한 번에/u,
  zh: /原子|一次性/u,
};

/** The word for "package" in each pack's package sentence — controlled below. */
const PACKAGE_WORD: Record<LocaleCode, RegExp> = {
  en: /package/iu,
  de: /Paket/u,
  es: /paquete/u,
  fr: /paquet/u,
  pt: /pacote/u,
  ru: /пакет/u,
  ar: /الحزمة/u,
  ja: /パッケージ/u,
  ko: /패키지/u,
  zh: /包/u,
};

const changesOf = (lang: LocaleCode): Record<string, unknown> =>
  (builtInLocales[lang] as unknown as { preview: { changes: Record<string, unknown> } }).preview.changes;

/** Every leaf of one family in one pack: the base key and each suffixed slot. */
function family(lang: LocaleCode, base: string): Array<[string, string]> {
  return Object.entries(changesOf(lang))
    .filter(([key]) => key === base || key.startsWith(`${base}_`))
    .map(([key, value]) => [key, String(value)]);
}

describe('the package-less confirm note claims no atomicity in any pack (objectui#11591)', () => {
  it('names a claim spelling for every pack — no pack left unjudged', () => {
    expect(Object.keys(CLAIM).sort()).toEqual([...LANGS].sort());
    expect(LANGS).toHaveLength(10);
  });

  it.each(LANGS)('%s: the package sentence carries the claim (control)', (lang) => {
    const forms = family(lang, 'confirmNote');
    expect(forms.length, `${lang} has no confirmNote family`).toBeGreaterThan(1);
    const without = forms.filter(([, value]) => !CLAIM[lang].test(value)).map(([key]) => key);
    expect(without, `${lang}: the claim spelling no longer matches these package forms`).toEqual([]);
  });

  it.each(LANGS)('%s: no package-less form carries it', (lang) => {
    const forms = family(lang, 'confirmNoteSeparate');
    expect(forms.length, `${lang} has no confirmNoteSeparate family`).toBeGreaterThan(1);
    const claiming = forms.filter(([, value]) => CLAIM[lang].test(value)).map(([key]) => key);
    expect(claiming, `${lang}: these package-less forms claim atomicity`).toEqual([]);
    // And none of them speaks of a package the page does not have, in the
    // words this pack's own package sentence uses for one.
    expect(
      forms.filter(([, value]) => PACKAGE_WORD[lang].test(value)).map(([key]) => key),
      `${lang}: these package-less forms name a package`,
    ).toEqual([]);
  });
});

describe('the package word is read off the package sentence (objectui#11591)', () => {
  it.each(LANGS)('%s: control — the package sentence names its package', (lang) => {
    const forms = family(lang, 'confirmNote');
    const without = forms.filter(([, value]) => !PACKAGE_WORD[lang].test(value)).map(([key]) => key);
    expect(without, `${lang}: the package word no longer matches these package forms`).toEqual([]);
  });
});
