// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `filterBuilder.where` is retired from every locale pack (objectstack#35549).
 *
 * The advanced filter panel opened with a 「Where」 / 「其中」 label in front of
 * its rows. The list redo dropped it (seat ruling Q3): the panel now sits
 * behind the shared field list's 「Advanced filter」 footer, and the rows start
 * it. `FilterBuilder` reads `filterBuilder.and` as its probe key in its place.
 *
 * The i18n gates run call site → key, so a key with no reader is never visited
 * and one returning to every pack keeps parity green: this pin is the only
 * thing that goes red if it comes back (the `common-search-retired-4392`
 * reasoning).
 */
import { describe, it, expect } from 'vitest';
import { PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';
import { builtInLocales } from '../locales/index';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];
const filterBuilderOf = (lang: LocaleCode) =>
  (builtInLocales[lang] as unknown as { filterBuilder?: Record<string, unknown> }).filterBuilder;

describe('`filterBuilder.where` is retired (objectstack#35549)', () => {
  it('no pack defines it, and every pack keeps its filterBuilder neighbours', () => {
    expect(LANGS).toHaveLength(PLATFORM_LOCALE_TAGS.length);
    const revived: string[] = [];
    for (const lang of LANGS) {
      const ns = filterBuilderOf(lang);
      expect(ns, `${lang} lost the filterBuilder root`).toBeDefined();
      if (ns && 'where' in ns) revived.push(lang);
      // The neighbours the deletion swept around, and the new probe key.
      for (const key of ['and', 'or', 'clearAll']) {
        expect(typeof ns?.[key], `${lang} :: filterBuilder.${key}`).toBe('string');
      }
    }
    expect(revived, '`filterBuilder.where` is back in a pack; the advanced filter draws no Where label').toEqual([]);
  });
});
