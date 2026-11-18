// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34724 (ADR-0146 D4 as amended 2026-11-17) — where Studio's
 * landing sends a switched-off action of an installed app: to the place its
 * switch is drawn.
 *
 *  - An action an object holds (its served `actions[]`, which carries the
 *    actions declared inside the object and the top-level ones bound to it by
 *    `objectName`) is switched on the object's Actions view in the Data
 *    pillar: `?surface=object:<object>&action=<name>` opens that view on it.
 *    An action declared inside its object has no item of its own, so this is
 *    the only page that shows it.
 *  - Any other action (one bound to no object) is a standalone `action` item:
 *    its page in the "All metadata" area carries the switch.
 *
 * The ledger row the customization read serves names the action only, never
 * its object, so the object is read here: one `list('object', { packageId })`
 * of the app, the same read the Data pillar lists its objects with.
 */

import { DESIGNER_SURFACE_PARAM, formatSurfaceParam } from '../metadata-admin/nav-selection.js';
import { DESIGNER_SURFACE_ACTION_PARAM } from './useSurfaceDeepLink.js';

/** The slice of the metadata client the object read uses. */
export interface ActionObjectClient {
  list(type: string, options?: { packageId?: string }): Promise<unknown>;
}

/** Action name → the object whose served `actions[]` holds it. */
export type ActionObjects = Readonly<Record<string, string>>;

/**
 * Read which of `packageId`'s objects holds each action, off the app's served
 * objects. Rejects when the list fails; an object or action without a name is
 * skipped, and the first object that holds a name keeps it.
 */
export async function readActionObjects(client: ActionObjectClient, packageId: string): Promise<ActionObjects> {
  const objects = await client.list('object', { packageId });
  const out: Record<string, string> = {};
  if (!Array.isArray(objects)) return out;
  for (const raw of objects) {
    if (!raw || typeof raw !== 'object') continue;
    const object = raw as { name?: unknown; actions?: unknown };
    if (typeof object.name !== 'string' || !object.name || !Array.isArray(object.actions)) continue;
    for (const action of object.actions) {
      const name = action && typeof action === 'object' ? (action as { name?: unknown }).name : undefined;
      if (typeof name === 'string' && name && !(name in out)) out[name] = object.name;
    }
  }
  return out;
}

/**
 * The page a switched-off action is switched on again from: its object's
 * Actions view when `object` names one, else the action's own item page.
 */
export function switchedOffActionPath(packageId: string, name: string, object: string | null | undefined): string {
  const pkg = encodeURIComponent(packageId);
  if (object) {
    const query = new URLSearchParams({
      [DESIGNER_SURFACE_PARAM]: formatSurfaceParam({ type: 'object', name: object }),
      [DESIGNER_SURFACE_ACTION_PARAM]: name,
    });
    return `/studio/${pkg}/data?${query.toString()}`;
  }
  return `/studio/${pkg}/metadata/action/${encodeURIComponent(name)}`;
}

/** The app's action list in the "All metadata" area: where several switched-off actions are listed. */
export const switchedOffActionListPath = (packageId: string): string =>
  `/studio/${encodeURIComponent(packageId)}/metadata/action`;
