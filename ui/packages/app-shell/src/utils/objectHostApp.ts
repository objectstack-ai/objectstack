/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which app OWNS a record of an object: the app a link to that record, or to a
 * page about it, should open under (objectstack#32667).
 *
 * `resolveHostAppSegment` answers a different question: where a page that
 * belongs to no app (the inbox, the activity list) is hosted, which is wherever
 * the user is. A page ABOUT a record is not app-independent: an approval
 * request opened under an app whose navigation never names its record's
 * object draws that app's sidebar and switcher, neither of which reaches the
 * record (the request opened under the Leave app for a record of another app).
 * So a record-bound link asks this module instead, in this order:
 *
 *  1. the app the link is built in, when it lists the object (the caller stays
 *     where it is: a request about a record of the app the reader is in opens
 *     there);
 *  2. the first app the user can open (`filterActiveApps`, metadata order) that
 *     lists the object, addressed by `appAddressSegment`;
 *  3. Setup, the neutral administration context, when the user can open it;
 *  4. `undefined` — the user can open no app that lists the object and cannot
 *     open Setup, so every app they can reach is equally unrelated. The caller
 *     keeps its own app, the one place it knows the user can reach.
 *
 * An app lists an object through a `type: 'object'` entry naming it, at any
 * depth of its `navigation` or of any `areas[].navigation`: the entries the
 * sidebar draws for it. The trees are read as authored; the member gates the
 * sidebar applies (`useNavMemberGates`) are not, so an entry a `visible`
 * expression hides from this member still makes its app the owner.
 *
 * An empty or unloaded app list answers `undefined` at every step, so a caller
 * that resolves before the catalog lands keeps the app it was asked from.
 */

import { useParams } from 'react-router-dom';
import { useMetadata } from '@object-ui/react';
import { navigationNames } from '../console/appObjectScope.js';
import { SETUP_APP_NAME, SETUP_APP_PACKAGE_ID } from '../console/setupApp.js';
import { appAddressSegment, filterActiveApps, matchAppBySegment } from './appRoute.js';

/** The keys of an app this module reads: its route keys and navigation trees. */
export type ObjectHostApp = { name?: unknown; _packageId?: unknown; navigation?: unknown; areas?: unknown } & Record<
  string,
  unknown
>;

const pickObjectEntry = (item: Record<string, unknown>) => (item.type === 'object' ? item.objectName : undefined);

/**
 * Whether `app` lists `objectName`: a `type: 'object'` entry naming it, at any
 * depth of its `navigation` or of any `areas[].navigation`.
 */
export function appListsObject(app: ObjectHostApp | null | undefined, objectName: string): boolean {
  if (!app || !objectName) return false;
  const areas: unknown[] = Array.isArray(app.areas) ? app.areas : [];
  const trees = [app.navigation, ...areas.map((area) => (area as { navigation?: unknown } | null)?.navigation)];
  return trees.some((tree) => navigationNames(tree, pickObjectEntry).includes(objectName));
}

/**
 * The `/apps/<segment>` a record of `objectName` opens under, asked from the
 * app `currentSegment` names; `undefined` when no app can be named (see the
 * module docblock for the order).
 */
export function objectHostAppSegment(
  apps: readonly ObjectHostApp[] | null | undefined,
  objectName: string | null | undefined,
  currentSegment: string | null | undefined,
): string | undefined {
  if (!objectName) return undefined;
  const active = filterActiveApps(apps);
  const current = matchAppBySegment(active, currentSegment);
  if (current && currentSegment && appListsObject(current, objectName)) return currentSegment;
  const owner = active.find((app) => appListsObject(app, objectName));
  if (owner) return appAddressSegment(apps, owner);
  const setup = matchAppBySegment(active, SETUP_APP_PACKAGE_ID) ?? matchAppBySegment(active, SETUP_APP_NAME);
  return setup ? appAddressSegment(apps, setup) : undefined;
}

/**
 * {@link objectHostAppSegment} over the console's app catalog, asked from the
 * route's own `:appName`.
 */
export function useObjectHostAppSegment(objectName: string | null | undefined): string | undefined {
  const { apps } = useMetadata();
  const { appName } = useParams<{ appName?: string }>();
  return objectHostAppSegment(apps as readonly ObjectHostApp[] | undefined, objectName, appName);
}
