// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveOrgInvitationLimit } from '@objectstack/types';

/**
 * "No limit" as a finite number, for the same reason as
 * `MEMBERSHIP_LIMIT_UNBOUNDED`: better-auth compares the option
 * (`pending >= invitationLimit`) after `invitationLimit ?? 100`, and its type is
 * a plain `number` with no "off" spelling: `null` would fall back to the
 * vendor's 100, while `false` (kept by `??`, compared as 0) and `0` would refuse
 * every invitation. Nine quadrillion pending invitations is
 * unlimited by any measure that reaches a real deployment.
 */
export const INVITATION_LIMIT_UNBOUNDED = Number.MAX_SAFE_INTEGER;

/**
 * The `invitationLimit` handed to better-auth's `organization(...)`, or
 * `undefined` to pass none.
 *
 * It decides how many PENDING invitations one organization may hold before
 * `/organization/invite-member` answers `403 INVITATION_LIMIT_REACHED`. The
 * host sets it with `OS_ORG_INVITATION_LIMIT`:
 *
 *  - unset (or unusable, `0` included) → `undefined`. Nothing is passed and the
 *    vendor's default of 100 applies, so a deployment that sets nothing behaves
 *    exactly as it did before this setting existed;
 *  - a positive integer N → N;
 *  - `off` / `unlimited` / `none` → {@link INVITATION_LIMIT_UNBOUNDED}: no
 *    limit. The cloud control plane sets this, because an environment may
 *    invite people in bulk (CSV import).
 *
 * A function of its own, like `resolveMembershipLimitOption`, so the decision
 * is testable outside the plugin-construction expression.
 */
export function resolveInvitationLimitOption(): number | undefined {
  const limit = resolveOrgInvitationLimit();
  if (limit === 'off') return INVITATION_LIMIT_UNBOUNDED;
  return limit;
}
