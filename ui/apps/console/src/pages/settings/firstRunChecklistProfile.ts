// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The first-run checklist's PROFILE: which rows a deployment's host adds to the
 * platform's own, which it hides, and which it leaves optional
 * (objectstack#34251).
 *
 * The checklist draws its rows from a profile and never asks which host it runs
 * on: no row is behind an `if (managed)` in `FirstRunChecklist.tsx`. The one
 * input that picks the profile is the flag the server already serves,
 * `features.cloudManaged` of `GET /api/v1/auth/config` (plugin-auth, read from
 * `isCloudManaged()`; the console's other readers of it are Setup → Users and
 * the organization's Members page). No new field is served for this: the
 * profiles are declared here, in the console, and the flag selects one.
 *
 * - {@link SELF_HOSTED_PROFILE}: the platform's rows exactly as they are.
 * - {@link MANAGED_PROFILE}: an environment the cloud's control plane runs.
 *   People, apps and records live in the environment, so its checklist is the
 *   one place a new customer is walked through, and it adds the two rows the
 *   hosting side's own checklist used to carry ("Put your first app in", "Add
 *   your first record"). It hides the mail row while mail does not read as
 *   delivering: the hosted platform channel is a transport the mail
 *   namespace's `live.provider` statement cannot name (objectstack#32799), so
 *   the row would read "not set up" on an environment whose mail is delivered.
 *   Once the statement reads delivering, the row is drawn (as done).
 *
 * The two added rows read their done state from the server, never from a
 * click, like every other row:
 *
 * - `first_app` ({@link hasOwnApp}): the launcher lists an app that is not one
 *   of the platform's code-loaded built-ins. The launcher's list is the
 *   console's existing `GET /api/v1/me/apps` answer (`useLauncherApps`), so the
 *   row costs no request of its own. "Non-empty" alone would read done on every
 *   environment: an administrator's list always carries Setup and Studio. The
 *   built-in test is app-shell's `isPlatformBuiltinApp`, the one the AI chat's
 *   package switcher uses.
 * - `first_record` ({@link readFirstRecordCreated}): one `sys_activity` row of
 *   type `created`, written by a person (`actor_id` set; a seed, an import run
 *   by the system or a migration leaves it null), on an object one of those
 *   apps lists. One read, `$top: 1`, over indexed columns. ⚠️ The activity
 *   feed keeps 14 days (its `lifecycle.retention`), so an environment where
 *   nobody created a record for 14 days reads "not done" again. That is why the
 *   managed profile makes this row OPTIONAL: it never holds the checklist open
 *   and never counts toward its progress, so a quiet fortnight cannot bring the
 *   checklist back.
 *
 * @module
 */

import { isPlatformBuiltinApp } from '@object-ui/app-shell';
import { isOptionalRow, type ChecklistRowId } from './firstRunChecklistLogic';

/** The rows a host may add to the platform's own. */
export type HostChecklistRowId = 'first_app' | 'first_record';

/** What a host changes about the checklist. Every list is empty on the self-hosted profile. */
export interface FirstRunChecklistProfile {
  /** Rows the host adds, drawn after the platform's rows in this order. */
  readonly addedRows: readonly HostChecklistRowId[];
  /** Rows drawn only once they read done: while not done, the host has nothing to ask the administrator to do. */
  readonly hiddenUntilDone: readonly ChecklistRowId[];
  /** Rows that neither hold the checklist open nor count toward its progress, beyond the platform's own optional rows. */
  readonly optionalRows: readonly HostChecklistRowId[];
}

/** A deployment that runs itself: today's checklist, unchanged. */
export const SELF_HOSTED_PROFILE: FirstRunChecklistProfile = Object.freeze({
  addedRows: Object.freeze([]),
  hiddenUntilDone: Object.freeze([]),
  optionalRows: Object.freeze([]),
});

/** An environment the cloud's control plane runs (`features.cloudManaged: true`). */
export const MANAGED_PROFILE: FirstRunChecklistProfile = Object.freeze({
  addedRows: Object.freeze(['first_app', 'first_record'] as const),
  hiddenUntilDone: Object.freeze(['mail'] as const),
  optionalRows: Object.freeze(['first_record'] as const),
});

/**
 * The profile the served auth config selects. Only `cloudManaged: true` selects
 * the managed one; a config without the flag, or none at all, is self-hosted.
 */
export function checklistProfileFor(
  features: { cloudManaged?: unknown } | null | undefined,
): FirstRunChecklistProfile {
  return features?.cloudManaged === true ? MANAGED_PROFILE : SELF_HOSTED_PROFILE;
}

/** Is row `id` optional under `profile`: one of the platform's optional rows, or one the profile adds to them? */
export function isProfileOptionalRow(profile: FirstRunChecklistProfile, id: string): boolean {
  return isOptionalRow(id) || (profile.optionalRows as readonly string[]).includes(id);
}

/** Is row `id`, reading `done`, drawn under `profile`? */
export function profileDrawsRow(profile: FirstRunChecklistProfile, id: string, done: boolean): boolean {
  return done || !(profile.hiddenUntilDone as readonly string[]).includes(id);
}

/** The slice of an app the two added rows read. */
export interface ChecklistApp {
  name?: unknown;
  _packageId?: unknown;
  navigation?: readonly unknown[] | null;
  areas?: ReadonlyArray<{ navigation?: readonly unknown[] | null } | null | undefined> | null;
}

/** The apps the launcher lists that somebody put in: every one that is not a platform built-in. */
export function ownApps<T extends ChecklistApp>(launcherApps: readonly T[]): T[] {
  return launcherApps.filter((app) => !isPlatformBuiltinApp(app));
}

/** "Put your first app in" is done: the launcher lists an app that is not a platform built-in. */
export function hasOwnApp(launcherApps: readonly ChecklistApp[]): boolean {
  return ownApps(launcherApps).length > 0;
}

/**
 * The objects `apps` list in their navigation (`type: 'object'` entries, at any
 * depth, in the app's own tree and in each area's), sorted and de-duplicated so
 * the same apps always give the same list.
 */
export function appObjectNames(apps: readonly ChecklistApp[]): string[] {
  const names = new Set<string>();
  const walk = (items: readonly unknown[] | null | undefined): void => {
    for (const item of items ?? []) {
      const entry = item as { type?: unknown; objectName?: unknown; children?: unknown } | null;
      if (entry?.type === 'object' && typeof entry.objectName === 'string' && entry.objectName !== '') {
        names.add(entry.objectName);
      }
      if (Array.isArray(entry?.children)) walk(entry.children);
    }
  };
  for (const app of apps) {
    walk(app.navigation);
    for (const area of app.areas ?? []) walk(area?.navigation);
  }
  return [...names].sort();
}

/** The object the first-record row reads. */
export const ACTIVITY_OBJECT = 'sys_activity';

/** The slice of the data source the first-record read uses. */
export interface FirstRecordSource {
  find(object: string, query: Record<string, unknown>): Promise<{ data?: unknown } | unknown[] | null | undefined>;
}

/**
 * Has a person created a record on one of `objectNames`?
 *
 * No object to ask about (no app of the environment's own lists one) is "no",
 * answered without a request. Otherwise one `sys_activity` read: a `created`
 * row with an actor, on one of those objects, at most one row. A read that
 * fails rejects: the row is then left out, never shown as not done.
 *
 * ⚠️ Bounded by the feed's 14-day retention; see the module header.
 */
export async function readFirstRecordCreated(
  source: FirstRecordSource,
  objectNames: readonly string[],
): Promise<boolean> {
  if (objectNames.length === 0) return false;
  const res = await source.find(ACTIVITY_OBJECT, {
    $filter: { type: 'created', actor_id: { $ne: null }, object_name: { $in: [...objectNames] } },
    $top: 1,
  });
  const rows = Array.isArray(res) ? res : (res as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(rows) && rows.length > 0;
}
