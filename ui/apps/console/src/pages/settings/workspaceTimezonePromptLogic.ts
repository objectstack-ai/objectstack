// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * When the console asks an administrator to set a still-default workspace
 * timezone, and what it offers (objectui#11758).
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
 * Kept apart from `WorkspaceTimezonePrompt.tsx` so that module exports a
 * component only, and so every condition below is a pure function a test can
 * drive without rendering.
 *
 * @module
 */

import { isValueDomainMember } from '@objectstack/spec/shared';
import { getSettingsNamespace, listSettingsManifests } from './api';
import type { ResolvedSettingValue, SettingsManifest, Specifier } from './types';

/** The settings namespace that owns the workspace's regional defaults. */
export const LOCALIZATION_NAMESPACE = 'localization';

/** The key the localization cascade resolves the workspace's zone from. */
export const TIMEZONE_KEY = 'timezone';

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
 * Would the settings write door admit `zone` for this specifier?
 *
 * The same two rules the server applies to a `select` write, in the same
 * order. A declared `valueDomain` is the enforcement boundary (objectstack#5712),
 * judged by `isValueDomainMember` from `@objectstack/spec/shared`: the ONE
 * membership predicate the settings door and the record write path share, so
 * this is that predicate called, not a copy of it. Without a declared domain,
 * the `options` table is exhaustive (objectstack#5131).
 *
 * The server judges with ITS runtime's time-zone data and this runs on the
 * browser's, so a zone this admits can still be refused at the door when the
 * two disagree. The prompt then shows the refusal in the field's error slot,
 * exactly where the Settings page shows it, and writes nothing.
 */
export function isAdmissibleZone(spec: Specifier, zone: string): boolean {
  if (spec.valueDomain) return isValueDomainMember(spec.valueDomain, zone);
  return (spec.options ?? []).some((option) => String(option.value) === zone);
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

/** What the prompt offers: the zone, and the field it is edited in. */
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

/**
 * Is `localization.timezone` still the manifest default, may this session
 * write it, and does the browser have a zone the door would take? Answers the
 * offer, or `null` for "do not ask".
 *
 * Reads through the Settings page's own client (`api.ts`), never a new
 * endpoint. The list request comes first because it never refuses: it answers
 * the manifests this session may READ, each carrying its `writePermission`, so
 * a session that may not touch localization learns that without a `403` on the
 * wire. Only a session that may write then reads the namespace.
 *
 * "Still the default" is the resolved value's `source`. The spec declares it
 * the effective entry of the cascade ("The first entry where `value` is
 * non-null is also the effective `source`"), and the service sets it from that
 * entry, so it says the same thing the Settings page's `cascadeChain` walk
 * finds, from a member that is always present: `cascadeChain` is optional on
 * the wire. A locked key is not offered either: the write would be refused.
 */
export async function findTimezoneOffer(
  systemPermissions: readonly string[] | undefined,
  zone: string,
): Promise<TimezoneOffer | null> {
  // No capability answer reported, or one that holds nothing: nothing below
  // could pass `mayWrite`, so no request is spent finding that out.
  if (!Array.isArray(systemPermissions) || systemPermissions.length === 0) return null;

  const { manifests } = await listSettingsManifests();
  const listed = manifests.find((m) => m.namespace === LOCALIZATION_NAMESPACE);
  if (!listed || !mayWrite(listed, systemPermissions)) return null;

  const { manifest, values } = await getSettingsNamespace(LOCALIZATION_NAMESPACE);
  if (!mayWrite(manifest, systemPermissions)) return null;

  const resolved = values[TIMEZONE_KEY];
  if (!resolved || resolved.source !== 'default' || resolved.locked) return null;
  if (typeof resolved.value !== 'string') return null;

  const spec = manifest.specifiers.find((s) => s.key === TIMEZONE_KEY);
  if (!spec || !isAdmissibleZone(spec, zone)) return null;

  return { spec, resolved, current: resolved.value, zone };
}
