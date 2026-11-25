// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36502 — Studio's Interfaces pillar is retired: menus, header
 * actions, list views, dashboards, reports and record pages are designed in
 * the running app's design mode, and custom pages and print layouts have no
 * visual editor (they stay loadable and writable as metadata, in the
 * "All metadata" area, in code or through the AI).
 *
 * An old Interfaces URL — `/studio/<package>/interfaces`, with or without a
 * `?surface=` deep link — still opens: it lands on the package's Studio home
 * (the retired Data pillar's address, which redirects to the package's object
 * list, objectstack#36904) and says once, there, where interface editing went, with a
 * link back to the app. A `?changes=review` request travels with it, because
 * the Changes drawer it opens is the surface's, not the pillar's
 * (`studioChangesLink.ts`); the retired pillar's own parameters are dropped.
 * The sentence is `StudioInterfacesRetiredNotice`.
 */

import { STUDIO_HOME_PILLAR, studioPillarPath } from './studioAddress.js';
import { STUDIO_RETIRED_INTERFACES_KEPT_PARAMS } from './studioAddressTable.js';

// objectstack#36895 — the retired segment and the Studio home are Studio
// address vocabulary, owned by `studioAddress.ts`; re-exported here. Which
// parameters survive the redirect is the address table's call.
/** The retired pillar's route segment, and the Studio home: the pillar a package's Studio opens on. */
export { RETIRED_INTERFACES_SEGMENT, STUDIO_HOME_PILLAR } from './studioAddress.js';

/** The navigation state a retired-URL landing carries, read once by the surface. */
export const INTERFACES_RETIRED_STATE = 'studioInterfacesRetired';

/** The query keys an old Interfaces URL may carry that still mean something on the home pillar (`studioAddressTable.ts`). */
const KEPT_PARAMS: readonly string[] = STUDIO_RETIRED_INTERFACES_KEPT_PARAMS;

/**
 * Where an old Interfaces URL lands: the scope's home pillar, with only the
 * parameters the surface itself reads.
 */
export function retiredInterfacesTarget(scopeSegment: string, search: string): string {
  const from = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of KEPT_PARAMS) {
    for (const value of from.getAll(key)) kept.append(key, value);
  }
  return studioPillarPath(scopeSegment, STUDIO_HOME_PILLAR, { query: kept });
}

/** The navigation state that marks a landing from an old Interfaces URL. */
export function retiredInterfacesState(): Record<string, true> {
  return { [INTERFACES_RETIRED_STATE]: true };
}

/** Whether a location's state marks it as a landing from an old Interfaces URL. */
export function isRetiredInterfacesLanding(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[INTERFACES_RETIRED_STATE] === true;
}
