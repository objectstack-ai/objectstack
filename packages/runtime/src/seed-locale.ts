// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { SystemObjectName } from '@objectstack/spec/system';

/**
 * The locale a seed load filters `Seed.locale` on, for ONE organization — the
 * producer the install paths and the per-org replay share (maintainer ruling A,
 * 2026-11-05: the platform's install paths pick datasets by locale, reversing
 * the install-path bound recorded on `SeedSchema.locale`).
 *
 * Three rungs, first answer wins:
 *
 *   1. **The organization's Localization setting** — `localization.locale`
 *      (service-settings, `scope: 'tenant'`) read for `organizationId`, so the
 *      service's own cascade (env override, the organization's row, the
 *      `global` row) decides. ⛔ Only a value somebody SET counts: the
 *      manifest's built-in `default` (`en-US`, `source: 'default'`) is the
 *      platform's placeholder, not the organization's choice, and taking it
 *      would make the two rungs below unreachable — every organization that
 *      never opened Setup → Localization would be seeded `en-US` over its
 *      founder's language and over the app's own declared default. The same
 *      reading as the auth email language and the new-organization currency
 *      (`plugin-auth`), which treat `source: 'default'` as "not set".
 *   2. **The user's language** — `sys_user.locale` of the user who installs,
 *      reseeds or founds the organization. Absent for a load no person
 *      started (the boot heal, a system-inserted organization).
 *   3. **The app's declared `i18n.defaultLocale`** — what the boot path has
 *      always filtered on (`AppPlugin.resolveSeedLocale`).
 *
 * No rung answers ⇒ `undefined`, the loader's UNRESTRICTED spelling: every
 * dataset loads and `SeedLoaderService#warnOnUnresolvedLocaleScope` names the
 * locale-scoped ones it let through. Never an `'en'` guess.
 *
 * A host without a `settings` service has no organization setting to honour,
 * so rung 1 is skipped and rung 2 decides. A settings or user read that
 * THROWS is not skipped: the organization's choice may exist and could not be
 * read, and seeding another language over it would look like success. The
 * throw reaches the caller, whose seed then reports the failure (the install's
 * seed summary, the reseed's refusal, the replay's warning) and writes nothing.
 *
 * Datasets that declare no `locale` stay unrestricted whatever this answers —
 * that is the loader's rule, not this function's. When NO dataset in the load
 * declares one, the locale changes nothing, so rungs 1 and 2 are not read at
 * all: an organization founding or an install of an app without per-market
 * data pays no extra read and meets no new failure.
 */

/** Which rung answered. */
export type SeedLocaleSource = 'organization-setting' | 'user' | 'app-default';

/** A resolved seed locale and where it came from (for the caller's log line). */
export interface ResolvedSeedLocale {
    locale: string;
    source: SeedLocaleSource;
}

/** What {@link resolveSeedLocaleForLoad} is asked. Every field is optional. */
export interface SeedLocaleQuestion {
    /** The datasets about to load. Only whether any declares `locale` is read. */
    seeds?: readonly unknown[];
    /** The organization the rows land in. Absent: the settings service's own reach for a caller naming none. */
    organizationId?: string;
    /** The person installing, reseeding or founding the organization. */
    userId?: string;
    /** The app's declared `i18n.defaultLocale`. */
    appDefaultLocale?: string;
}

/** The part of the `settings` service read here. Structural, as in `plugin-auth`. */
interface SeedLocaleSettingsDoor {
    get(namespace: string, key: string, ctx?: { tenantId?: string }): Promise<{ value?: unknown; source?: string } | undefined>;
}

/** The part of the data engine read here. */
interface SeedLocaleUserReader {
    find(object: string, query?: Record<string, unknown>, options?: { context?: Record<string, unknown> }): Promise<unknown>;
}

/** A plugin context or kernel: anything with a `getService`. */
interface SeedLocaleHost {
    getService?: (name: string) => unknown;
}

/** A non-empty, trimmed string, or `undefined`. */
function localeText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
}

/** A registered service, or `undefined` when the host has none by that name. */
function serviceOf<T>(host: SeedLocaleHost | null | undefined, name: string): T | undefined {
    if (typeof host?.getService !== 'function') return undefined;
    try {
        return (host.getService(name) ?? undefined) as T | undefined;
    } catch {
        return undefined;
    }
}

/** True when any dataset in the load declares a `locale` scope. */
export function seedsDeclareLocale(seeds: readonly unknown[] | undefined): boolean {
    return Array.isArray(seeds) && seeds.some((s) => Array.isArray((s as { locale?: unknown } | null)?.locale));
}

/**
 * The app's declared `i18n.defaultLocale`, read off a bundle or package body —
 * top level first, then a nested `manifest` (the unflattened shape). A legacy
 * `i18n` ARRAY (translation bundles) declares no default.
 */
export function appDefaultSeedLocale(body: unknown): string | undefined {
    const b = body as { i18n?: unknown; manifest?: { i18n?: unknown } } | null | undefined;
    for (const i18n of [b?.i18n, b?.manifest?.i18n]) {
        if (i18n && typeof i18n === 'object' && !Array.isArray(i18n)) {
            const declared = localeText((i18n as { defaultLocale?: unknown }).defaultLocale);
            if (declared) return declared;
        }
    }
    return undefined;
}

/** Resolve the locale one seed load filters on. See the module docblock for the rungs. */
export async function resolveSeedLocaleForLoad(
    host: unknown,
    question: SeedLocaleQuestion,
): Promise<ResolvedSeedLocale | undefined> {
    const appDefault = localeText(question.appDefaultLocale);
    const fromApp = (): ResolvedSeedLocale | undefined =>
        appDefault ? { locale: appDefault, source: 'app-default' } : undefined;
    if (question.seeds !== undefined && !seedsDeclareLocale(question.seeds)) return fromApp();

    const h = host as SeedLocaleHost | null | undefined;
    const organizationId = localeText(question.organizationId);

    const settings = serviceOf<SeedLocaleSettingsDoor>(h, 'settings');
    if (settings && typeof settings.get === 'function') {
        const resolved = await settings.get('localization', 'locale', organizationId ? { tenantId: organizationId } : {});
        const value = localeText(resolved?.value);
        if (value && resolved?.source !== 'default') return { locale: value, source: 'organization-setting' };
    }

    const userId = localeText(question.userId);
    const ql = serviceOf<SeedLocaleUserReader>(h, 'objectql');
    if (userId && ql && typeof ql.find === 'function') {
        const rows = await ql.find(
            SystemObjectName.USER,
            { where: { id: userId }, fields: ['id', 'locale'], limit: 1 },
            { context: { isSystem: true } },
        );
        const row = (Array.isArray(rows) ? rows[0] : undefined) as { locale?: unknown } | undefined;
        const stored = localeText(row?.locale);
        if (stored) return { locale: stored, source: 'user' };
    }

    return fromApp();
}

/** `zh-CN (the organization's Localization setting)` — for a log line. */
export function describeSeedLocale(resolved: ResolvedSeedLocale | undefined): string {
    if (!resolved) return 'none (every dataset loads)';
    const from =
        resolved.source === 'organization-setting'
            ? "the organization's Localization setting"
            : resolved.source === 'user'
              ? "the user's language"
              : "the app's i18n.defaultLocale";
    return `${resolved.locale} (${from})`;
}
