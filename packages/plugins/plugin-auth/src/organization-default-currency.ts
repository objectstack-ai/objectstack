// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25495] A new organization's default currency, derived from its creator's
 * language or region (maintainer ruling 乙).
 *
 * `localization.currency` (service-settings, `scope: 'tenant'`) has no
 * platform default, on purpose: a guessed default put a "$" on every
 * code-less amount. So a new organization showed `currencyMode: 'dynamic'`
 * amounts as plain numbers until an administrator picked a currency. This
 * module fills that value in when the organization is created, from what the
 * server knows about the person creating it, and leaves it unset when it
 * knows nothing.
 *
 * - **Where the language comes from** ({@link creatorLocaleForNewOrganization}):
 *   the creator's stored `sys_user.locale` when it is set, else the creating
 *   request's `Accept-Language` preference, read with the platform's one
 *   parser (`preferredLocaleFromHeader`). This is the order `GET
 *   /auth/me/localization` uses for the user's language, without its third
 *   rung, the deployment default. The seam can see both: the callback names
 *   the creator's id, and better-auth's endpoint context (an
 *   `AsyncLocalStorage` that `afterCreateOrganization` runs inside) carries
 *   the request's headers.
 * - **The dev seed** ({@link hostLocaleFromEnv}) reads the host's locale the
 *   POSIX way, `LC_ALL`, then `LC_MONETARY`, then `LANG`. It does not use
 *   `Intl`'s default locale, because that answers `en-US` on a host that sets
 *   no locale at all, and that `en-US` is not anybody's choice.
 * - **The mapping** ({@link currencyForLocale}): the tag's region, or, for a
 *   bare language, the region `Intl.Locale#maximize()` gives it (`zh` → `CN`,
 *   `ja` → `JP`, `en` → `US`), then that region's currency from
 *   {@link REGION_CURRENCY}, a checked-in CLDR snapshot. A tag with no country
 *   region (`es-419`, `en-150`) or a region with no current currency maps to
 *   nothing.
 * - **Nothing to derive from ⇒ nothing is written.** There is no fallback to
 *   the manifest's `default_country` / `locale` defaults or to any other
 *   platform value.
 * - **The write** is the settings service's own `set`, one `tenant` row for
 *   the organization. That is the row `PUT /api/settings/localization` writes,
 *   so Setup → Localization shows the value and changes it. It is made only
 *   while the key still resolves from the default (`source: 'default'`). A
 *   value on any rung (this organization's own, a `global` row, an env
 *   override) is an administrator's choice and is left as it is.
 *
 * Best-effort: an organization is created whether or not this lands. A miss
 * costs the pre-filled currency, nothing else, and is logged with where to set
 * it by hand.
 */

import { tryGetCurrentAuthEndpointContext } from '@better-auth/core/context';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { preferredLocaleFromHeader, SystemObjectName } from '@objectstack/spec/system';

/**
 * Region (ISO 3166-1 alpha-2 and the CLDR territory codes beside it) → the
 * region's current ISO 4217 currency.
 *
 * ## Provenance: CLDR `currencyData`, checked in, not hand-written
 *
 * Generated on 2026-10-24 from CLDR 48 `supplemental/currencyData.json`
 * (`cldr-core@48.0.0` on npm, sha256 of that file
 * `ab007c5bb654a11601d6328f73a9b5b504334c556f3edb760020d6e2cc408472`), the
 * same CLDR release as `CURRENCY_FRACTION_DIGITS` in `@objectstack/spec`.
 * For each two-letter region the value is the FIRST entry of its
 * `currencyData.region` list that has no `_to` date and is not
 * `_tender: "false"`. CLDR orders that list so the first current tender is the
 * region's primary currency (`PS` → `ILS` ahead of `JOD`). Entries are kept
 * only when the code is in the `iso_4217_currency` value domain, the set the
 * settings key accepts. Eleven regions have no current tender and are absent:
 * `AQ` and `ZZ` (`XXX`), and the retired `BU` `CP` `CS` `DD` `SU` `TP` `YD`
 * `YU` `ZR`.
 *
 * `Intl` has no region → currency lookup, which is why this is a table. To
 * refresh it for a later CLDR, regenerate it by the rule above and update this
 * provenance block. Do not edit entries by hand.
 */
