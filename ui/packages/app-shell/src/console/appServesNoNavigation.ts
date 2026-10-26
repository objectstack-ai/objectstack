// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Whether an app serves the caller nothing to navigate to (objectui#12079).
 *
 * Kept apart from `AppNoAccessEmptyState.tsx` so that file exports only a
 * component; the app index route in `AppContent.tsx` asks this question first
 * and renders the empty state on a yes.
 */

import { hasVisibleNavigationItems } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import { mayReadObject, type ObjectReadCheck } from '../utils/navObjectReadGate.js';

/** The two trees an app's sidebar draws from: the top level and every area. */
interface AppNavigationLike {
  navigation?: NavigationItem[] | null;
  areas?: Array<{ navigation?: NavigationItem[] | null } | null> | null;
}

/**
 * Whether the app serves this caller nothing to navigate to: no item in its
 * top-level `navigation` and none in any `areas[].navigation`.
 *
 * The question is structural. It reuses the sidebar's own predicate,
 * `hasVisibleNavigationItems`, with no guards, so a `separator` and a `group`
 * with no children count as nothing, exactly as the sidebar draws them. The
 * sidebar wires an action dispatcher, so an `action` item counts as content.
 *
 * ⛔ This is NOT "no landing route". The landing resolver walks the top-level
 * `navigation` only and lands on an `object`, `page`, `dashboard`, `report` or
 * `component` entry, so an app can serve entries and still have no landing:
 * one whose entries are all `url`, `action` or `doc` links, or one that serves
 * them only under `areas`. Such an app is not one the caller has no access in,
 * and this answers no for it. The Studio app is not that case: its navigation
 * is all `component` entries, and its root lands on the first one
 * (objectui#12113).
 */
export function appServesNoNavigation(app: AppNavigationLike | null | undefined): boolean {
  const options = { hasActionHandler: true };
  if (hasVisibleNavigationItems(app?.navigation ?? [], options)) return false;
  return !(app?.areas ?? []).some((area) => hasVisibleNavigationItems(area?.navigation ?? [], options));
}

/**
 * Whether the app names objects in its navigation and the caller may read none
 * of them (objectstack#25338).
 *
 * The object-read prune (`withoutUnreadableObjectEntries`) drops every
 * `type: 'object'` entry such a caller may not read, but it keeps the
 * `dashboard`, `report` and `page` entries, which name no object in a declared
 * key. So a new user who holds no permission set was still landed on the app's
 * first dashboard, where every tile answered "You don't have access": a grid of
 * refusals as their first screen, and nothing saying what to do.
 *
 * The question is asked of the app as SERVED, before any gate: every
 * `objectName` of a `type: 'object'` entry in `navigation` and in every
 * `areas[].navigation`, at every depth. It answers yes only when there is at
 * least one and the caller may read none, so an app that names no object (a
 * dashboard-only app) is not judged by it: nothing here says what such an app
 * reads. A caller who may read any one named object is not refused here.
 */
export function appNamesOnlyUnreadableObjects(
  app: AppNavigationLike | null | undefined,
  can: ObjectReadCheck,
): boolean {
  const named = new Set<string>();
  const collect = (items: NavigationItem[] | null | undefined): void => {
    for (const item of items ?? []) {
      if (item?.type === 'object' && typeof item.objectName === 'string' && item.objectName !== '') {
        named.add(item.objectName);
      }
      const children = item?.type === 'separator' ? undefined : item?.children;
      if (Array.isArray(children)) collect(children);
    }
  };
  collect(app?.navigation);
  for (const area of app?.areas ?? []) collect(area?.navigation);
  if (named.size === 0) return false;
  for (const objectName of named) {
    if (mayReadObject(can, objectName)) return false;
  }
  return true;
}
