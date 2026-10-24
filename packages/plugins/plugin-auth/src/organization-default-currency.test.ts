// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25495] The derivation and composition halves of a new organization's
 * default currency, in isolation: the CLDR table, the locale → currency
 * mapping, the host-locale reading, the never-overwrite rule and the wrapping
 * of a host's `onOrganizationCreated`. The composed behaviour, through a real
 * `POST /organization/create` and the real settings service, is
 * `organization-created-default-currency.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import { isValueDomainMember } from '@objectstack/spec/shared';
import {
  REGION_CURRENCY,
  creatorLocaleForNewOrganization,
  currencyForLocale,
  hostLocaleFromEnv,
  seedOrganizationCurrency,
  withOrganizationDefaultCurrency,
  type CurrencySettingsDoor,
} from './organization-default-currency.js';

/** A settings door whose `localization.currency` resolves from `source` until something is written. */
function door(source: string) {
  const writes: Array<[string, string, unknown, Record<string, unknown> | undefined]> = [];
  const settings: CurrencySettingsDoor = {
    get: vi.fn(async () => ({ source })),
    set: vi.fn(async (namespace: string, key: string, value: unknown, ctx?: Record<string, unknown>) => {
      writes.push([namespace, key, value, ctx]);
      return undefined;
    }),
  };
  return { settings, writes };
}

const silent = { info: () => {}, warn: () => {}, debug: () => {} };

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

describe('hostLocaleFromEnv', () => {
  it('reads LANG the POSIX way, dropping the codeset and modifier', () => {
    expect(hostLocaleFromEnv({ LANG: 'zh_CN.UTF-8' })).toBe('zh-CN');
    expect(hostLocaleFromEnv({ LANG: 'de_DE@euro' })).toBe('de-DE');
  });

  it('LC_ALL outranks LC_MONETARY, which outranks LANG', () => {
    expect(hostLocaleFromEnv({ LC_ALL: 'ja_JP.UTF-8', LC_MONETARY: 'en_GB.UTF-8', LANG: 'zh_CN.UTF-8' })).toBe('ja-JP');
    expect(hostLocaleFromEnv({ LC_MONETARY: 'en_GB.UTF-8', LANG: 'zh_CN.UTF-8' })).toBe('en-GB');
    expect(hostLocaleFromEnv({ LC_ALL: '', LANG: 'zh_CN.UTF-8' })).toBe('zh-CN');
  });

  it('C, POSIX and an unset environment name no language — never the en-US Intl answers for them', () => {
    expect(hostLocaleFromEnv({})).toBeUndefined();
    expect(hostLocaleFromEnv({ LANG: 'C' })).toBeUndefined();
    expect(hostLocaleFromEnv({ LANG: 'C.UTF-8' })).toBeUndefined();
    expect(hostLocaleFromEnv({ LC_ALL: 'POSIX', LANG: 'zh_CN.UTF-8' })).toBeUndefined();
  });
});

describe('seedOrganizationCurrency', () => {
  it('writes the derived currency as the organization\'s tenant value while the key resolves from the default', async () => {
    const { settings, writes } = door('default');
    await expect(seedOrganizationCurrency(settings, 'org_1', 'zh-CN')).resolves.toEqual({ kind: 'written', currency: 'CNY' });
    expect(writes).toEqual([['localization', 'currency', 'CNY', { tenantId: 'org_1' }]]);
  });

  it.each(['tenant', 'global', 'env'])('never over a value on the %s rung', async (source) => {
    const { settings, writes } = door(source);
    await expect(seedOrganizationCurrency(settings, 'org_1', 'zh-CN')).resolves.toEqual({ kind: 'kept', source });
    expect(writes).toEqual([]);
  });

  it('nothing to derive from: no read, no write', async () => {
    const { settings, writes } = door('default');
    await expect(seedOrganizationCurrency(settings, 'org_1', undefined)).resolves.toEqual({ kind: 'underivable' });
    await expect(seedOrganizationCurrency(settings, 'org_1', 'es-419')).resolves.toEqual({ kind: 'underivable' });
    expect(settings.get).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

describe('creatorLocaleForNewOrganization', () => {
  const engineWith = (row: Record<string, unknown> | undefined) =>
    ({ find: vi.fn(async () => (row ? [row] : [])) }) as any;

  it('the stored sys_user.locale outranks the request', async () => {
    await expect(
      creatorLocaleForNewOrganization(engineWith({ id: 'u1', locale: 'ja-JP' }), 'u1', 'zh-CN,zh;q=0.9'),
    ).resolves.toEqual({ locale: 'ja-JP', from: "the creator's stored language" });
  });

  it('no stored locale: the request\'s preferred Accept-Language tag', async () => {
    await expect(
      creatorLocaleForNewOrganization(engineWith({ id: 'u1', locale: null }), 'u1', 'zh-CN,zh;q=0.9,en;q=0.8'),
    ).resolves.toEqual({ locale: 'zh-CN', from: "the creating request's Accept-Language" });
  });

  it('neither: undefined, and `*` is no preference', async () => {
    await expect(creatorLocaleForNewOrganization(engineWith({ id: 'u1' }), 'u1', undefined)).resolves.toBeUndefined();
    await expect(creatorLocaleForNewOrganization(engineWith(undefined), 'u1', '*')).resolves.toBeUndefined();
  });
});

describe('withOrganizationDefaultCurrency', () => {
  it('runs the host callback first, so a currency the host sets is kept', async () => {
    const order: string[] = [];
    let hostWrote = false;
    const settings: CurrencySettingsDoor = {
      get: vi.fn(async () => {
        order.push('currency');
        return { source: hostWrote ? 'tenant' : 'default' };
      }),
      set: vi.fn(async () => undefined),
    };
    const host = vi.fn(async () => {
      order.push('host');
      hostWrote = true;
    });
    const engine = { find: vi.fn(async () => [{ id: 'u1', locale: 'zh-CN' }]) } as any;
    const wrapped = withOrganizationDefaultCurrency(host, { dataEngine: engine, getSettings: () => settings, logger: silent });

    await wrapped({ organizationId: 'org_1', userId: 'u1' });
    expect(order).toEqual(['host', 'currency']);
    expect(host).toHaveBeenCalledWith({ organizationId: 'org_1', userId: 'u1' });
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('a host callback that throws still throws, after the currency step ran', async () => {
    const { settings, writes } = door('default');
    const engine = { find: vi.fn(async () => [{ id: 'u1', locale: 'zh-CN' }]) } as any;
    const failure = new Error('provisioning down');
    const wrapped = withOrganizationDefaultCurrency(
      async () => {
        throw failure;
      },
      { dataEngine: engine, getSettings: () => settings, logger: silent },
    );
    await expect(wrapped({ organizationId: 'org_1', userId: 'u1' })).rejects.toBe(failure);
    expect(writes).toEqual([['localization', 'currency', 'CNY', { tenantId: 'org_1' }]]);
  });

  it('a creator whose row cannot be read gets nothing written, and the miss is logged once at warn', async () => {
    const { settings, writes } = door('default');
    const engine = { find: vi.fn(async () => { throw new Error('db down'); }) } as any;
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const wrapped = withOrganizationDefaultCurrency(undefined, { dataEngine: engine, getSettings: () => settings, logger });
    await expect(wrapped({ organizationId: 'org_1', userId: 'u1' })).resolves.toBeUndefined();
    expect(writes).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
