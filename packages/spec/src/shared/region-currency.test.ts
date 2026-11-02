// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `shared/region-currency.ts`: the checked-in CLDR region → currency table and
 * its lookup, read by plugin-auth (a new organization's currency) and by the
 * console (the workspace prompt's offer). Both readers' own tests drive them
 * through this module; the table and the mapping are pinned here, once.
 */

import { describe, expect, it } from 'vitest';
import { REGION_CURRENCY, currencyForLocale } from './region-currency';
import { isValueDomainMember } from './value-domain.zod';
import * as shared from './index';

describe('REGION_CURRENCY — the checked-in CLDR snapshot', () => {
  it('holds only codes the settings key accepts (the iso_4217_currency value domain)', () => {
    const outside = Object.entries(REGION_CURRENCY).filter(([, code]) => !isValueDomainMember('iso_4217_currency', code));
    expect(outside).toEqual([]);
  });

  it('carries the regions the card names, and none of the CLDR regions with no current tender', () => {
    expect(REGION_CURRENCY).toMatchObject({ CN: 'CNY', JP: 'JPY', GB: 'GBP', DE: 'EUR', FR: 'EUR', US: 'USD' });
    for (const region of ['AQ', 'ZZ', 'SU', 'YU']) expect(REGION_CURRENCY).not.toHaveProperty(region);
    expect(Object.keys(REGION_CURRENCY)).toHaveLength(255);
  });
});

describe('currencyForLocale', () => {
  it.each([
    ['zh-CN', 'CNY'],
    ['zh', 'CNY'],
    ['ja', 'JPY'],
    ['ja-JP', 'JPY'],
    ['en-GB', 'GBP'],
    ['de', 'EUR'],
    ['fr-FR', 'EUR'],
    ['en', 'USD'],
    ['zh-Hant', 'TWD'],
    ['  zh-CN  ', 'CNY'],
  ])('%s → %s', (tag, currency) => {
    expect(currencyForLocale(tag)).toBe(currency);
  });

  it.each([
    ['a region that is not a country', 'es-419'],
    ['another region that is not a country', 'en-150'],
    ['a malformed tag', 'not a tag!'],
    ['an empty string', ''],
    ['undefined', undefined],
    ['a non-string', 42],
  ])('%s maps to nothing', (_label, tag) => {
    expect(currencyForLocale(tag)).toBeUndefined();
  });
});

describe('the @objectstack/spec/shared entry', () => {
  it('re-exports the one table and the one lookup, not copies', () => {
    expect(shared.REGION_CURRENCY).toBe(REGION_CURRENCY);
    expect(shared.currencyForLocale).toBe(currencyForLocale);
  });
});
