// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The first-run checklist's conditions (objectstack#30206), as pure functions:
 * what each row offers from the browser, and when each row is done. Done is
 * read from what the server answers, never from a click, so every case here
 * is a server answer in and a verdict out.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ORGANIZATION_NAME,
  browserRegion,
  dismissRecordKey,
  hasInvitedColleagues,
  isKeySet,
  isMailConfigured,
  isOrganizationNamed,
  localeOffer,
  localizationRows,
  markDismissed,
  wasDismissed,
  type ChecklistStorage,
} from '../firstRunChecklistLogic';
import type { ResolvedSettingValue, SettingsManifest, Specifier } from '../types';

const LOCALE_SPEC: Specifier = {
  type: 'select',
  key: 'locale',
  label: 'Default locale',
  default: 'en-US',
  options: [
    { value: 'en-US', label: 'English (US)' },
    { value: 'zh-CN', label: '中文（简体）' },
    { value: 'ja-JP', label: '日本語' },
    { value: 'es-ES', label: 'Español' },
  ],
};
const COUNTRY_SPEC: Specifier = {
  type: 'select',
  key: 'default_country',
  label: 'Default country',
  default: 'US',
  pattern: '^[A-Za-z]{2}$',
  valueDomain: 'iso_3166_alpha2',
  options: [
    { value: 'US', label: 'United States (US)' },
    { value: 'CN', label: 'China (CN)' },
  ],
};
const TIMEZONE_SPEC: Specifier = {
  type: 'select',
  key: 'timezone',
  label: 'Default timezone',
  default: 'UTC',
  valueDomain: 'iana_time_zone',
  options: [{ value: 'UTC', label: 'UTC' }],
};
const CURRENCY_SPEC: Specifier = {
  type: 'select',
  key: 'currency',
  label: 'Default currency',
  valueDomain: 'iso_4217_currency',
  options: [{ value: 'USD', label: 'US Dollar (USD)' }],
};

function manifest(specifiers: Specifier[] = [LOCALE_SPEC, COUNTRY_SPEC, TIMEZONE_SPEC, CURRENCY_SPEC]): SettingsManifest {
  return {
    namespace: 'localization',
    label: 'Localization',
    scope: 'tenant',
    writePermission: 'setup.write',
    specifiers,
  } as unknown as SettingsManifest;
}

function fromDefault(value: unknown): ResolvedSettingValue {
  return { value, source: 'default', locked: false, cascadeChain: [] } as unknown as ResolvedSettingValue;
}
function fromTenant(value: unknown): ResolvedSettingValue {
  return { value, source: 'tenant', locked: false, cascadeChain: [] } as unknown as ResolvedSettingValue;
}

const FRESH: Record<string, ResolvedSettingValue> = {
  locale: fromDefault('en-US'),
  default_country: fromDefault('US'),
  timezone: fromDefault('UTC'),
  currency: fromDefault(null),
};

describe('the browser offer: one language decides language, country and currency', () => {
  it('offers the locale option for the browser language, by exact tag, then maximized region, then sole language', () => {
    expect(localeOffer(LOCALE_SPEC, 'zh-CN')).toBe('zh-CN');
    expect(localeOffer(LOCALE_SPEC, 'zh')).toBe('zh-CN');
    expect(localeOffer(LOCALE_SPEC, 'en-GB')).toBe('en-US');
    expect(localeOffer(LOCALE_SPEC, 'fr-FR')).toBeUndefined();
    expect(localeOffer(LOCALE_SPEC, undefined)).toBeUndefined();
  });

  it('reads the country from the language, a bare language by its likely region, and never a non-country region', () => {
    expect(browserRegion('zh')).toBe('CN');
    expect(browserRegion('en-GB')).toBe('GB');
    expect(browserRegion('es-419')).toBeUndefined();
    expect(browserRegion('')).toBeUndefined();
  });

  it('pre-fills only what the write door would take, and only for unset keys', () => {
    const rows = localizationRows(manifest(), FRESH, { language: 'zh-CN', zone: 'Asia/Shanghai' });
    expect(rows.map((row) => row.id)).toEqual(['language_country', 'timezone', 'currency']);
    const offers = Object.fromEntries(rows.flatMap((row) => row.fields.map((f) => [f.key, f.offer])));
    expect(offers).toEqual({ locale: 'zh-CN', default_country: 'CN', timezone: 'Asia/Shanghai', currency: 'CNY' });

    const unknownZone = localizationRows(manifest(), FRESH, { language: 'zh-CN', zone: 'Etc/Unknown' });
    expect(unknownZone.find((row) => row.id === 'timezone')?.fields[0].offer).toBeUndefined();

    const set = localizationRows(manifest(), { ...FRESH, timezone: fromTenant('Europe/Berlin') }, { zone: 'Asia/Shanghai' });
    expect(set.find((row) => row.id === 'timezone')?.fields[0]).toMatchObject({ set: true });
    expect(set.find((row) => row.id === 'timezone')?.fields[0].offer).toBeUndefined();
  });
});

