// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36909 (Studio redesign epic #36890) — where every retired pillar
 * address lands. No pillar draws a page any more: objects, flows and
 * permission sets open their designers full-screen on their metadata
 * addresses, the Interfaces pillar retired with objectstack#36502, and the
 * sharing overview has its own route. The pillar addresses are bookmarks, test
 * pins, links an AI was handed and the server's draft review link
 * (`studioChangesReviewLink` in `@objectstack/types`, `/data?changes=review`),
 * so each still opens what it named, through ONE table:
 *
 *  | address                                   | lands on                                        |
 *  |-------------------------------------------|-------------------------------------------------|
 *  | `/studio/<package>` (bare)                | the package's home, as `/data` below            |
 *  | `/studio/<package>/data[?surface=object:]`| the object list, or that object's designer      |
 *  | `/studio/<package>/automations[?surface=flow:]` | the flow list, or that flow's designer    |
 *  | `/studio/<package>/access[?surface=…]`    | the permission set list, a set's matrix, or the sharing overview (`AccessPillarLanding`) |
 *  | `/studio/<package>/interfaces[?…]`        | the package's home, saying where interface editing went |
 *  | `/studio/~org/automations[?surface=flow:]`| the package-less scope's flow list, or that flow |
 *  | `/studio/~org/<anything else>`            | the package-less scope's flow list              |
 *
 * Each mapping lives beside its pillar (`dataPillarRedirect`,
 * `automationsPillarRedirect`, `accessPillarRedirect`,
 * `retiredInterfacesTarget`); this module is the one place that picks it. A
 * target in the "All metadata" area is put on its settled address
 * ({@link settledAreaAddress}), so the old address reaches it in ONE redirect:
 * the area finds nothing to change and redirects no further.
 *
 * A base's `.custom` pair keeps the rule each pillar had: its Data and
 * Automations addresses land in the pair's own area, its Access and
 * Interfaces addresses on the base (the base's Studio lists and edits the
 * pair's items, ADR-0146 D3).
 *
 * Every other segment is no retired pillar: `null`, and the route draws the
 * page that answers to it (the sharing overview, or the not-found state).
 *
 * Pure, so the whole table is pinned without a render.
 */

import { customizationBasePackageId } from '@objectstack/spec/kernel';
import { automationsPillarRedirect } from './automationsPillarRedirect.js';
import { dataPillarRedirect, isStudioAllPackagesScope, settledAreaAddress } from './metadataArea.js';
import { RETIRED_INTERFACES_SEGMENT, STUDIO_HOME_PILLAR, type StudioPillarKey } from './studioAddress.js';
import { retiredInterfacesState, retiredInterfacesTarget } from './studioInterfacesRetired.js';
import { isStudioOrgScope, studioOrgScopePath } from './studioScope.js';

/** A retired pillar's route segment: the three pillars, and the Interfaces pillar retired before them. */
export type StudioRetiredPillarSegment = StudioPillarKey | typeof RETIRED_INTERFACES_SEGMENT;

/** Every retired pillar segment, in the order the pillars were drawn. */
export const STUDIO_RETIRED_PILLAR_SEGMENTS: readonly StudioRetiredPillarSegment[] = Object.freeze([
  'data',
  'automations',
  'access',
  RETIRED_INTERFACES_SEGMENT,
]);

/** The retired Automations pillar's segment, the one the package-less scope had. */
const AUTOMATIONS_SEGMENT: StudioRetiredPillarSegment = 'automations';

/** The retired Access pillar's segment. */
const ACCESS_SEGMENT: StudioRetiredPillarSegment = 'access';

/** Where a retired pillar address goes. */
export type StudioPillarRedirectTarget =
  /** Straight to `to`, with `state` as the navigation's state when given. */
  | { kind: 'navigate'; to: string; state?: Record<string, true> }
  /**
   * The Access pillar, of `packageId`: where it lands depends on which of the
   * base's and its pair's permission sets holds the set it names, a read
   * (`AccessPillarLanding`, `accessPillarRedirect.ts`).
   */
  | { kind: 'access'; packageId: string };

/**
 * Where `/studio/<segment>[/<pillar>]<search>` lands, or `null` when that is
 * no retired pillar address. `segment` is the route segment as read (a
 * package id, `~org`); `pillar` the next segment, absent for the bare
 * package address; `search` the URL's query, with or without its `?`.
 */
export function studioPillarRedirect(
  segment: string | null | undefined,
  pillar: string | null | undefined,
  search: string,
): StudioPillarRedirectTarget | null {
  if (!segment || isStudioAllPackagesScope(segment)) return null;
  const section = pillar ?? STUDIO_HOME_PILLAR;
  if (isStudioOrgScope(segment)) {
    // objectstack#36903 — the scope's one pillar was Automations; it has an
    // area of its flows alone, so every other address of it lands on that list.
    const to = section === AUTOMATIONS_SEGMENT ? automationsPillarRedirect(segment, search) : studioOrgScopePath();
    return { kind: 'navigate', to };
  }
  switch (section) {
    case STUDIO_HOME_PILLAR:
      return { kind: 'navigate', to: settledAreaAddress(dataPillarRedirect(segment, search)) };
    case AUTOMATIONS_SEGMENT:
      return { kind: 'navigate', to: settledAreaAddress(automationsPillarRedirect(segment, search)) };
    case ACCESS_SEGMENT:
      return { kind: 'access', packageId: customizationBasePackageId(segment) ?? segment };
    case RETIRED_INTERFACES_SEGMENT:
      return {
        kind: 'navigate',
        to: retiredInterfacesTarget(customizationBasePackageId(segment) ?? segment, search),
        state: retiredInterfacesState(),
      };
    default:
      return null;
  }
}