export const REGION_CURRENCY: Readonly<Record<string, string>> = {
  AC: 'SHP', AD: 'EUR', AE: 'AED', AF: 'AFN', AG: 'XCD', AI: 'XCD', AL: 'ALL', AM: 'AMD',
  AO: 'AOA', AR: 'ARS', AS: 'USD', AT: 'EUR', AU: 'AUD', AW: 'AWG', AX: 'EUR', AZ: 'AZN',
  BA: 'BAM', BB: 'BBD', BD: 'BDT', BE: 'EUR', BF: 'XOF', BG: 'EUR', BH: 'BHD', BI: 'BIF',
  BJ: 'XOF', BL: 'EUR', BM: 'BMD', BN: 'BND', BO: 'BOB', BQ: 'USD', BR: 'BRL', BS: 'BSD',
  BT: 'BTN', BV: 'NOK', BW: 'BWP', BY: 'BYN', BZ: 'BZD', CA: 'CAD', CC: 'AUD', CD: 'CDF',
  CF: 'XAF', CG: 'XAF', CH: 'CHF', CI: 'XOF', CK: 'NZD', CL: 'CLP', CM: 'XAF', CN: 'CNY',
  CO: 'COP', CR: 'CRC', CU: 'CUP', CV: 'CVE', CW: 'XCG', CX: 'AUD', CY: 'EUR', CZ: 'CZK',
  DE: 'EUR', DG: 'USD', DJ: 'DJF', DK: 'DKK', DM: 'XCD', DO: 'DOP', DZ: 'DZD', EA: 'EUR',
  EC: 'USD', EE: 'EUR', EG: 'EGP', EH: 'MAD', ER: 'ERN', ES: 'EUR', ET: 'ETB', EU: 'EUR',
  FI: 'EUR', FJ: 'FJD', FK: 'FKP', FM: 'USD', FO: 'DKK', FR: 'EUR', GA: 'XAF', GB: 'GBP',
  GD: 'XCD', GE: 'GEL', GF: 'EUR', GG: 'GBP', GH: 'GHS', GI: 'GIP', GL: 'DKK', GM: 'GMD',
  GN: 'GNF', GP: 'EUR', GQ: 'XAF', GR: 'EUR', GS: 'GBP', GT: 'GTQ', GU: 'USD', GW: 'XOF',
  GY: 'GYD', HK: 'HKD', HM: 'AUD', HN: 'HNL', HR: 'EUR', HT: 'HTG', HU: 'HUF', IC: 'EUR',
  ID: 'IDR', IE: 'EUR', IL: 'ILS', IM: 'GBP', IN: 'INR', IO: 'USD', IQ: 'IQD', IR: 'IRR',
  IS: 'ISK', IT: 'EUR', JE: 'GBP', JM: 'JMD', JO: 'JOD', JP: 'JPY', KE: 'KES', KG: 'KGS',
  KH: 'KHR', KI: 'AUD', KM: 'KMF', KN: 'XCD', KP: 'KPW', KR: 'KRW', KW: 'KWD', KY: 'KYD',
  KZ: 'KZT', LA: 'LAK', LB: 'LBP', LC: 'XCD', LI: 'CHF', LK: 'LKR', LR: 'LRD', LS: 'ZAR',
  LT: 'EUR', LU: 'EUR', LV: 'EUR', LY: 'LYD', MA: 'MAD', MC: 'EUR', MD: 'MDL', ME: 'EUR',
  MF: 'EUR', MG: 'MGA', MH: 'USD', MK: 'MKD', ML: 'XOF', MM: 'MMK', MN: 'MNT', MO: 'MOP',
  MP: 'USD', MQ: 'EUR', MR: 'MRU', MS: 'XCD', MT: 'EUR', MU: 'MUR', MV: 'MVR', MW: 'MWK',
  MX: 'MXN', MY: 'MYR', MZ: 'MZN', NA: 'NAD', NC: 'XPF', NE: 'XOF', NF: 'AUD', NG: 'NGN',
  NI: 'NIO', NL: 'EUR', NO: 'NOK', NP: 'NPR', NR: 'AUD', NU: 'NZD', NZ: 'NZD', OM: 'OMR',
  PA: 'PAB', PE: 'PEN', PF: 'XPF', PG: 'PGK', PH: 'PHP', PK: 'PKR', PL: 'PLN', PM: 'EUR',
  PN: 'NZD', PR: 'USD', PS: 'ILS', PT: 'EUR', PW: 'USD', PY: 'PYG', QA: 'QAR', RE: 'EUR',
  RO: 'RON', RS: 'RSD', RU: 'RUB', RW: 'RWF', SA: 'SAR', SB: 'SBD', SC: 'SCR', SD: 'SDG',
  SE: 'SEK', SG: 'SGD', SH: 'SHP', SI: 'EUR', SJ: 'NOK', SK: 'EUR', SL: 'SLE', SM: 'EUR',
  SN: 'XOF', SO: 'SOS', SR: 'SRD', SS: 'SSP', ST: 'STN', SV: 'USD', SX: 'XCG', SY: 'SYP',
  SZ: 'SZL', TA: 'GBP', TC: 'USD', TD: 'XAF', TF: 'EUR', TG: 'XOF', TH: 'THB', TJ: 'TJS',
  TK: 'NZD', TL: 'USD', TM: 'TMT', TN: 'TND', TO: 'TOP', TR: 'TRY', TT: 'TTD', TV: 'AUD',
  TW: 'TWD', TZ: 'TZS', UA: 'UAH', UG: 'UGX', UM: 'USD', US: 'USD', UY: 'UYU', UZ: 'UZS',
  VA: 'EUR', VC: 'XCD', VE: 'VES', VG: 'USD', VI: 'USD', VN: 'VND', VU: 'VUV', WF: 'XPF',
  WS: 'WST', XK: 'EUR', YE: 'YER', YT: 'EUR', ZA: 'ZAR', ZM: 'ZMW', ZW: 'ZWG',
};

