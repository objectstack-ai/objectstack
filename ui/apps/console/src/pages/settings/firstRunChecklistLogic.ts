// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the first-run checklist on Home shows an administrator, and when a row
 * is done (objectstack#30206). The checklist replaces the dialog that asked for
 * the workspace timezone and default currency on the first screens
 * (objectui#11758, objectstack#28872); this module is that dialog's logic,
 * widened to every row.
 *
 * ## What the dialog's rulings still decide
 *
 * The director's ruling on objectui#11693 (B2) put a gate on the served display
 * zone: an administrator is asked, while `localization.timezone` is still the
 * manifest default, whether to set it to the browser's zone. Confirm writes
 * through the Settings page's own write path; decline writes nothing.
 * ⛔ Not taken: writing the browser's zone silently on sign-in. The first
 * administrator's browser would then decide the organization's clock with
 * nobody told, for `TODAY()`, report buckets and rendered datetimes alike.
 *
 * objectstack#28872 added the currency: `localization.currency` has no platform
 * default, and while no rung holds a value every code-less amount shows as a
 * plain number and nobody is told.
 *
 * Both still hold here. The browser only PRE-FILLS a row's fields; nothing is
 * written until the administrator presses the row's Confirm. A row that is not
 * done stays on the checklist, so an unset currency does not go unnoticed. What
 * changed is the form: a row on Home instead of a dialog at startup.
 *
 * ## Done is read from the real setting, never from a click
 *
 * Every row's `done` is computed from what the server answers: the resolved
 * settings values, the organization's name, its members and invitations. The
 * checklist keeps no record of which rows were "ticked". The one thing it does
 * keep is whether this administrator HID it, on this device; see
 * {@link dismissRecordKey}.
 *
 * ## One offer
 *
 * Language, country and currency are all read from the browser's first
 * language (`browserLanguage`), so the three cannot contradict each other: the
 * country is that language's region and the currency is that region's. The
 * zone is the browser's own zone.
 *
 * Kept apart from `FirstRunChecklist.tsx` so that module exports a component
 * only, and so every condition below is a pure function a test can drive
 * without rendering.
 *
 * @module
 */

import { currencyForLocale, isValueDomainMember } from '@objectstack/spec/shared';
import { getSettingsNamespace, listSettingsManifests } from './api';
import type { ResolvedSettingValue, SettingsManifest, Specifier } from './types';

/** The settings namespace that owns the workspace's regional defaults. */
export const LOCALIZATION_NAMESPACE = 'localization';

/** The settings namespace that owns outbound mail delivery. */
export const MAIL_NAMESPACE = 'mail';

/** The key the localization cascade resolves the workspace's zone from. */
export const TIMEZONE_KEY = 'timezone';

/** The key a code-less amount takes its currency from. It has no platform default. */
export const CURRENCY_KEY = 'currency';

/** The workspace's default language. */
export const LOCALE_KEY = 'locale';

/** The workspace's default country, an ISO 3166-1 alpha-2 code. */
export const COUNTRY_KEY = 'default_country';

/**
 * The name plugin-auth gives the organization it creates for a deployment's
 * first owner (`ensure-default-organization.ts`, and the same literal in
 * `default-organization-invariant.ts`). Every invitee reads it until somebody
 * renames the organization (objectstack#30125 row 1), so a name still equal to
 * it is the one reading of "the company name was never set".
 * ⚠️ A copy of the server's literal: no test reads plugin-auth's source from
 * `ui/`, so a rename there must change this line too, or the row reads
 * "named" for an organization nobody named.
 */
export const DEFAULT_ORGANIZATION_NAME = 'Default Organization';

/** The rows the checklist can show, in the order it shows them. */
export type ChecklistRowId =
  | 'organization_name'
  | 'language_country'
  | 'timezone'
  | 'currency'
  | 'mail'
  | 'invite';

/**
 * Where the "this administrator hid the checklist" record lives, per workspace
 * and per user: `os:first-run-checklist:<orgId>:<userId>`.
 *
 * The device's `localStorage`, narrowed by the two ids, for the reason the
 * dialog's "asked once" record lived there: the client holds no sign-in
 * session identifier to key on, and this is the narrowest scope it can see
 * that contains every tab of one sign-in. Another administrator, or the same
 * administrator in another workspace, still sees the checklist.
 *
 * ⛔ Not a server-side "dismissed" flag: that would be a new settings key, and
 * the dialog's ruling ruled out any new key. Hiding the checklist writes
 * nothing to the server and changes no row's state.
 */
export const DISMISS_RECORD_PREFIX = 'os:first-run-checklist';

export function dismissRecordKey(orgId: string, userId: string): string {
  return `${DISMISS_RECORD_PREFIX}:${orgId}:${userId}`;
}

export type ChecklistStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The device's `localStorage`, or `undefined` where reading it throws (a private window). */
export function deviceStorage(): ChecklistStorage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Did this administrator hide the checklist for this workspace on this device?
 *
 * Storage that cannot be read answers `false`: the checklist is part of the
 * page, not a dialog in front of it, so showing it once too often costs a
 * glance, while hiding it on an unreadable answer could leave an unset currency
 * unnoticed.
 */
export function wasDismissed(storage: ChecklistStorage | undefined, key: string): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/** Record that the checklist was hidden. Returns `false` when it could not be written. */
export function markDismissed(storage: ChecklistStorage | undefined, key: string): boolean {
  if (!storage) return false;
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
 * which `isAdmissibleValue` refuses. This is the console's ONE reader of the
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
export function browserCurrency(language: string | undefined = browserLanguage()): string | undefined {
  return currencyForLocale(language);
}

/**
 * The country of the browser's language: its region, or for a bare language
 * the likely one, read exactly as `currencyForLocale` reads it
 * (`new Intl.Locale(tag).maximize().region`). That is what keeps the country
 * and the currency one offer: `zh` → `CN` → CNY, `en-GB` → `GB` → GBP.
 *
 * A region that is not a country (`es-419`, `en-150`) answers `undefined`;
 * so does a malformed tag. Membership in the country domain is the row's
 * `isAdmissibleValue` check, not this function's.
 */
export function browserRegion(language: string | undefined = browserLanguage()): string | undefined {
  if (typeof language !== 'string' || language.trim() === '') return undefined;
  try {
    const region = new Intl.Locale(language.trim()).maximize().region;
    return typeof region === 'string' && /^[A-Z]{2}$/.test(region) ? region : undefined;
  } catch {
    return undefined;
  }
}

/** A tag's language and region subtags once maximized, or `undefined` for a malformed tag. */
function subtagsOf(tag: string): { language: string; region?: string } | undefined {
  try {
    const locale = new Intl.Locale(tag).maximize();
    return { language: locale.language, region: locale.region };
  } catch {
    return undefined;
  }
}

/**
 * The `locale` option to offer for the browser's language, or `undefined`.
 *
 * `locale` declares no value domain, so its `options` are exhaustive
 * (objectstack#5131) and the offer must be one of them. In order: the option
 * that IS the browser's tag; else the option with the same language and
 * region once both are maximized (`zh` → `zh-Hans-CN` matches `zh-CN`); else
 * the one option with the same language (`en-GB` → `en-US`). Two options of
 * that language and no region match: no offer, rather than a pick.
 */
export function localeOffer(spec: Specifier, language: string | undefined): string | undefined {
  if (typeof language !== 'string' || language.trim() === '') return undefined;
  const tag = language.trim();
  const values = (spec.options ?? []).map((option) => String(option.value));
  const exact = values.find((value) => value.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  const wanted = subtagsOf(tag);
  if (!wanted) return undefined;
  const sameLanguage = values.filter((value) => subtagsOf(value)?.language === wanted.language);
  const sameRegion = sameLanguage.find((value) => subtagsOf(value)?.region === wanted.region);
  if (sameRegion) return sameRegion;
  return sameLanguage.length === 1 ? sameLanguage[0] : undefined;
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
 * disagree. The row then shows the refusal in the field's error slot, exactly
 * where the Settings page shows it, and writes nothing.
 */
export function isAdmissibleValue(spec: Specifier, value: string): boolean {
  if (spec.valueDomain) return isValueDomainMember(spec.valueDomain, value);
  return (spec.options ?? []).some((option) => String(option.value) === value);
}

/**
 * Does the session hold the capability this manifest demands for a write?
 *
 * Fails CLOSED on every unknown, unlike `hasCapabilities`, which fails open on
 * an unreported answer. Both directions are about who is SHOWN the checklist,
 * never about who may write (the server enforces that on the PUT regardless):
 * a row put to someone who cannot answer it is the worse failure, and a holder
 * who is not shown it still has the Settings page. So:
 *
 * - `systemPermissions` not reported (`undefined`) → not shown;
 * - a manifest that declares no `writePermission` → not shown. The spec's
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

/** A resolved value that holds something: not `null`, `undefined` or blank. */
function holdsValue(value: unknown): boolean {
  return value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');
}

/**
 * Is this localization key set for the workspace?
 *
 * - `currency` has no platform default: it is set once any rung holds a value
 *   (a deployment whose manifest declares a default currency has one, and its
 *   amounts already carry the symbol).
 * - `timezone`, `locale` and `default_country` carry platform defaults
 *   (`UTC`, `en-US`, `US`): they are set once a rung other than the manifest
 *   default holds them. The resolved value's `source` says which rung that is.
 *   The spec declares it the effective entry of the cascade ("The first entry
 *   where `value` is non-null is also the effective `source`"), so it says the
 *   same thing the Settings page's `cascadeChain` walk finds, from a member
 *   that is always present.
 *
 * A key locked by the environment resolves from `env`, so it counts as set:
 * nobody on this page could change it.
 */
export function isKeySet(key: string, resolved: ResolvedSettingValue | undefined): boolean {
  if (!resolved) return false;
  if (key === CURRENCY_KEY) return holdsValue(resolved.value);
  return resolved.source !== 'default' && holdsValue(resolved.value);
}

/** One settings key a checklist row edits. */
export interface ChecklistField {
  key: string;
  /** The key's specifier, rendered with the Settings page's own field. */
  spec: Specifier;
  /** The key's resolved value, as the server answered it. */
  resolved: ResolvedSettingValue;
  /** Whether the key is already set ({@link isKeySet}). */
  set: boolean;
  /** What the browser suggests for an unset key, when the write door would take it. */
  offer?: string;
}

/** A row that edits localization keys in place: language and country, timezone, currency. */
export interface ChecklistSettingsRow {
  id: 'language_country' | 'timezone' | 'currency';
  fields: ChecklistField[];
  /** Every field is set. */
  done: boolean;
}

/** What the browser answers, each `undefined` when it cannot tell. */
export interface BrowserAnswers {
  language?: string;
  zone?: string;
}

/** The browser's answers, read once. */
export function readBrowserAnswers(): BrowserAnswers {
  return { language: browserLanguage(), zone: browserTimeZone() };
}

/** The keys each settings row edits, in the order its fields are drawn. */
const SETTINGS_ROW_KEYS: ReadonlyArray<{ id: ChecklistSettingsRow['id']; keys: readonly string[] }> = [
  { id: 'language_country', keys: [LOCALE_KEY, COUNTRY_KEY] },
  { id: 'timezone', keys: [TIMEZONE_KEY] },
  { id: 'currency', keys: [CURRENCY_KEY] },
];

/** What the browser would offer for `spec`, before the admissibility check. */
function browserOfferFor(spec: Specifier, browser: BrowserAnswers): string | undefined {
  switch (spec.key) {
    case LOCALE_KEY:
      return localeOffer(spec, browser.language);
    case COUNTRY_KEY:
      return browserRegion(browser.language);
    case TIMEZONE_KEY:
      return browser.zone;
    case CURRENCY_KEY:
      return browserCurrency(browser.language);
    default:
      return undefined;
  }
}

/**
 * The localization rows, from the namespace's manifest and resolved values.
 *
 * A row is drawn only when every key it edits is declared by the manifest and
 * resolved by the server: a deployment that retired a key gets no row that
 * would write it. An unset field carries the browser's offer when the write
 * door would take it; a set field carries none, and shows its current value.
 */
export function localizationRows(
  manifest: SettingsManifest,
  values: Record<string, ResolvedSettingValue>,
  browser: BrowserAnswers,
): ChecklistSettingsRow[] {
  const rows: ChecklistSettingsRow[] = [];
  for (const { id, keys } of SETTINGS_ROW_KEYS) {
    const fields: ChecklistField[] = [];
    for (const key of keys) {
      const spec = manifest.specifiers.find((s) => s.key === key);
      const resolved = values[key];
      if (!spec || !resolved) break;
      const set = isKeySet(key, resolved);
      const candidate = set ? undefined : browserOfferFor(spec, browser);
      const offer = candidate && isAdmissibleValue(spec, candidate) ? candidate : undefined;
      fields.push({ key, spec, resolved, set, ...(offer ? { offer } : {}) });
    }
    if (fields.length !== keys.length) continue;
    rows.push({ id, fields, done: fields.every((field) => field.set) });
  }
  return rows;
}

/**
 * Is outbound mail set up to deliver?
 *
 * The provider is one that delivers (`log` records and sends nothing, as its
 * own label says), a From address is set, and an SMTP provider has a host.
 * The server refuses a save that leaves a visible required field empty, so a
 * saved API-key provider carries its key; the key is encrypted and reads back
 * masked, which is why it is not judged here.
 */
export function isMailConfigured(values: Record<string, ResolvedSettingValue>): boolean {
  const provider = values.provider?.value;
  if (typeof provider !== 'string' || provider === '' || provider === 'log') return false;
  if (!holdsValue(values.from_email?.value)) return false;
  if (provider === 'smtp' && !holdsValue(values.smtp_host?.value)) return false;
  return true;
}

/** Has the organization been given a name of its own? */
export function isOrganizationNamed(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed !== '' && trimmed !== DEFAULT_ORGANIZATION_NAME;
}

/**
 * Has anyone besides the first administrator been asked in? More than one
 * member, or an invitation still waiting to be accepted.
 */
export function hasInvitedColleagues(
  members: readonly unknown[],
  invitations: ReadonlyArray<{ status?: unknown }>,
): boolean {
  return members.length > 1 || invitations.some((invitation) => invitation?.status === 'pending');
}

/** The settings half of the checklist: the localization namespace and, when the session may write it, mail. */
export interface ChecklistSettingsState {
  localization: {
    manifest: SettingsManifest;
    values: Record<string, ResolvedSettingValue>;
  };
  /** `undefined` when this session may not write mail, or its read failed. */
  mail?: { done: boolean };
}

/**
 * Read what the settings rows need, or `null` for "this session is not shown
 * the checklist".
 *
 * The checklist is an administrator's: it is shown to a session that may write
 * `localization`, the namespace most of its rows edit, and to nobody else, so
 * a member never sees it. Reads through the Settings page's own client
 * (`api.ts`), never a new endpoint. The list request comes first because it
 * never refuses: it answers the manifests this session may READ, each
 * carrying its `writePermission`, so a session that may not touch
 * localization learns that without a `403` on the wire. Only a session that may
 * write then reads the namespace, and mail only when the list names mail and
 * the session may write it too.
 */
export async function readChecklistSettings(
  systemPermissions: readonly string[] | undefined,
): Promise<ChecklistSettingsState | null> {
  // No capability answer reported, or one that holds nothing: nothing below
  // could pass `mayWrite`, so no request is spent finding that out.
  if (!Array.isArray(systemPermissions) || systemPermissions.length === 0) return null;

  const { manifests } = await listSettingsManifests();
  const listed = manifests.find((m) => m.namespace === LOCALIZATION_NAMESPACE);
  if (!listed || !mayWrite(listed, systemPermissions)) return null;

  const { manifest, values } = await getSettingsNamespace(LOCALIZATION_NAMESPACE);
  if (!mayWrite(manifest, systemPermissions)) return null;

  const state: ChecklistSettingsState = { localization: { manifest, values } };
  const mailListed = manifests.find((m) => m.namespace === MAIL_NAMESPACE);
  if (mailListed && mayWrite(mailListed, systemPermissions)) {
    try {
      const mail = await getSettingsNamespace(MAIL_NAMESPACE);
      state.mail = { done: isMailConfigured(mail.values) };
    } catch {
      // A mail read that fails leaves the row out: the checklist says nothing
      // about a setting it could not read, rather than "not set".
    }
  }
  return state;
}
