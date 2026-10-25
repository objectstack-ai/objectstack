/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The display-locale tag → date-fns `Locale` resolution the date faces share
 * (objectui#10722): `lib/date-fns-locale.ts`.
 *
 * Two facts are held here. Each loader line loads the locale its key names, so
 * a mistyped specifier or export name goes red rather than silently reading
 * enUS. And the chain in the module header answers the tags this product meets:
 * the ten UI languages and the regional display locales a tenant declares.
 */

import { describe, expect, it } from 'vitest';
import { BUILT_IN_LANGUAGE_CODES } from '@object-ui/i18n';
import { enUS } from 'date-fns/locale/en-US';
import {
  DATE_LOCALE_KEYS,
  dateLocaleKeyFor,
  loadDateLocale,
  loadedDateLocale,
} from '../lib/date-fns-locale';

describe('the date-fns locale loaders (objectui#10722)', () => {
  it('each key loads the locale whose `code` it is', async () => {
    const wrong: string[] = [];
    for (const key of DATE_LOCALE_KEYS) {
      const locale = await loadDateLocale(key);
      if (locale.code !== key) wrong.push(`${key} loaded ${locale.code}`);
    }
    expect(wrong).toEqual([]);
    // The population is not empty, and it includes the static fallback.
    expect(DATE_LOCALE_KEYS).toContain('en-US');
    expect(DATE_LOCALE_KEYS).toContain('de');
  });

  it('holds enUS resident from the start, and a loaded locale afterwards', async () => {
    expect(loadedDateLocale('en-US')).toBe(enUS);
    const nb = await loadDateLocale('nb');
    expect(loadedDateLocale('nb')).toBe(nb);
    expect(await loadDateLocale('nb')).toBe(nb);
  });
});

describe('the tag → locale chain (objectui#10722)', () => {
  it.each([
    ['de-CH', 'de'],
    ['de', 'de'],
    ['de-AT', 'de-AT'],
    ['en', 'en-US'],
    ['en-US', 'en-US'],
    ['en-GB', 'en-GB'],
    ['EN-gb', 'en-GB'],
    ['zh', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['zh-Hant', 'zh-TW'],
    ['sr-Latn-RS', 'sr-Latn'],
    ['pt', 'pt'],
    ['pt-BR', 'pt-BR'],
    ['fr-CH', 'fr-CH'],
    ['it-IT', 'it'],
  ])('%s reads %s', (tag, key) => {
    expect(dateLocaleKeyFor(tag)).toBe(key);
  });

  it.each([['sw-KE'], ['not a tag'], ['']])('%j reads enUS', (tag) => {
    expect(dateLocaleKeyFor(tag)).toBe('en-US');
  });

  it('gives every UI language this product ships a locale of its own', () => {
    const keys = Object.fromEntries(BUILT_IN_LANGUAGE_CODES.map((code) => [code, dateLocaleKeyFor(code)]));
    // `en` reads `en-US`, the enUS every face read before; the others must not
    // fall through to it.
    expect(keys.en).toBe('en-US');
    const fellThrough = Object.entries(keys).filter(([code, key]) => code !== 'en' && key === 'en-US');
    expect(fellThrough).toEqual([]);
  });
});
