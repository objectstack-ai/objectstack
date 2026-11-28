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
  aiProviderState,
  browserRegion,
  checklistCompletion,
  dismissRecordKey,
  drawsOneLine,
  hasInvitedColleagues,
  isKeySet,
  isMailConfigured,
  isMailDelivering,
  isOptionalRow,
  isOrganizationNamed,
  localeOffer,
  organizationBasics,
  markDismissed,
  wasDismissed,
  NOT_SHOWN_RECORD_TTL_MS,
  markAnsweredNotShown,
  notShownRecordKey,
  wasAnsweredNotShown,
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
    const basics = organizationBasics(manifest(), FRESH, { language: 'zh-CN', zone: 'Asia/Shanghai' }, 'Acme');
    expect(basics.fields.map((f) => f.key)).toEqual(['locale', 'default_country', 'timezone', 'currency']);
    const offers = Object.fromEntries(basics.fields.map((f) => [f.key, f.offer]));
    expect(offers).toEqual({ locale: 'zh-CN', default_country: 'CN', timezone: 'Asia/Shanghai', currency: 'CNY' });

    const unknownZone = organizationBasics(manifest(), FRESH, { language: 'zh-CN', zone: 'Etc/Unknown' }, 'Acme');
    expect(unknownZone.fields.find((f) => f.key === 'timezone')?.offer).toBeUndefined();

    const set = organizationBasics(manifest(), { ...FRESH, timezone: fromTenant('Europe/Berlin') }, { zone: 'Asia/Shanghai' }, 'Acme');
    expect(set.fields.find((f) => f.key === 'timezone')).toMatchObject({ set: true });
    expect(set.fields.find((f) => f.key === 'timezone')?.offer).toBeUndefined();
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

  it('the basics are done once the organization has a name of its own and every key is set (objectstack#36739)', () => {
    const allSet = {
      locale: fromTenant('zh-CN'),
      default_country: fromTenant('CN'),
      timezone: fromTenant('Asia/Shanghai'),
      currency: fromTenant('CNY'),
    };
    expect(organizationBasics(manifest(), allSet, {}, 'Acme')).toMatchObject({ named: true, done: true });
    // One key left unset keeps the one row open.
    expect(organizationBasics(manifest(), { ...allSet, currency: fromDefault(null) }, {}, 'Acme').done).toBe(false);
    // CONTROL: every key set, the name the platform gave it: not done.
    expect(organizationBasics(manifest(), allSet, {}, DEFAULT_ORGANIZATION_NAME)).toMatchObject({ named: false, done: false });
    expect(organizationBasics(manifest(), allSet, {}, '  ').done).toBe(false);
  });

  it('a key the manifest retired is no field of the form, and does not hold the row open', () => {
    const noCountry = organizationBasics(
      manifest([LOCALE_SPEC, TIMEZONE_SPEC, CURRENCY_SPEC]),
      { ...FRESH, locale: fromTenant('zh-CN'), timezone: fromTenant('UTC'), currency: fromTenant('CNY') },
      {},
      'Acme',
    );
    expect(noCountry.fields.map((f) => f.key)).toEqual(['locale', 'timezone', 'currency']);
    expect(noCountry.done).toBe(true);
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

  it('mail follows the provider the running system states (live.provider), the saved values only without that statement', () => {
    const saved = { provider: fromTenant('smtp'), from_email: fromTenant('a@b.co'), smtp_host: fromTenant('mx') };
    // Configured through the deployment's environment: nothing saved, still delivering.
    expect(isMailDelivering({ values: {}, live: { provider: { value: 'smtp', source: 'environment' } } })).toBe(true);
    expect(isMailDelivering({ values: {}, live: { provider: { value: 'resend', source: 'settings' } } })).toBe(true);
    // The development log delivers nothing: not done, even over saved values that would pass.
    expect(isMailDelivering({ values: saved, live: { provider: { value: null, source: 'none' } } })).toBe(false);
    // CONTROL: no statement, so the saved values decide, as before.
    expect(isMailDelivering({ values: saved })).toBe(true);
    expect(isMailDelivering({ values: { provider: fromTenant('log'), from_email: fromTenant('a@b.co') } })).toBe(false);
    expect(isMailDelivering({ values: saved, live: {} })).toBe(true);
    expect(isMailDelivering({ values: {}, live: {} })).toBe(false);
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

describe('"not shown" is a per-device answer, per workspace, user and capability set, for a day (objectstack#37182)', () => {
  function memory(): ChecklistStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }
  const HELD = 'setup.access\nsetup.write';
  const T0 = Date.UTC(2026, 10, 25, 2, 0, 0);

  it('keys the record on both ids, apart from the dismiss record, and reads it back for the same capability set', () => {
    const storage = memory();
    const key = notShownRecordKey('org_1', 'u_owner');
    expect(key).toBe('os:first-run-checklist-not-shown:org_1:u_owner');
    expect(key).not.toBe(dismissRecordKey('org_1', 'u_owner'));
    expect(wasAnsweredNotShown(storage, key, HELD, T0)).toBe(false);
    expect(markAnsweredNotShown(storage, key, HELD, T0)).toBe(true);
    expect(wasAnsweredNotShown(storage, key, HELD, T0 + 1000)).toBe(true);
    expect(wasAnsweredNotShown(storage, notShownRecordKey('org_2', 'u_owner'), HELD, T0 + 1000)).toBe(false);
  });

  it('a changed capability set reads again', () => {
    const storage = memory();
    const key = notShownRecordKey('org_1', 'u_owner');
    markAnsweredNotShown(storage, key, HELD, T0);
    expect(wasAnsweredNotShown(storage, key, `${HELD}\nmanage_platform_settings`, T0 + 1000)).toBe(false);
    expect(wasAnsweredNotShown(storage, key, 'setup.access', T0 + 1000)).toBe(false);
  });

  it('stands for a day, then reads again; a record dated in the future reads again', () => {
    const storage = memory();
    const key = notShownRecordKey('org_1', 'u_owner');
    markAnsweredNotShown(storage, key, HELD, T0);
    expect(wasAnsweredNotShown(storage, key, HELD, T0 + NOT_SHOWN_RECORD_TTL_MS - 1)).toBe(true);
    expect(wasAnsweredNotShown(storage, key, HELD, T0 + NOT_SHOWN_RECORD_TTL_MS)).toBe(false);
    expect(wasAnsweredNotShown(storage, key, HELD, T0 - 1)).toBe(false);
  });

  it('storage that cannot be read, or a record that does not parse, reads again', () => {
    const broken: ChecklistStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(wasAnsweredNotShown(broken, 'k', HELD, T0)).toBe(false);
    expect(wasAnsweredNotShown(undefined, 'k', HELD, T0)).toBe(false);
    expect(markAnsweredNotShown(broken, 'k', HELD, T0)).toBe(false);
    const storage = memory();
    for (const raw of ['not json', 'null', '2026-11-25T00:00:00.000Z', JSON.stringify({ held: HELD }), JSON.stringify({ held: HELD, at: 'x' })]) {
      storage.data.set('k', raw);
      expect(wasAnsweredNotShown(storage, 'k', HELD, T0)).toBe(false);
    }
  });
});

describe('completion: the basics are required; mail, invite and both AI rows are optional (objectstack#32643, objectstack#36739)', () => {
  it('only the basics done, every optional row not: complete, and the progress counts every row', () => {
    const rows = [
      { id: 'organization_basics', done: true },
      { id: 'mail', done: false },
      { id: 'invite', done: false },
      { id: 'ai_provider', done: false },
      { id: 'connect_assistant', done: false },
    ];
    expect(checklistCompletion(rows)).toEqual({ done: 1, total: 5, complete: true });
  });

  it('CONTROL: the basics not done keep it open, whatever the optional rows say', () => {
    const rows = [
      { id: 'organization_basics', done: false },
      { id: 'mail', done: true },
      { id: 'invite', done: true },
      { id: 'ai_provider', done: true },
      { id: 'connect_assistant', done: true },
    ];
    expect(checklistCompletion(rows)).toEqual({ done: 4, total: 5, complete: false });
  });

  it('exactly the four rows the rulings name are optional on the platform', () => {
    for (const id of ['mail', 'invite', 'ai_provider', 'connect_assistant']) expect(isOptionalRow(id)).toBe(true);
    for (const id of ['organization_basics', 'first_app', 'first_record']) expect(isOptionalRow(id)).toBe(false);
  });

  it('no row drawn: complete, nothing to count', () => {
    expect(checklistCompletion([])).toEqual({ done: 0, total: 0, complete: true });
  });
});

describe('in use is read from the stated source, never from a null value (objectstack#34749)', () => {
  // A host's own transport, which no option names, is stated `{ value: null, source: 'environment' }`.
  const HOST_OWN = { value: null, source: 'environment' } as const;
  const SAVED = { provider: fromTenant('smtp'), from_email: fromTenant('a@b.co'), smtp_host: fromTenant('mx') };

  it('mail: environment with a null value delivers; none does not; settings with an empty value does not', () => {
    expect(isMailDelivering({ values: {}, live: { provider: HOST_OWN } })).toBe(true);
    expect(isMailDelivering({ values: {}, live: { provider: { value: null, source: 'none' } } })).toBe(false);
    expect(isMailDelivering({ values: SAVED, live: { provider: { value: '', source: 'settings' } } })).toBe(false);
  });

  it('mail: saved values that would pass, under a host-own transport, read done from the statement', () => {
    expect(isMailConfigured(SAVED)).toBe(true);
    expect(isMailDelivering({ values: SAVED, live: { provider: HOST_OWN } })).toBe(true);
    // The statement decides, not the saved values: the same host-own statement over nothing that would pass.
    expect(isMailDelivering({ values: { provider: fromTenant('log') }, live: { provider: HOST_OWN } })).toBe(true);
  });

  it('CONTROL mail: a payload without the statement still falls back to the saved values', () => {
    expect(isMailDelivering({ values: SAVED })).toBe(true);
    expect(isMailDelivering({ values: {} })).toBe(false);
  });

  const AI_MANIFEST = {
    namespace: 'ai',
    label: 'AI',
    scope: 'global',
    writePermission: 'manage_platform_settings',
    specifiers: [{ type: 'select', key: 'provider', label: 'Provider', options: [{ value: 'openai', label: 'OpenAI' }] }],
  } as unknown as SettingsManifest;

  it('ai: environment with a null value is done, its source kept, with no option to name it by', () => {
    expect(aiProviderState({ manifest: AI_MANIFEST, live: { provider: HOST_OWN } })).toEqual({
      done: true,
      value: null,
      source: 'environment',
    });
  });

  it('ai: none is not done', () => {
    expect(aiProviderState({ manifest: AI_MANIFEST, live: { provider: { value: null, source: 'none' } } })).toEqual({
      done: false,
      value: null,
      source: 'none',
    });
  });

  it('CONTROL ai: a provider named by an option keeps its value, source and label', () => {
    expect(aiProviderState({ manifest: AI_MANIFEST, live: { provider: { value: 'openai', source: 'environment' } } })).toEqual({
      done: true,
      value: 'openai',
      source: 'environment',
      optionLabel: 'OpenAI',
    });
  });
});

describe('above the page the card folds to one line once two rows or fewer are left', () => {
  const rows = (left: number, done = 4) => [
    ...Array.from({ length: done }, (_, i) => ({ done: true, id: `d${i}` })),
    ...Array.from({ length: left }, (_, i) => ({ done: false, id: `l${i}` })),
  ];

  it('one or two rows left, optional ones counted alike: one line', () => {
    expect(drawsOneLine(rows(1))).toBe(true);
    expect(drawsOneLine(rows(2))).toBe(true);
  });

  it('CONTROL: three rows left, or none, draws no line', () => {
    expect(drawsOneLine(rows(3))).toBe(false);
    expect(drawsOneLine(rows(0))).toBe(false);
  });
});
