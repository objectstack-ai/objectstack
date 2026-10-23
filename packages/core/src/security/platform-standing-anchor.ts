// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D5] The ONE rule for which `admin_full_access` grant ANCHORS
 * platform-admin standing, with the posture and the Default Organization as
 * its parameters. Two readers ask it, and must name the same grant:
 *
 *  - `resolveAuthzContext` (§6b, `resolve-authz-context.ts`) — the derivation
 *    of `PLATFORM_ADMIN` from a stored grant;
 *  - the last-administrator guard (`@objectstack/plugin-auth`,
 *    `last-admin-guard.ts`) — the enumeration of who would administer the
 *    environment once a pending write lands, over the Default Organization as
 *    that write would leave it.
 *
 * A reader that answered differently would let the guard permit the write
 * that ends the last anchored administrator's standing, or refuse one that
 * ends nobody's.
 *
 * What differs between the readers is HOW they learn the facts, never what
 * the facts decide: the resolver reads the Default Organization memoised and
 * fails loud on an unreachable store, the guard simulates the pending write and
 * fails closed. Each also keeps its own normalizer for a grant row's
 * organization; the rule takes the organization already normalized. ⛔ Never
 * restate the rule beside a read: hand the facts to
 * {@link organizationAnchorsPlatformStanding}.
 */

/** The deployment facts the anchor rule decides on. */
export interface PlatformStandingAnchorFacts {
  /**
   * Does the posture wall organizations off from each other (`group` /
   * `isolated`)? Both readers pass the REQUESTED posture
   * (`postureEnforcesWall(resolveTenancyPosture())`): a deployment that asked
   * for a wall stays walled here even while running degraded.
   */
  walled: boolean;
  /** The Default Organization's id (`findDefaultOrganization`), or `undefined` when none can be named. */
  defaultOrganizationId: string | undefined;
}

/**
 * [ADR-0131 D5 / #11663 L5] Does an `admin_full_access` grant owned by
 * `grantOrganizationId` anchor platform standing?
 *
 *  - a walled posture: no grant anchors; standing is config-derived
 *    (`OS_PLATFORM_OWNER_EMAIL`) and nothing else;
 *  - `single`: the grant owned by the Default Organization — the one the
 *    first-user promotion writes.
 *
 * Any other organization's grant of the set confers the set, never standing.
 * An organization-less grant (`null` / `undefined`) anchors nothing: the
 * ownership ceremony (ADR-0131 D10) attributes the one an earlier release's
 * promotion wrote to the Default Organization. Neither does any grant where no
 * Default Organization can be named.
 *
 * The caller has already established that the grant names `admin_full_access`.
 */
export function organizationAnchorsPlatformStanding(
  grantOrganizationId: string | null | undefined,
  anchor: PlatformStandingAnchorFacts,
): boolean {
  if (anchor.walled || anchor.defaultOrganizationId === undefined) return false;
  return grantOrganizationId !== null
    && grantOrganizationId !== undefined
    && grantOrganizationId === anchor.defaultOrganizationId;
}
