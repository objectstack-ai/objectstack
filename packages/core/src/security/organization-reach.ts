// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D8/D9] The ONE organization-reach rule: which organization's
 * `sys_setting` rows a caller may draw on. Two readers ask it, and must never
 * disagree about whose rows those are:
 *
 *  - `SettingsService` (`@objectstack/service-settings`) — the tenant and user
 *    rungs of every settings read, and the owner of every settings write;
 *  - the direct localization fallback (`resolveLocalizationContext`,
 *    `resolve-authz-context.ts`), which stands in for that service when it is
 *    absent or has just failed, so it can never answer what the service would
 *    refuse.
 *
 * What differs between the readers is WHERE they learn the facts, never what
 * the facts decide: the service asks the posture IN FORCE (the `tenancy`
 * service) and lets a failed read reach its caller; the fallback asks the
 * REQUESTED posture (`resolveTenancyPosture()`), the stricter source, and
 * degrades a failed read to the built-in defaults. So the rule takes those
 * facts as parameters. ⛔ Never restate the rule beside a read: hand the facts
 * to {@link resolveOrganizationReach}, and judge rows with
 * {@link organizationReachAdmits}.
 */

import type { SystemWriteOrganizationDecision } from './system-write-organization.js';

/**
 * Which rows a caller's organization reach may draw on.
 *
 * [ADR-0131 D1/D8] A row with no organization is no organization's: no reach
 * reads it as a fallback for an organization, and none reads another
 * organization's row for a caller that names none.
 *
 *  - `own` — that organization's rows, and only those. The organization is the
 *    caller's own, or — for a caller that names none where no wall stands —
 *    the one organization D9's predicate derives.
 *  - `no-organization-object` — the composition registers no organization
 *    object, so no organization can exist (the lean embedding, kept by the
 *    ruling ADR-0131's D9 note records): the rows written with no
 *    organization, the only rows such a composition can hold.
 *  - `unowned` — no organization to name: a caller that names none behind a
 *    wall, or where D9 derives none (no organization yet, or several). No row
 *    at all.
 */
export type OrganizationReach =
  | { kind: 'own'; organizationId: string }
  | { kind: 'no-organization-object' }
  | { kind: 'unowned' };

/** The reach that reads nothing. */
export const UNOWNED_ORGANIZATION_REACH: OrganizationReach = Object.freeze({ kind: 'unowned' as const });

/** An organization id with "no organization" spelled one way: a non-empty string, else `null`. */
export function organizationIdOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The facts the reach rule decides on. */
export interface OrganizationReachFacts {
  /** The caller's own organization as it carries it (`tenantId`); normalized by {@link organizationIdOf}. */
  callerOrganizationId: unknown;
  /**
   * Does a wall stand between organizations? Asked only for a caller that
   * names none. A throw propagates: the reader decides what a posture it could
   * not read means.
   */
  wallStands: () => boolean | Promise<boolean>;
  /**
   * ADR-0131 D9's decision for a caller that names no organization
   * (`resolveGuestOrganization`). Asked only for such a caller, where no wall
   * stands. A throw propagates, as above.
   */
  deriveOrganization: () => Promise<SystemWriteOrganizationDecision>;
}

/**
 * [ADR-0131 D8/D9] The caller's organization reach ({@link OrganizationReach}).
 *
 * A caller that names an organization is that organization's, under every
 * posture. One that names none is `unowned` behind a wall; elsewhere it is
 * whatever D9 derives: the one organization (`own`), a composition with no
 * organization object, or none (refused there, so `unowned` here).
 *
 * Reads nothing itself: every fact is a parameter, asked lazily and in that
 * order, so a caller that names an organization asks neither.
 */
export async function resolveOrganizationReach(facts: OrganizationReachFacts): Promise<OrganizationReach> {
  const organizationId = organizationIdOf(facts.callerOrganizationId);
  if (organizationId !== null) return { kind: 'own', organizationId };
  if (await facts.wallStands()) return UNOWNED_ORGANIZATION_REACH;
  const decision = await facts.deriveOrganization();
  if (decision.kind === 'derived') return { kind: 'own', organizationId: decision.organizationId };
  if (decision.kind === 'no-organization-object') return { kind: 'no-organization-object' };
  return UNOWNED_ORGANIZATION_REACH;
}

/**
 * The `organization_id` a reach's rows carry — the value a read filters on and
 * a write stores: the organization for `own`, `null` (no organization) for
 * `no-organization-object`, and `undefined` for `unowned`, which reads no row.
 */
export function organizationReachRowOwner(reach: OrganizationReach): string | null | undefined {
  if (reach.kind === 'own') return reach.organizationId;
  if (reach.kind === 'no-organization-object') return null;
  return undefined;
}

/**
 * Is a row owned by `rowOrganizationId` one the reach may draw on? The one
 * predicate a query's filter, an in-memory filter and a rung's pick share — the
 * organization is compared HERE, never trusted to the filter.
 */
export function organizationReachAdmits(reach: OrganizationReach, rowOrganizationId: unknown): boolean {
  const owner = organizationReachRowOwner(reach);
  return owner !== undefined && organizationIdOf(rowOrganizationId) === owner;
}