describe('done is read from the resolved value', () => {
  it('a key with a platform default is set once a rung other than the default holds it', () => {
    expect(isKeySet('timezone', fromDefault('UTC'))).toBe(false);
    expect(isKeySet('timezone', fromTenant('UTC'))).toBe(true);
    expect(isKeySet('locale', { ...fromDefault('en-US'), source: 'env', locked: true } as ResolvedSettingValue)).toBe(true);
  });

  it('the currency, which has no platform default, is set once any rung holds a value', () => {
    expect(isKeySet('currency', fromDefault(null))).toBe(false);
    expect(isKeySet('currency', fromDefault(''))).toBe(false);
    expect(isKeySet('currency', fromDefault('EUR'))).toBe(true);
    expect(isKeySet('currency', fromTenant('CNY'))).toBe(true);
  });

  it('a row is done when every key it edits is set, and leaves no row for a key the manifest retired', () => {
    const rows = localizationRows(manifest(), { ...FRESH, locale: fromTenant('zh-CN') }, {});
    expect(rows.find((row) => row.id === 'language_country')?.done).toBe(false);
    const both = localizationRows(manifest(), { ...FRESH, locale: fromTenant('zh-CN'), default_country: fromTenant('CN') }, {});
    expect(both.find((row) => row.id === 'language_country')?.done).toBe(true);

    const noCountry = localizationRows(manifest([LOCALE_SPEC, TIMEZONE_SPEC, CURRENCY_SPEC]), FRESH, {});
    expect(noCountry.map((row) => row.id)).toEqual(['timezone', 'currency']);
  });

  it('mail is done only when a delivering provider has a From address, and SMTP a host', () => {
    expect(isMailConfigured({ provider: fromDefault('smtp') })).toBe(false);
    expect(isMailConfigured({ provider: fromTenant('log'), from_email: fromTenant('a@b.co') })).toBe(false);
    expect(isMailConfigured({ provider: fromTenant('smtp'), from_email: fromTenant('a@b.co') })).toBe(false);
    expect(
      isMailConfigured({ provider: fromTenant('smtp'), from_email: fromTenant('a@b.co'), smtp_host: fromTenant('mx') }),
    ).toBe(true);
    expect(isMailConfigured({ provider: fromTenant('resend'), from_email: fromTenant('a@b.co') })).toBe(true);
  });

  it('the organization is named once it no longer carries the platform name', () => {
    expect(DEFAULT_ORGANIZATION_NAME).toBe('Default Organization');
    expect(isOrganizationNamed('Default Organization')).toBe(false);
    expect(isOrganizationNamed('  Default Organization ')).toBe(false);
    expect(isOrganizationNamed('')).toBe(false);
    expect(isOrganizationNamed(undefined)).toBe(false);
    expect(isOrganizationNamed('Acme')).toBe(true);
  });

  it('colleagues are invited once there is a second member or a pending invitation', () => {
    expect(hasInvitedColleagues([{}], [])).toBe(false);
    expect(hasInvitedColleagues([{}], [{ status: 'canceled' }, { status: 'accepted' }])).toBe(false);
    expect(hasInvitedColleagues([{}], [{ status: 'pending' }])).toBe(true);
    expect(hasInvitedColleagues([{}, {}], [])).toBe(true);
  });
});

describe('hiding the checklist is a per-device record, per workspace and user', () => {
  function memory(): ChecklistStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  it('keys the record on both ids, and reads it back', () => {
    const storage = memory();
    const key = dismissRecordKey('org_1', 'u_admin');
    expect(key).toBe('os:first-run-checklist:org_1:u_admin');
    expect(wasDismissed(storage, key)).toBe(false);
    expect(markDismissed(storage, key)).toBe(true);
    expect(wasDismissed(storage, key)).toBe(true);
    expect(wasDismissed(storage, dismissRecordKey('org_2', 'u_admin'))).toBe(false);
  });

  it('storage that cannot be read shows the checklist rather than hiding it', () => {
    const broken: ChecklistStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(wasDismissed(broken, 'k')).toBe(false);
    expect(wasDismissed(undefined, 'k')).toBe(false);
    expect(markDismissed(broken, 'k')).toBe(false);
  });
});
