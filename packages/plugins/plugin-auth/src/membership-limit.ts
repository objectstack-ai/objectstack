// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveOrgMembershipLimit } from '@objectstack/types';

/**
 * "No cap" as a finite number, because the option this feeds is compared
 * (`count >= limit`) but also travels through option plumbing that may assume a
 * finite value. Nine quadrillion members is unlimited by any measure that
 * reaches a real deployment.
 */
export const MEMBERSHIP_LIMIT_UNBOUNDED = Number.MAX_SAFE_INTEGER;

/**
 * The value handed to better-auth's `organization({ membershipLimit })`.
 *
 * This exists as its own function so the DECISION is testable rather than
 * living inside a plugin-construction expression. The decision: how many
 * members an organization may hold is not something this platform limits —
 * entitlements meter AI seats, and plain membership is not a billed axis.
 *
 * It has to be passed explicitly all the same. better-auth substitutes a vendor
 * default of 100 for an absent `membershipLimit` (`count >= (membershipLimit ||
 * 100)`), which reaches the operator as `Organization membership limit
 * reached` — a refusal nobody in this codebase chose, on an axis nothing here
 * bills, and indistinguishable in the field from a licence problem.
 *
 * `OS_ORG_MEMBERSHIP_LIMIT` is the opt-in for a deployment that DOES want a
 * ceiling (a pilot, a trial tenant). Anything unusable there reads as unset —
 * a typo must not be the thing that locks an organization.
 */
export function resolveMembershipLimitOption(): number {
  return resolveOrgMembershipLimit() ?? MEMBERSHIP_LIMIT_UNBOUNDED;
}
