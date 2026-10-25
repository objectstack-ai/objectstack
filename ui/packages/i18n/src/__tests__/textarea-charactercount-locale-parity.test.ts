/**
 * `fields.textarea.characterCount` exists in all ten packs, interpolating BOTH
 * `{{count}}` and `{{max}}` (objectui#3406).
 *
 * `all-locales-key-parity` already enforces en↔pack key parity and placeholder
 * *shape* parity generically, so this file is deliberately narrow: it pins the
 * three things that guard cannot express on its own.
 *
 *  1. The key exists in `en` at all. Full parity is symmetric — deleting the
 *     block from *every* pack keeps that suite green while the textarea
 *     counter silently reverts to its code default for every locale.
 *  2. The ABSOLUTE placeholder form. Shape parity stays consistent if someone
 *     respells all ten at once; a sentence that lost `{{max}}` everywhere would
 *     pass there and announce half the fact here.
 *  3. That the eight non-`en`, non-`zh` packs were actually TRANSLATED rather
 *     than backfilled with the English sentence. This key was born in all ten
 *     at once, which is exactly the moment a copy-paste backfill is cheapest —
 *     and a copied English string is invisible at runtime, because the whole
 *     defect being fixed is English reaching a non-English screen reader.
 *
 * A second block below covers `fields.textarea.charactersRemaining`
 * (objectui#3408) — the same widget's near-limit warning, born in all ten packs
 * the same way, with one extra guard the sibling does not need.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

// Derived from the map rather than left as `string[]`: `Object.keys` erases
// which keys it enumerated, so `builtInLocales[lang]` below would be an
// implicit-`any` index into a `const` map (TS7053) and the suite would compare
// packs the compiler never confirmed exist. Same convention as
// `authRemediation-locale-parity.test.ts` next door.
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const characterCountOf = (lang: LocaleCode) =>
  (builtInLocales[lang] as any)?.fields?.textarea?.characterCount as string | undefined;

const charactersRemainingOf = (lang: LocaleCode) =>
  (builtInLocales[lang] as any)?.fields?.textarea?.charactersRemaining as string | undefined;

describe('fields.textarea.characterCount locale coverage (objectui#3406)', () => {
  it('covers all ten built-in packs', () => {
    expect(LANGS).toHaveLength(10);
  });

  it.each(LANGS)('%s defines the counter sentence as a non-empty string', (lang) => {
    const value = characterCountOf(lang);
    expect(typeof value, `${lang} has no fields.textarea.characterCount`).toBe('string');
    expect(value!.trim().length, `${lang}.fields.textarea.characterCount is empty`).toBeGreaterThan(0);
  });

  it.each(LANGS)('%s interpolates both the count and the cap', (lang) => {
    // Absolute form, not shape-relative. A pack that announces the count and
    // drops the cap reads as a complete sentence and is wrong.
    const value = characterCountOf(lang)!;
    expect(value, `${lang} drops {{count}}`).toContain('{{count}}');
    expect(value, `${lang} drops {{max}}`).toContain('{{max}}');
  });

  it('the English pack is byte-identical to the literal it replaced', () => {
    // The widget rendered `Character count: ${n} of ${max}` before
    // objectui#3406. This value and the `createSafeTranslation` default in
    // `CharacterCount` must both still say exactly that, so neither an `en`
    // session nor a provider-less embed changed. That default moved from
    // `packages/fields`' `FIELD_DEFAULTS` to `packages/components`
    // (`custom/character-count.tsx`) with the component itself in
    // objectui#3439. The rendered half of this pin lives in
    // `TextAreaField.characterCount.no-provider.test.tsx` — `packages/i18n`
    // cannot import either package, the dependency runs the other way.
    expect(characterCountOf('en')).toBe('Character count: {{count}} of {{max}}');
  });

  it('no other pack serves the English sentence verbatim', () => {
    // The defect this key exists to fix IS English copy reaching a non-English
    // session; a backfill that pasted `en` into the other nine would reproduce
    // it while satisfying every parity guard in the repo.
    const untranslated = LANGS.filter(
      (l) => l !== 'en' && characterCountOf(l)!.includes('Character count'),
    );
    expect(untranslated).toEqual([]);
  });
});

/**
 * `fields.textarea.charactersRemaining` — the near-limit warning
 * (objectui#3408).
 *
 * Same three guards, and one more that only applies to this key. #3406's
 * sentence is now a DESCRIPTION a screen reader reads on focus;
 * `charactersRemaining` is the only textarea copy still SPOKEN mid-typing, so
 * an English backfill here is heard by exactly the users who cannot see that
 * it is English.
 */
describe('fields.textarea.charactersRemaining locale coverage (objectui#3408)', () => {
  it.each(LANGS)('%s defines the near-limit sentence as a non-empty string', (lang) => {
    const value = charactersRemainingOf(lang);
    expect(typeof value, `${lang} has no fields.textarea.charactersRemaining`).toBe('string');
    expect(
      value!.trim().length,
      `${lang}.fields.textarea.charactersRemaining is empty`,
    ).toBeGreaterThan(0);
  });

  it.each(LANGS)('%s interpolates the remaining count and NOT the cap', (lang) => {
    const value = charactersRemainingOf(lang)!;
    expect(value, `${lang} drops {{count}}`).toContain('{{count}}');
    // The cap belongs to the description, which is read on focus. Repeating it
    // here would make the one interruption the design still permits longer
    // than it needs to be — the opposite of what #3408 is for.
    expect(value, `${lang} re-states {{max}} in the warning`).not.toContain('{{max}}');
  });

  it.each(LANGS)('%s stays grammatical at a count of 1 without plural forms', (lang) => {
    // `count` sends i18next to plural lookup (`_one` / `_few` / …) BEFORE the
    // base key, and no pack declares those forms — the base key is what
    // resolves, for every count. So the sentence may not contain a noun whose
    // form bends on the number in a way "1" would break. Mechanically: the
    // packs are written so `{{count}}` sits at an edge or after a colon,
    // never mid-clause in a way English/ru/de plural agreement would spoil.
    // The check that survives translation is the negative one — nobody smuggled
    // in the plural-suffixed KEY, which would silently resolve to nothing.
    const value = charactersRemainingOf(lang)!;
    expect(value).not.toContain('_one');
    expect(value).not.toContain('_other');
    const pack = (builtInLocales[lang] as any)?.fields?.textarea ?? {};
    expect(Object.keys(pack).filter((k) => k.startsWith('charactersRemaining_'))).toEqual([]);
  });

  it('the English pack matches the code default in `packages/fields`', () => {
    // `packages/i18n` cannot import `packages/fields` (the dependency runs the
    // other way), so this literal and `FIELD_DEFAULTS
    // ['fields.textarea.charactersRemaining']` are pinned to each other by
    // being spelled out in both places. The fields-side half is in
    // `TextAreaField.characterCount.no-provider.test.tsx`.
    expect(charactersRemainingOf('en')).toBe('Characters remaining: {{count}}');
  });

  it('no other pack serves the English sentence verbatim', () => {
    const untranslated = LANGS.filter(
      (l) => l !== 'en' && charactersRemainingOf(l)!.includes('Characters remaining'),
    );
    expect(untranslated).toEqual([]);
  });
});
