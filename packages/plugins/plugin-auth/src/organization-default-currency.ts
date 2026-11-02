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
 *   `REGION_CURRENCY`, a checked-in CLDR snapshot. Both live in
 *   `@objectstack/spec/shared` (`region-currency.ts`), which the console's
 *   workspace prompt reads too, so there is one table. A tag with no country
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
import { currencyForLocale } from '@objectstack/spec/shared';
import { preferredLocaleFromHeader, SystemObjectName } from '@objectstack/spec/system';
import { acceptLanguageHeader } from './auth-manager.js';

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
  try {
    return acceptLanguageHeader(tryGetCurrentAuthEndpointContext());
  } catch {
    return undefined;
  }
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