/**
 * The ISO 4217 currency of a BCP 47 tag's region, or `undefined`.
 *
 * The region is the tag's own (`zh-CN` → `CN`), or for a tag without one the
 * likely region `Intl.Locale#maximize()` gives (`zh` → `CN`, `ja` → `JP`,
 * `zh-Hant` → `TW`). A malformed tag, a tag whose region is not a country
 * (`es-419`, `en-150`), and a region with no current currency all answer
 * `undefined`: no guess is made.
 */
export function currencyForLocale(tag: unknown): string | undefined {
  if (typeof tag !== 'string') return undefined;
  const value = tag.trim();
  if (!value) return undefined;
  let region: string | undefined;
  try {
    region = new Intl.Locale(value).maximize().region;
  } catch {
    return undefined;
  }
  if (!region || !Object.prototype.hasOwnProperty.call(REGION_CURRENCY, region)) return undefined;
  return REGION_CURRENCY[region];
}

/**
 * The host's locale as a BCP 47 tag, read from the POSIX environment, or
 * `undefined`.
 *
 * The first of `LC_ALL`, `LC_MONETARY` and `LANG` that is set and not empty
 * decides, which is the order POSIX gives these for monetary formatting. Its
 * codeset and modifier are dropped (`zh_CN.UTF-8` → `zh-CN`). `C` and `POSIX`
 * name no language and answer `undefined`, and so does a host that sets none
 * of the three.
 */
export function hostLocaleFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  const raw = [env.LC_ALL, env.LC_MONETARY, env.LANG].find(
    (v): v is string => typeof v === 'string' && v.trim() !== '',
  );
  if (!raw) return undefined;
  const base = raw.trim().split('.')[0]!.split('@')[0]!;
  if (!base || base === 'C' || base === 'POSIX') return undefined;
  return base.replace(/_/g, '-');
}

/** The part of the `settings` service this module calls. Structural, as in `auth-plugin.ts`. */
export interface CurrencySettingsDoor {
  get(namespace: string, key: string, ctx?: Record<string, unknown>): Promise<{ source?: string } | undefined>;
  set(namespace: string, key: string, value: unknown, ctx?: Record<string, unknown>): Promise<unknown>;
}

/** What {@link seedOrganizationCurrency} did for one organization. */
export type OrganizationCurrencyOutcome =
  /** The derived currency was written as the organization's `tenant` value. */
  | { kind: 'written'; currency: string }
  /** The key already resolves from a rung above the default (`source` names it); nothing written. */
  | { kind: 'kept'; source: string }
  /** The locale maps to no currency (absent, malformed or no country region); nothing written. */
  | { kind: 'underivable' };

