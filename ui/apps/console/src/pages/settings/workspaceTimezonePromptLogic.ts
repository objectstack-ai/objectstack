// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * When the console asks an administrator to set a still-default workspace
 * timezone or a still-unset default currency, and what it offers
 * (objectui#11758; the currency arm, objectstack#28872).
 *
 * The director's ruling on objectui#11693 (B2) gates the served display zone on
 * this prompt: before the console renders every instant in the workspace's
 * `localization.timezone`, an administrator is asked ONCE, while that key is
 * still the manifest default, whether to set it to the browser's zone. Confirm
 * writes through the Settings page's own write path; decline writes nothing.
 * ⛔ Not taken: writing the browser's zone silently on sign-in. The first
 * administrator's browser would then decide the organization's clock with
 * nobody told, for `TODAY()`, report buckets and rendered datetimes alike.
 *
 * The currency arm asks the same way about `localization.currency`, which has
 * no platform default: while no rung holds a value, every code-less amount
 * shows as a plain number and nobody is told. The offer is the currency of the
 * browser's region, read through `currencyForLocale` from
 * `@objectstack/spec/shared`, the CLDR table plugin-auth gives a new
 * organization its currency from; the console carries no copy of it. When
 * both keys are unset it is ONE prompt with both fields, never two dialogs,
 * and one record says this administrator was asked.
 *
 * Kept apart from `WorkspaceTimezonePrompt.tsx` so that module exports a
 * component only, and so every condition below is a pure function a test can
 * drive without rendering.
 *
 * @module
 */

import { currencyForLocale, isValueDomainMember } from '@objectstack/spec/shared';
import { getSettingsNamespace, listSettingsManifests } from './api';
import type { ResolvedSettingValue, SettingsManifest, Specifier } from './types';

/** The settings namespace that owns the workspace's regional defaults. */
export const LOCALIZATION_NAMESPACE = 'localization';

/** The key the localization cascade resolves the workspace's zone from. */
export const TIMEZONE_KEY = 'timezone';

/** The key a code-less amount takes its currency from. It has no platform default. */
export const CURRENCY_KEY = 'currency';

/**
 * Where the "this administrator was asked" record lives, per workspace and per
 * user: `os:workspace-timezone-prompt:<orgId>:<userId>`.
 *
 * Why the device's `localStorage` and not `sessionStorage`. The card says a
 * declining administrator's SESSION is not asked again, and the session meant
 * there is the administrator's sign-in session. `sessionStorage` is per TAB, so
 * a second tab of the same sign-in would ask again. The client holds no
 * sign-in-session identifier to key on: `AuthClientSession` carries the bearer
 * token, and an SSO re-entry can mint a new one within one sitting (the same
 * measurement `recoveryReminderGate.ts` in `@object-ui/app-shell` records). The
 * narrowest scope this client can see that contains every tab of one sign-in
 * is therefore the device, narrowed by the two ids: another administrator, or
 * the same administrator in another workspace, is still asked.
 *
 * ⛔ Not a server-side "dismissed" flag: that would be a new settings key, and
 * the card rules out any new key.
 *
 * The currency arm shares this record: one prompt, one "asked". An
 * administrator already asked about the timezone is therefore not asked
 * about the currency.
 */
export const PROMPT_RECORD_PREFIX = 'os:workspace-timezone-prompt';

export function promptRecordKey(orgId: string, userId: string): string {
  return `${PROMPT_RECORD_PREFIX}:${orgId}:${userId}`;
}

export type PromptStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The device's `localStorage`, or `undefined` where reading it throws (a private window). */
export function deviceStorage(): PromptStorage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Was this administrator already asked about this workspace on this device?
 *
 * Storage that throws answers `true`: a prompt that cannot record that it was
 * shown cannot keep its "once", so when it cannot tell, it does not ask.
 */
export function wasAsked(storage: PromptStorage, key: string): boolean {
  try {
    return storage.getItem(key) !== null;
  } catch {
    return true;
  }
}

/**
 * Record that the prompt was SHOWN. Written when the prompt opens, not when it
 * is answered: closing the tab, navigating away or reloading with the prompt
 * open is not a reason to ask a second time. Returns `false` when the record
 * could not be written, and the caller then does not show the prompt.
 */
export function markAsked(storage: PromptStorage, key: string): boolean {
  try {
    storage.setItem(key, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

/**
 * The browser's own zone, or `undefined` when it reports none.
 *
 * `resolvedOptions().timeZone` is `undefined` on engines that cannot tell, and
 * ICU answers `Etc/Unknown` when the host zone is unknown; the second is not a
 * zone (`new Intl.DateTimeFormat('en-US', { timeZone: 'Etc/Unknown' })` throws),
 * which `isAdmissibleZone` refuses. This is the console's ONE reader of the
 * browser's zone: nothing else in the console source reads it.
 */
export function browserTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.length > 0 ? zone : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The browser's preferred language, the first of `navigator.languages`, else
 * `navigator.language`, or `undefined` when it reports none.
 *
 * Only the FIRST preference is read. A later one names a language the person
 * also reads, not where they are: `es-419` then `es` would otherwise land on
 * `es` → `ES` → EUR for someone in Latin America.
 */
export function browserLanguage(): string | undefined {
  try {
    if (typeof navigator === 'undefined') return undefined;
    const first = Array.isArray(navigator.languages) ? navigator.languages[0] : undefined;
    const tag = first || navigator.language;
    return typeof tag === 'string' && tag.length > 0 ? tag : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The currency of the browser's region, or `undefined` when its language
 * names no country region (`es-419`) or none at all.
 *
 * `currencyForLocale` from `@objectstack/spec/shared` decides: the tag's
 * region, or for a bare language the likely one (`zh` → `CN`), through the
 * CLDR table plugin-auth seeds a new organization's currency from. No guess is
 * made beyond that table.
 */
export function browserCurrency(): string | undefined {
  return currencyForLocale(browserLanguage());
}

/**
 * Would the settings write door admit `value` for this specifier?
 *
 * The same two rules the server applies to a `select` write, in the same
 * order. A declared `valueDomain` is the enforcement boundary (objectstack#5712),
 * judged by `isValueDomainMember` from `@objectstack/spec/shared`: the ONE
 * membership predicate the settings door and the record write path share, so
 * this is that predicate called, not a copy of it. Without a declared domain,
 * the `options` table is exhaustive (objectstack#5131).
 *
 * The server judges with ITS runtime's data and this runs on the browser's,
 * so a value this admits can still be refused at the door when the two
 * disagree. The prompt then shows the refusal in the field's error slot,
 * exactly where the Settings page shows it, and writes nothing.
 */
export function isAdmissibleValue(spec: Specifier, value: string): boolean {
  if (spec.valueDomain) return isValueDomainMember(spec.valueDomain, value);
  return (spec.options ?? []).some((option) => String(option.value) === value);
}

/** {@link isAdmissibleValue} for the `timezone` specifier. */
export function isAdmissibleZone(spec: Specifier, zone: string): boolean {
  return isAdmissibleValue(spec, zone);
}

/**
 * Does the session hold the capability this manifest demands for a write?
 *
 * Fails CLOSED on every unknown, unlike `hasCapabilities`, which fails open on
 * an unreported answer. Both directions are about who gets ASKED, never about
 * who may write (the server enforces that on the PUT regardless): an
 * unprompted question put to someone who cannot answer it is the worse
 * failure, and a holder who is not asked still has the Settings page. So:
 *
 * - `systemPermissions` not reported (`undefined`) → not asked;
 * - a manifest that declares no `writePermission` → not asked. The spec's
 *   parse default is `setup.write`, the service's own fallback is the read
 *   permission, and this client does not pick between them.
 */
export function mayWrite(
  manifest: Pick<SettingsManifest, 'writePermission'>,
  systemPermissions: readonly string[] | undefined,
): boolean {
  const required = manifest.writePermission;
  if (typeof required !== 'string' || required.length === 0) return false;
  return Array.isArray(systemPermissions) && systemPermissions.includes(required);
}

/** The timezone arm: the zone, and the field it is edited in. */
export interface TimezoneOffer {
  /** The `timezone` specifier, rendered with the Settings page's own field. */
  spec: Specifier;
  /** The key's resolved value: `source: 'default'`, unlocked. */
  resolved: ResolvedSettingValue;
  /** The workspace's current zone, the manifest default. */
  current: string;
  /** The browser's zone, the pre-filled answer. */
  zone: string;
}

/** The currency arm: the currency, and the field it is edited in. */
export interface CurrencyOffer {
  /** The `currency` specifier, rendered with the Settings page's own field. */
  spec: Specifier;
  /** The key's resolved value: `source: 'default'`, no value, unlocked. */
  resolved: ResolvedSettingValue;
  /** The browser region's currency, the pre-filled answer. */
  currency: string;
}

/** What the one prompt offers: either arm, or both. Never neither. */
export interface WorkspacePromptOffer {
  timezone?: TimezoneOffer;
  currency?: CurrencyOffer;
}

/** What the browser answers, each `undefined` when it cannot tell. */
export interface BrowserAnswers {
  zone?: string;
  currency?: string;
}

/**
 * Which keys to ask about. Answers the offer, or `null` for "do not ask".
 *
 * - **timezone**: `localization.timezone` is still the manifest default, and
 *   the browser has a zone the door would take.
 * - **currency**: `localization.currency` resolves from the default with no
 *   value at all (the key declares no default, so no rung holds one), and the
 *   browser's region has a currency the door would take.
 *
 * Either needs a session that may write the namespace. Reads through the
 * Settings page's own client (`api.ts`), never a new endpoint, and once for
 * both arms. The list request comes first because it never refuses: it
 * answers the manifests this session may READ, each carrying its
 * `writePermission`, so a session that may not touch localization learns that
 * without a `403` on the wire. Only a session that may write then reads the
 * namespace.
 *
 * "Still the default" is the resolved value's `source`. The spec declares it
 * the effective entry of the cascade ("The first entry where `value` is
 * non-null is also the effective `source`"), and the service sets it from that
 * entry, so it says the same thing the Settings page's `cascadeChain` walk
 * finds, from a member that is always present: `cascadeChain` is optional on
 * the wire. A locked key is not offered either: the write would be refused.
 */
export async function findWorkspacePromptOffer(
  systemPermissions: readonly string[] | undefined,
  browser: BrowserAnswers,
): Promise<WorkspacePromptOffer | null> {
  // No capability answer reported, or one that holds nothing: nothing below
  // could pass `mayWrite`, so no request is spent finding that out. Nor when
  // the browser has nothing to offer for either key.
  if (!Array.isArray(systemPermissions) || systemPermissions.length === 0) return null;
  if (!browser.zone && !browser.currency) return null;

  const { manifests } = await listSettingsManifests();
  const listed = manifests.find((m) => m.namespace === LOCALIZATION_NAMESPACE);
  if (!listed || !mayWrite(listed, systemPermissions)) return null;

  const { manifest, values } = await getSettingsNamespace(LOCALIZATION_NAMESPACE);
  if (!mayWrite(manifest, systemPermissions)) return null;

  const offer: WorkspacePromptOffer = {};
  const timezone = browser.zone ? timezoneArm(manifest, values, browser.zone) : null;
  if (timezone) offer.timezone = timezone;
  const currency = browser.currency ? currencyArm(manifest, values, browser.currency) : null;
  if (currency) offer.currency = currency;
  return offer.timezone || offer.currency ? offer : null;
}

function timezoneArm(
  manifest: SettingsManifest,
  values: Record<string, ResolvedSettingValue>,
  zone: string,
): TimezoneOffer | null {
  const resolved = values[TIMEZONE_KEY];
  if (!resolved || resolved.source !== 'default' || resolved.locked) return null;
  if (typeof resolved.value !== 'string') return null;

  const spec = manifest.specifiers.find((s) => s.key === TIMEZONE_KEY);
  if (!spec || !isAdmissibleZone(spec, zone)) return null;

  return { spec, resolved, current: resolved.value, zone };
}

function currencyArm(
  manifest: SettingsManifest,
  values: Record<string, ResolvedSettingValue>,
  currency: string,
): CurrencyOffer | null {
  const resolved = values[CURRENCY_KEY];
  if (!resolved || resolved.source !== 'default' || resolved.locked) return null;
  // A deployment whose manifest declares a default currency has one: amounts
  // already carry its symbol, so there is nothing to ask.
  if (resolved.value !== null && resolved.value !== undefined && resolved.value !== '') return null;

  const spec = manifest.specifiers.find((s) => s.key === CURRENCY_KEY);
  if (!spec || !isAdmissibleValue(spec, currency)) return null;

  return { spec, resolved, currency };
}
