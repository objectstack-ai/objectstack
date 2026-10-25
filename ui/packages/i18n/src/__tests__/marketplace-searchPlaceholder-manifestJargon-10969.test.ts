// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `marketplace.searchPlaceholder` names no manifest in any of the ten packs
 * (objectui#10969).
 *
 * objectui#10900 read 「按名称或 manifest ID 搜索应用…」 in the zh-CN cloud E2E:
 * "manifest ID" is the platform's word for a package's identifier, not the
 * customer's, and it replaced the jargon in zh only (标识, identifier). The
 * objection holds in every language, so `en` now names the "app ID" — the
 * identifier each marketplace card prints under its name — and the eight other
 * packs followed. zh already held no manifest word and is unchanged; its
 * `check:i18n-drift` waiver records that.
 *
 * A negative pin, because no i18n gate can see a value creep back: the key-set
 * gates compare keys, and `check:i18n-drift` only fires when `en` changes. The
 * word list is each pack's former spelling of the jargon, read off the packs
 * before this change. No regex on purpose (an ASCII class would miss the five
 * non-Latin packs): every entry is a literal substring, matched after
 * lower-casing both sides.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

/** Each pack's spelling of "manifest" before objectui#10969, plus the English. */
const MANIFEST_WORDS = [
  'manifest',
  'manifiesto',
  'manifeste',
  'マニフェスト',
  '매니페스트',
  'манифест',
  'المانيفست',
];

function placeholderOf(catalogue: unknown): string {
  const value = (catalogue as { marketplace?: { searchPlaceholder?: unknown } }).marketplace?.searchPlaceholder;
  expect(typeof value).toBe('string');
  return value as string;
}

describe('marketplace.searchPlaceholder — no manifest jargon in any pack (objectui#10969)', () => {
  it('covers all ten packs', () => {
    expect(Object.keys(builtInLocales)).toHaveLength(10);
  });

  it.each(Object.entries(builtInLocales))('%s: names no manifest', (_code, catalogue) => {
    const placeholder = placeholderOf(catalogue).toLowerCase();
    for (const word of MANIFEST_WORDS) {
      expect(placeholder).not.toContain(word.toLowerCase());
    }
  });

  it('en names the app ID', () => {
    expect(placeholderOf(builtInLocales.en)).toBe('Search apps by name or app ID…');
  });

  it('zh keeps the wording objectui#10900 chose', () => {
    expect(placeholderOf(builtInLocales.zh)).toBe('按名称或标识搜索应用…');
  });
});
