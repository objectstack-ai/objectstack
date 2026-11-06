// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Every module-local copy table this package writes carries every language on
// the platform locale table, and a caller's code finds its own language's
// entry: `zh-TW` the Traditional one (never the Simplified), a stored alias
// its table language, anything else English.

import { describe, it, expect } from 'vitest';
import { PLATFORM_LOCALE_TAGS, type PlatformLocaleTag } from '@objectstack/spec/system';
import type { SettingsCopyLocale } from './settings-copy-locale.js';
import { CURRENCY_LOCK_COPY, currencyLockCopy } from './localization-currency-lock.js';
import { NOT_OFFERED_COPY, notOfferedCopy } from './localization-locale-options.js';
import { SETTINGS_ACTION_COPY, settingsActionCopy } from './settings-action-copy.js';

/** The key each platform table tag is served by. */
const KEY_OF_TAG: Record<PlatformLocaleTag, SettingsCopyLocale> = {
  en: 'en', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-Hant', es: 'es-ES', ar: 'ar', fr: 'fr',
  'pt-BR': 'pt-BR', ru: 'ru', de: 'de', ja: 'ja-JP', ko: 'ko',
};
const KEYS = PLATFORM_LOCALE_TAGS.map((tag) => KEY_OF_TAG[tag]);

/** Sample arguments per field, so a function field renders a sentence. */
const SAMPLE_ARGS: Record<string, unknown[]> = {
  objects: [2, 'Invoice, Order'],
  rates: [14],
  refusal: ['USD', '2 objects'],
  lockedLabel: ['USD'],
  lockedText: ['2 objects'],
  unsetText: ['2 objects'],
  resetCleared: [3],
  noHandler: ['probe', 'branding'],
};

/** An entry's sentences, functions called with sample arguments. */
function sentences(entry: unknown): Record<string, string> {
  if (typeof entry === 'string') return { text: entry };
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(entry as Record<string, unknown>)) {
    out[field] = typeof value === 'function' ? value(...(SAMPLE_ARGS[field] ?? [])) : String(value);
  }
  return out;
}

const TABLES = [
  { name: 'currency lock', table: CURRENCY_LOCK_COPY as Record<string, unknown>, lookup: currencyLockCopy as (l?: string) => unknown },
  { name: 'no longer offered', table: NOT_OFFERED_COPY, lookup: notOfferedCopy },
  { name: 'built-in action answers', table: SETTINGS_ACTION_COPY, lookup: settingsActionCopy },
];

/** Separators that are legitimately the same in English and another language. */
const SHARED_PUNCTUATION = new Set(['and', 'listSeparator']);

describe.each(TABLES)('$name copy carries the eleven platform languages', ({ table, lookup }) => {
  it('has exactly one entry per platform locale table language', () => {
    expect(Object.keys(table).sort()).toEqual([...KEYS].sort());
    expect(KEYS).toHaveLength(11);
  });

  it('every entry carries every sentence, written in its own language (no English fill)', () => {
    const en = sentences(table.en);
    for (const key of KEYS) {
      const own = sentences(table[key]);
      expect(Object.keys(own).sort(), key).toEqual(Object.keys(en).sort());
      for (const [field, text] of Object.entries(own)) {
        if (SHARED_PUNCTUATION.has(field)) continue;
        expect(text.trim(), `${key}.${field}`).not.toBe('');
        if (key !== 'en') expect(text, `${key}.${field}`).not.toBe(en[field]);
      }
    }
  });

  it('each table tag and stored alias is served its own language; zh-TW never the Simplified entry', () => {
    for (const tag of PLATFORM_LOCALE_TAGS) expect(lookup(tag), tag).toBe(table[KEY_OF_TAG[tag]]);
    for (const [code, key] of [
      ['zh-TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'], ['zh-CN', 'zh-CN'], ['zh', 'zh-CN'],
      ['ja-JP', 'ja-JP'], ['es-ES', 'es-ES'], ['pt', 'pt-BR'], ['en-US', 'en'], ['fr-CA', 'fr'], ['de-AT', 'de'],
    ] as const) {
      expect(lookup(code), code).toBe(table[key]);
    }
  });

  it('a code naming no language here, or none at all, is served English', () => {
    for (const code of ['xx', 'sw-KE', undefined]) expect(lookup(code), String(code)).toBe(table.en);
  });
});
