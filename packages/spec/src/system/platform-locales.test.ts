// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins for the platform locale table (ruling F of #29349, phase 1 of #29428,
// card #30001): the table whole, its read aliases one by one, the
// case-insensitive lookup and the closed list (no region fallback).

import { describe, it, expect } from 'vitest';
import {
  PLATFORM_LOCALES,
  PLATFORM_LOCALE_TAGS,
  PLATFORM_LOCALE_READ_ALIASES,
  platformLocaleTagOf,
  type PlatformLocaleReadAlias,
  type PlatformLocaleTag,
} from './platform-locales';
import * as SystemBarrel from './index';

describe('PLATFORM_LOCALES: the table, pinned whole', () => {
  it('holds the eleven languages, in menu order, with their native labels and rtl only on ar', () => {
    expect(PLATFORM_LOCALES).toEqual([
      { tag: 'en', label: 'English', rtl: false },
      { tag: 'zh-Hans', label: '简体中文', rtl: false },
      { tag: 'zh-Hant', label: '繁體中文', rtl: false },
      { tag: 'es', label: 'Español', rtl: false },
      { tag: 'ar', label: 'العربية', rtl: true },
      { tag: 'fr', label: 'Français', rtl: false },
      { tag: 'pt-BR', label: 'Português (Brasil)', rtl: false },
      { tag: 'ru', label: 'Русский', rtl: false },
      { tag: 'de', label: 'Deutsch', rtl: false },
      { tag: 'ja', label: '日本語', rtl: false },
      { tag: 'ko', label: '한국어', rtl: false },
    ]);
    expect(PLATFORM_LOCALES.filter((row) => row.rtl).map((row) => row.tag)).toEqual(['ar']);
  });

  it('PLATFORM_LOCALE_TAGS is the table tags in table order', () => {
    expect(PLATFORM_LOCALE_TAGS).toEqual(PLATFORM_LOCALES.map((row) => row.tag));
    expect(new Set(PLATFORM_LOCALE_TAGS).size).toBe(PLATFORM_LOCALE_TAGS.length);
  });

  it('the table, every row, the tag list and the alias map are frozen', () => {
    expect(Object.isFrozen(PLATFORM_LOCALES)).toBe(true);
    for (const row of PLATFORM_LOCALES) expect(Object.isFrozen(row)).toBe(true);
    expect(Object.isFrozen(PLATFORM_LOCALE_TAGS)).toBe(true);
    expect(Object.isFrozen(PLATFORM_LOCALE_READ_ALIASES)).toBe(true);
  });

  it('is exported from the system barrel', () => {
    expect(SystemBarrel.PLATFORM_LOCALES).toBe(PLATFORM_LOCALES);
    expect(SystemBarrel.PLATFORM_LOCALE_TAGS).toBe(PLATFORM_LOCALE_TAGS);
    expect(SystemBarrel.PLATFORM_LOCALE_READ_ALIASES).toBe(PLATFORM_LOCALE_READ_ALIASES);
    expect(SystemBarrel.platformLocaleTagOf).toBe(platformLocaleTagOf);
  });
});

