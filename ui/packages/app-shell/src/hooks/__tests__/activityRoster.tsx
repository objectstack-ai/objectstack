/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A metadata registry for the activity-feed pins: the app list the shared
 * activity feed derives its object roster from (objectui#12530).
 *
 * Since objectui#12530 the bell's and Home's activity feed reads only the
 * objects the user's apps list, and asks nothing while that list has not
 * arrived. A pin about something else (row mapping, the read grant, the
 * per-user key) mounts its hook under this registry so the feed has a roster
 * to read for, and keeps asking exactly what it asked before.
 */
import * as React from 'react';
import { MetadataCtx, type MetadataContextValue, type MetadataTypeStatus } from '@object-ui/react';

/** One app whose navigation lists each of `objectNames` as an object entry. */
export function appListing(name: string, objectNames: readonly string[]): Record<string, unknown> {
  return {
    name,
    label: name,
    navigation: objectNames.map((objectName) => ({ id: `nav_${objectName}`, type: 'object', objectName })),
  };
}

/** The roster the pins read for unless they say otherwise. */
export const DEFAULT_APPS = [appListing('crm', ['crm_lead', 'crm_contract', 'crm_account'])];

/**
 * A metadata context answering `app` with `apps` and `object` with `objects`,
 * both at `status`.
 */
export function rosterRegistry(
  apps: readonly unknown[] = DEFAULT_APPS,
  { status = 'ready', objects = [] }: { status?: MetadataTypeStatus; objects?: Array<{ name: string }> } = {},
): MetadataContextValue {
  return {
    apps,
    objects,
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: (type: string) => (type === 'object' ? objects : type === 'app' ? apps : []),
    getTypeStatus: () => status,
  } as unknown as MetadataContextValue;
}

/** A `renderHook` wrapper mounting `ctx` (the default roster when omitted). */
export function withRoster(ctx: MetadataContextValue = rosterRegistry()) {
  return function RosterWrapper({ children }: { children: React.ReactNode }) {
    return <MetadataCtx.Provider value={ctx}>{children}</MetadataCtx.Provider>;
  };
}
