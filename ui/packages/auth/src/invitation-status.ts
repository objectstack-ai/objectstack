/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Invitation status vocabulary — the console's ONE entry point for it.
 *
 * ## Why this is a module and not a doc comment
 *
 * `AuthInvitation.status` was declared as an open `string` while its own doc
 * comment enumerated exactly four members (objectui#3879). A comment cannot be
 * enforced, so every consumer had to be liberal in turn: `InvitationsPage`
 * carried a `default: 'secondary'` arm in its badge-variant switch and a
 * `defaultValue: inv.status` that would render the raw wire string as UI copy —
 * in all ten packs — for any value the enumeration did not cover. Declared =
 * enforced (AGENTS.md #0.1): the union now lives in the type, and the wire
 * boundary in `createAuthClient` is the one place an unvalidated string may
 * become one.
 *
 * ## The vocabulary is CLOSED — and derived, not mirrored
 *
 * The producer is better-auth's organization plugin, whose own
 * `InvitationStatus` is `'pending' | 'accepted' | 'rejected' | 'canceled'`
 * (`better-auth/client/plugins`; the framework stores it in
 * `sys_invitation.status`). This module BINDS that type instead of restating it,
 * for the same reason `org-roles.ts` binds the spec's
 * `BUILTIN_MEMBERSHIP_ROLES`: a member-for-member copy is precisely the state
 * one upstream release away from drifting silently.
 *
 * The runtime list is derived from a total `Record` keyed by that union, so the
 * compile-time half and the runtime half cannot disagree — a fifth status
 * upstream fails to compile HERE (the map is missing a key) rather than slipping
 * past the boundary check and out onto a badge.
 *
 * What stays LOCAL, deliberately: everything about *display*. The filter tabs'
 * `StatusFilter` (which adds an `all` pseudo-member) and the badge variants are
 * screen concerns and live with the screen — the same boundary `org-roles.ts`
 * draws for its labels and grade ladder.
 */

import type { InvitationStatus } from 'better-auth/client/plugins';

/**
 * Status an organization invitation can carry — better-auth's own union, bound
 * rather than copied.
 */
export type AuthInvitationStatus = InvitationStatus;

/**
 * Total map over the union — the compile-time half of the pin. Values are the
 * members themselves so the runtime list below is DERIVED rather than restated
 * (one literal list, not two).
 */
const STATUS_MEMBERS: Record<AuthInvitationStatus, AuthInvitationStatus> = {
  pending: 'pending',
  accepted: 'accepted',
  rejected: 'rejected',
  canceled: 'canceled',
};

/** Every status an invitation can carry, in the order the screens list them. */
export const AUTH_INVITATION_STATUSES: readonly AuthInvitationStatus[] =
  Object.values(STATUS_MEMBERS);

/** Membership test backing the guard. `Set` so the check stays O(1) per row. */
const STATUS_LOOKUP: ReadonlySet<string> = new Set<string>(AUTH_INVITATION_STATUSES);

/**
 * Narrow an unvalidated wire value onto the closed status set.
 *
 * The ONE place a `string` may become an `AuthInvitationStatus`. Everything
 * downstream reads the narrowed type and therefore needs no fallback arm — which
 * is the whole point: a tolerant consumer is where an unexpected value hides.
 */
export function isAuthInvitationStatus(value: unknown): value is AuthInvitationStatus {
  return typeof value === 'string' && STATUS_LOOKUP.has(value);
}