/**
 * Give one organization the currency `locale` maps to, unless the key already
 * has a value. Throws what the settings door throws, so the caller can log it.
 */
export async function seedOrganizationCurrency(
  settings: CurrencySettingsDoor,
  organizationId: string,
  locale: string | undefined,
): Promise<OrganizationCurrencyOutcome> {
  const currency = currencyForLocale(locale);
  if (!currency) return { kind: 'underivable' };
  const scope = { tenantId: organizationId };
  const current = await settings.get('localization', 'currency', scope);
  if (current?.source !== 'default') return { kind: 'kept', source: String(current?.source) };
  await settings.set('localization', 'currency', currency, scope);
  return { kind: 'written', currency };
}

/** The logger surface this module writes to. */
export interface CurrencySeedLogger {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

/** The payload `AuthManagerOptions.onOrganizationCreated` receives. */
export interface OrganizationCreatedEvent {
  organizationId: string;
  userId?: string;
  name?: string;
  slug?: string;
}

/** Where a creator's language was read from, for the log line. */
export type CreatorLocaleSource = 'the creator\'s stored language' | 'the creating request\'s Accept-Language';

/** The `accept-language` value on the better-auth endpoint context this call runs inside, if any. */
function acceptLanguageOfCurrentRequest(): string | undefined {
  let endpoint: unknown;
  try {
    endpoint = tryGetCurrentAuthEndpointContext();
  } catch {
    return undefined;
  }
  if (!endpoint || typeof endpoint !== 'object') return undefined;
  const request = (endpoint as { request?: { headers?: unknown } }).request;
  for (const bag of [(endpoint as { headers?: unknown }).headers, request?.headers]) {
    const get = (bag as { get?: unknown } | undefined)?.get;
    if (typeof get !== 'function') continue;
    try {
      const value = (bag as Headers).get('accept-language');
      if (typeof value === 'string' && value) return value;
    } catch {
      // A header bag that throws on read leaves the request's language unknown.
    }
  }
  return undefined;
}

/**
 * The language of the person creating an organization, and where it was read
 * from: their stored `sys_user.locale` when set, else the creating request's
 * preferred `Accept-Language` tag, else `undefined`.
 *
 * Throws when the stored locale cannot be read. The caller then writes
 * nothing: the request's language must not stand in for a stored one that
 * may exist.
 */
export async function creatorLocaleForNewOrganization(
  ql: IDataEngine | undefined,
  userId: string | undefined,
  acceptLanguage: string | undefined,
): Promise<{ locale: string; from: CreatorLocaleSource } | undefined> {
  if (ql && userId) {
    const rows = await ql.find(
      SystemObjectName.USER,
      { where: { id: userId }, fields: ['id', 'locale'], limit: 1 },
      { context: { isSystem: true } },
    );
    const stored = (Array.isArray(rows) ? rows[0] : undefined)?.locale;
    if (typeof stored === 'string' && stored.trim() !== '') {
      return { locale: stored.trim(), from: 'the creator\'s stored language' };
    }
  }
  const requested = preferredLocaleFromHeader(acceptLanguage);
  return requested ? { locale: requested, from: 'the creating request\'s Accept-Language' } : undefined;
}

/** What {@link withOrganizationDefaultCurrency} needs, resolved when an organization is created. */
export interface OrganizationCurrencyDeps {
  dataEngine?: IDataEngine;
  getSettings: () => CurrencySettingsDoor | undefined;
  logger: CurrencySeedLogger;
}

const SET_IT_BY_HAND =
  'An administrator can set it under Setup → Localization → Default currency; until then code-less amounts show as plain numbers.';

/**
 * Give a newly created organization its creator's currency. Never throws:
 * every miss is logged, and organization creation is not affected.
 */
export async function seedCreatedOrganizationCurrency(
  data: OrganizationCreatedEvent,
  deps: OrganizationCurrencyDeps,
): Promise<void> {
  const { logger } = deps;
  const organizationId = data?.organizationId;
  if (typeof organizationId !== 'string' || organizationId === '') return;
  const acceptLanguage = acceptLanguageOfCurrentRequest();
  try {
    const settings = deps.getSettings();
    if (!settings || typeof settings.get !== 'function' || typeof settings.set !== 'function') {
      logger.debug(`[auth] organization ${organizationId}: no settings service, so no default currency was set`);
      return;
    }
    const creator = await creatorLocaleForNewOrganization(deps.dataEngine, data.userId, acceptLanguage);
    const outcome = await seedOrganizationCurrency(settings, organizationId, creator?.locale);
    if (outcome.kind === 'written') {
      logger.info(
        `[auth] organization ${organizationId} takes ${outcome.currency} as its default currency, from ` +
          `${creator!.from} (${creator!.locale}); Setup → Localization changes it`,
      );
    } else if (outcome.kind === 'kept') {
      logger.debug(
        `[auth] organization ${organizationId}: localization.currency already resolves from '${outcome.source}', so it was left as it is`,
      );
    } else {
      logger.debug(
        `[auth] organization ${organizationId}: its creator's language (${creator ? creator.locale : 'none known'}) ` +
          'names no country, so no default currency was set',
      );
    }
  } catch (err: any) {
    logger.warn(
      `[auth] organization ${organizationId} was not given its creator's default currency: ` +
        `${err?.message ?? err}. ${SET_IT_BY_HAND}`,
    );
  }
}

/**
 * Wrap a host's `onOrganizationCreated` (or none) so a new organization also
 * gets its creator's default currency.
 *
 * The host's callback runs first and is awaited, so a currency it sets is
 * already there and is kept. A host callback that throws still throws, after
 * the currency step, so `AuthManager` reports it as before.
 */
export function withOrganizationDefaultCurrency(
  host: ((data: OrganizationCreatedEvent) => void | Promise<void>) | undefined,
  deps: OrganizationCurrencyDeps,
): (data: OrganizationCreatedEvent) => Promise<void> {
  return async (data) => {
    let hostFailure: { error: unknown } | undefined;
    if (typeof host === 'function') {
      try {
        await host(data);
      } catch (error) {
        hostFailure = { error };
      }
    }
    await seedCreatedOrganizationCurrency(data, deps);
    if (hostFailure) throw hostFailure.error;
  };
}

/**
 * The dev seed's half: give each organization the seeded admin belongs to the
 * currency of the host's locale ({@link hostLocaleFromEnv}), beside the
 * time-zone seeding in `AuthPlugin`. Same rules as an organization created
 * through the API: nothing derivable ⇒ nothing written, a value already set
 * ⇒ left alone. Never throws.
 */
export async function seedDevWorkspaceCurrency(input: {
  settings: CurrencySettingsDoor | undefined;
  ql: IDataEngine;
  userId: string;
  logger: CurrencySeedLogger;
  env?: Record<string, string | undefined>;
}): Promise<void> {
  const { settings, ql, userId, logger } = input;
  const locale = hostLocaleFromEnv(input.env);
  if (!currencyForLocale(locale)) {
    logger.debug(
      `[auth] dev seed: this host's locale (${locale ?? 'none set'}) names no country, so the workspace keeps no default currency`,
    );
    return;
  }
  if (!settings || typeof settings.get !== 'function' || typeof settings.set !== 'function') return;

  let organizationIds: string[];
  try {
    const memberships = await ql.find(
      SystemObjectName.MEMBER,
      { where: { user_id: userId }, limit: 50 },
      { context: { isSystem: true } },
    );
    organizationIds = [
      ...new Set(
        (Array.isArray(memberships) ? memberships : [])
          .map((m: any) => m?.organization_id)
          .filter((id: unknown): id is string => typeof id === 'string' && id !== ''),
      ),
    ];
  } catch (err: any) {
    logger.warn(
      `[auth] dev seed: the seeded admin's workspace could not be read (${err?.message ?? err}), so it was ` +
        `not given this host's currency. ${SET_IT_BY_HAND}`,
    );
    return;
  }

  for (const organizationId of organizationIds) {
    try {
      const outcome = await seedOrganizationCurrency(settings, organizationId, locale);
      if (outcome.kind === 'written') {
        logger.info(
          `[auth] dev seed: workspace ${organizationId} takes this host's currency, ${outcome.currency} ` +
            `(from ${locale}; Setup → Localization changes it)`,
        );
      }
    } catch (err: any) {
      logger.warn(
        `[auth] dev seed: workspace ${organizationId} was not given this host's currency: ` +
          `${err?.message ?? err}. ${SET_IT_BY_HAND}`,
      );
    }
  }
}