describe('PLATFORM_LOCALE_READ_ALIASES: stored codes keep resolving', () => {
  const ALIASES: ReadonlyArray<readonly [PlatformLocaleReadAlias, PlatformLocaleTag]> = [
    ['zh', 'zh-Hans'],
    ['zh-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-MO', 'zh-Hant'],
    // The script-subtag spellings of the five regional aliases (#30618).
    ['zh-Hans-CN', 'zh-Hans'],
    ['zh-Hans-SG', 'zh-Hans'],
    ['zh-Hant-TW', 'zh-Hant'],
    ['zh-Hant-HK', 'zh-Hant'],
    ['zh-Hant-MO', 'zh-Hant'],
    ['ja-JP', 'ja'],
    ['es-ES', 'es'],
    ['pt', 'pt-BR'],
    ['en-US', 'en'],
  ];

  it.each(ALIASES)('%s reads as %s', (code, tag) => {
    expect(PLATFORM_LOCALE_READ_ALIASES[code]).toBe(tag);
    expect(platformLocaleTagOf(code)).toBe(tag);
  });

  it('the map is exactly those fifteen aliases', () => {
    expect(PLATFORM_LOCALE_READ_ALIASES).toEqual(Object.fromEntries(ALIASES));
  });

  it('the map is typed on its fifteen literal keys: an unlisted code does not index it as defined', () => {
    const zhCN: 'zh-Hans' = PLATFORM_LOCALE_READ_ALIASES['zh-CN'];
    expect(zhCN).toBe('zh-Hans');
    const zhHantTW: 'zh-Hant' = PLATFORM_LOCALE_READ_ALIASES['zh-Hant-TW'];
    expect(zhHantTW).toBe('zh-Hant');
    // @ts-expect-error `pt-PT` is not a read alias, so the index is not typed as a table tag.
    expect(PLATFORM_LOCALE_READ_ALIASES['pt-PT']).toBeUndefined();
  });

  it('every alias target is a table tag', () => {
    for (const tag of Object.values(PLATFORM_LOCALE_READ_ALIASES)) {
      expect(PLATFORM_LOCALE_TAGS).toContain(tag);
    }
  });

  it('no alias key is itself a table tag, in any case', () => {
    const folded = new Set(PLATFORM_LOCALE_TAGS.map((tag) => tag.toLowerCase()));
    for (const code of Object.keys(PLATFORM_LOCALE_READ_ALIASES)) {
      expect(folded.has(code.toLowerCase())).toBe(false);
    }
  });
});

describe('platformLocaleTagOf', () => {
  it.each(PLATFORM_LOCALE_TAGS.map((tag) => [tag]))('the table tag %s answers itself', (tag) => {
    expect(platformLocaleTagOf(tag)).toBe(tag);
  });

  // BCP 47 tags are case-insensitive, and stored user locales are not all in
  // canonical case (#29895 records `zh-cn`).
  it.each([
    ['zh-cn', 'zh-Hans'],
    ['ZH-TW', 'zh-Hant'],
    ['zh-hans', 'zh-Hans'],
    ['ZH-HANT', 'zh-Hant'],
    ['pt-br', 'pt-BR'],
    ['EN', 'en'],
    ['en-us', 'en'],
    ['ja-jp', 'ja'],
    ['ZH-HANS-cn', 'zh-Hans'],
    ['zh-hans-sg', 'zh-Hans'],
    ['ZH-HANT-tw', 'zh-Hant'],
    ['zh-hant-hk', 'zh-Hant'],
    ['Zh-Hant-Mo', 'zh-Hant'],
  ])('ignores case: %s reads as %s', (code, tag) => {
    expect(platformLocaleTagOf(code)).toBe(tag);
  });

  // The list is closed: no region or script fallback is guessed. A
  // script-subtag spelling without its own row (`zh-Hant-US`, `zh-Hans-US`)
  // answers undefined too: the rows are read one by one, never as a pattern.
  it.each(['pt-PT', 'de-AT', 'en-GB', 'es-419', 'fr-CA', 'it', 'he', 'zh-Hant-US', 'zh-Hans-US'])(
    'a code the table and the aliases do not list, %s, answers undefined',
    (code) => {
      expect(platformLocaleTagOf(code)).toBeUndefined();
    },
  );

  it.each(['zh_CN', ' en', 'en ', 'Chinese', '', 'constructor', 'toString', '__proto__'])(
    'nothing but case is corrected: %j answers undefined',
    (code) => {
      expect(platformLocaleTagOf(code)).toBeUndefined();
    },
  );

  it.each([undefined, null, 42, {}, ['en']])('a non-string, %j, answers undefined', (value) => {
    expect(platformLocaleTagOf(value)).toBeUndefined();
  });
});
