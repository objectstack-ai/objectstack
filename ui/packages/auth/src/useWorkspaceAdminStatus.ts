/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useAuth } from './useAuth.js';

/**
 * The vocabulary of the two SCALAR legs — a membership row's `role` (leg 1)
 * and the stored `user.role` (leg 2).
 *
 * Both are single values written by a path the tenant does not control: leg 1
 * is better-auth's `sys_member.role`, capped at the issuer's own grade on
 * every issuance path; leg 2 is `sys_user.role`, which framework ADR-0092 D2's
 * identity write guard refuses under a user context. A name found in either is
 * therefore evidence.
 *
 * ⛔ This set is NOT the vocabulary for `user.positions[]` — see
 * {@link ADMIN_POSITION_NAMES} for the narrower one that leg 3b uses, and the
 * hook's docblock for why the two had to be separated (objectui#8291).
 */
const ADMIN_ROLES = new Set([
  'owner',
  'admin',
  'super_admin',
  'superadmin',
  'platform_admin',
  'system_admin',
  // ADR-0068 canonical names. `mapMembershipRole` normalizes raw better-auth
  // owner/admin to org_owner/org_admin before they reach a session payload, so
  // a membership role can arrive here in either spelling depending on which
  // surface produced it. Accept both so admin detection survives the removal
  // of the `user.role = 'admin'` overwrite footgun.
  'org_owner',
  'org_admin',
]);

/**
 * The vocabulary of leg 3b — the only names honoured when found in
 * `user.positions[]`.
 *
 * Deliberately NOT {@link ADMIN_ROLES}. `positions[]` is a tenant-WRITABLE
 * array (see the hook's docblock), so the question for each name is not "does
 * it sound like an admin" but "does a trusted server derivation ever put it
 * here". Decided name by name in objectui#8291:
 *
 *  - `org_owner`, `org_admin` — KEPT. `resolveUserAuthzGrants` emits exactly
 *    these from the ACTIVE organization's `sys_member.role` through
 *    `mapMembershipRole`, so a hit is usually the real membership row arriving
 *    ahead of leg 1. A `sys_user_position` row CAN also spell them, but that
 *    row is written by a caller who already holds tenant-administration
 *    authority over the same organization (framework `DelegatedAdminGate`), so
 *    what they mint is a second spelling of an authority they have — not a
 *    crossing of any boundary. This is also the framework's own line: its
 *    four-site sweep left every TENANT_ADMIN arm untouched and moved only the
 *    platform ones.
 *  - `platform_admin` — DROPPED, and replaced by leg 3a. It is the name a
 *    tenant can mint to claim authority it does not have, and the array cannot
 *    tell a minted one from a genuine one: `resolveUserAuthzGrants` pushes the
 *    built-in name only when it is not already present, so both cases produce
 *    a byte-identical array.
 *  - `owner`, `admin`, `super_admin`, `superadmin`, `system_admin` — DROPPED.
 *    No server derivation emits any of them into `positions[]` at all: the
 *    membership leg normalizes `owner`/`admin` to `org_*` first, and the other
 *    three are not built-in identity names in any framework vocabulary. A hit
 *    on one could therefore ONLY be a `sys_user_position` row — all exposure,
 *    no signal. They stay in {@link ADMIN_ROLES}, where they are the raw
 *    scalars legs 1 and 2 legitimately read.
 */
const ADMIN_POSITION_NAMES = new Set([
  'org_owner',
  'org_admin',
]);

/**
 * One name from either SCALAR source — a membership role or the stored
 * `user.role` scalar. The two draw on one vocabulary by design (ADR-0068 D2
 * maps a membership `owner`/`admin` onto the canonical `org_owner`/`org_admin`
 * that {@link ADMIN_ROLES} also carries), so one predicate serves both.
 */
function isAdminRole(role: unknown): boolean {
  return typeof role === 'string' && ADMIN_ROLES.has(role.toLowerCase());
}

/** One entry of `user.positions[]`, judged against the narrower vocabulary. */
function isAdminPosition(position: unknown): boolean {
  return typeof position === 'string' && ADMIN_POSITION_NAMES.has(position.toLowerCase());
}

/**
 * The workspace-admin verdict AND whether it is worth acting on yet.
 *
 * These are two different facts and they were one boolean until objectui#5619.
 * See {@link useWorkspaceAdminStatus} for why collapsing them was a defect.
 */
export interface WorkspaceAdminStatus {
  /**
   * True only when adminship is CONFIRMED by one of the legs below.
   * While `isResolved` is false this is `false` because nothing has said
   * otherwise yet — NOT because the viewer is known not to be an admin.
   */
  isAdmin: boolean;
  /**
   * Whether every input `isAdmin` depends on has arrived. Gate any branch
   * whose wrong side is expensive — a refusal screen, a `<Navigate>`, a nav
   * entry that would have to be added back — on this being true.
   */
  isResolved: boolean;
}

/**
 * Whether the current user has owner/admin privileges, and whether that answer
 * has finished resolving.
 *
 * Sources considered (any one is sufficient):
 *  - LEG 1 — the active organization member row (multi-tenant mode).
 *  - LEG 2 — the top-level `user.role` scalar from the session: legacy
 *    deployments that still store an admin role on the user row.
 *  - LEG 3a — `user.isPlatformAdmin` from the session: the server's ADR-0095
 *    posture RUNG, and the ONLY leg that sees a platform administrator whose
 *    adminship comes from the `admin_full_access` permission set. On a
 *    single-tenant deployment there is no member row to read (leg 1) and the
 *    server deliberately no longer overwrites `user.role` (leg 2), so this
 *    flag is the whole signal for that viewer. Measured on a live protocol-17
 *    server in objectui#5389 — the captured payload there carries
 *    `isPlatformAdmin: true` — and pinned by
 *    `__tests__/workspaceAdminPositions-5389.test.tsx`.
 *  - LEG 3b — `user.positions[]` from the session, judged against
 *    {@link ADMIN_POSITION_NAMES} rather than {@link ADMIN_ROLES}: the
 *    canonical TENANT-scoped identity names the server derives from the active
 *    organization's membership row (ADR-0068 D1/D2, renamed from `roles` by
 *    ADR-0090 D3). This is what lets a tenant administrator resolve on the
 *    first frame instead of waiting for leg 1 (see the objectui#5619 section
 *    below).
 *
 * ## Why 3a and 3b are two legs and not one (objectui#8291)
 *
 * This docblock used to argue the opposite, and a future reader who finds that
 * argument standing will re-introduce the defect it now describes. It said:
 * do not read `user.isPlatformAdmin` alongside `positions`, because the server
 * computes the flag as `'platform_admin' in positions` from the same
 * expression, so reading both would be two spellings for one fact with no way
 * to disagree usefully and every way to drift.
 *
 * **That was true and it is now false.** Framework objectstack#15948 (a
 * declared BREAKING change) redefined what `positions[]` IS. It used to be the
 * `sys_user.role` scalar split on commas; it is now built by
 * `resolveUserAuthzGrants` and carries ADR-0057 D4 `sys_user_position`
 * assignments. That table is `apiEnabled` and its `position` values are
 * unconstrained, so a caller holding tenant-administration authority can mint
 * a row spelling `platform_admin` for one of their own users — and the name
 * lands on `positions[]` verbatim.
 *
 * The two therefore no longer say one thing:
 *
 *  - `isPlatformAdmin` is `grants.posture === 'PLATFORM_ADMIN'` — derived from
 *    an UNSCOPED `admin_full_access` grant (or a verified email on the
 *    deployment's declared administrator list) and from nothing else. It is
 *    byte-for-byte what the server's own `hasPlatformAdminStanding` returns.
 *  - `positions[]` is the security AXIS, which is a wider thing: it is the set
 *    of names a request resolves to, including names a tenant wrote.
 *
 * They can now disagree, and when they do **the rung is right** — enforcement
 * agrees with the rung, so the array's extra name buys nothing except a
 * Console that paints platform-administrator surfaces at a principal every
 * underlying call refuses. `resolve-authz-context.ts` states the rule at
 * `hasPlatformAdminStanding`: read the RUNG, never
 * `positions.includes('platform_admin')`. The framework moved four server-side
 * sites onto it (`plugin-sharing`, `plugin-approvals`, `plugin-security`,
 * `runtime`); this hook is the same read on the client side of the wire.
 *
 * ⛔ So: never put `platform_admin` back into {@link ADMIN_POSITION_NAMES},
 * and never widen leg 3b back to {@link ADMIN_ROLES}. The name is not the
 * authority. Every server that publishes `positions` publishes
 * `isPlatformAdmin` beside it — `customSession` returns them in one object
 * literal — so nothing is lost by reading the narrow one.
 *
 * `positions` also remains the ONE published spelling of the array itself. It
 * is deliberately not read alongside the retired `roles` (ADR-0090 D3 renamed
 * with no deprecation window and bans resurrecting the old name as a
 * fallback).
 *
 * In preview-mode / no-auth-enabled mode the provider seeds an admin user
 * (`role: 'admin'`, which leg 2 reads), so this returns `isAdmin: true` for
 * dev/demo setups.
 *
 * ## Why this returns a pair and not a boolean (objectui#5619)
 *
 * It used to return a bare `boolean`, which gave "not resolved yet" and
 * "resolved: not an admin" the same answer — `false`. Leg 1 is not settled
 * when a console page first mounts: `AuthProvider.refreshActiveMember` runs
 * from its own effect, keyed on `activeOrganization`, which itself appears
 * only after `listOrganizations()` → `getActiveOrganization()` (→ the ADR-0081
 * single-membership `setActiveOrganization()` repair) resolve. So an
 * administrator whose adminship lives ONLY in the member row rendered at least
 * once as a non-admin, and every gate downstream acted on it: two marketplace
 * surfaces painted `MarketplaceAccessDenied` at a real administrator, the
 * console chrome dropped and re-added a nav entry, and `AppContent` fired a
 * `<Navigate to="/home" replace>` that the later flip cannot undo.
 *
 * Legs 2 and 3b DO cover that viewer whenever the session was minted with an
 * active organization stamped on it — framework `auth-manager.ts` reads
 * `session.activeOrganizationId` and, when it is set, maps the member row into
 * `positions[]` as `org_owner`/`org_admin`. Those two names are exactly why
 * objectui#8291 kept leg 3b alive rather than deleting the array read
 * outright. The window is therefore not "every tenant admin" as first
 * reported, but "every session that reaches the console without that stamp",
 * which is exactly the path `refreshOrganizations`' ADR-0081 repair exists to
 * serve.
 *
 * `isResolved` is deliberately true the moment `isAdmin` is true: a confirmed
 * admin is a final answer, and the legs still in flight can only agree with it.
 * Callers therefore never wait on a verdict they already have — an admin
 * detected through the rung or through `positions` pays nothing for this gate.
 */
export function useWorkspaceAdminStatus(): WorkspaceAdminStatus {
  const { activeMember, user, isLoading, isMembershipResolved } = useAuth();

  const positions = user?.positions;
  const isAdmin =
    isAdminRole(activeMember?.role) ||
    isAdminRole(user?.role) ||
    // Leg 3a — `=== true` on purpose. A session that never published the flag
    // must read as "no platform standing", not as a truthy unknown.
    user?.isPlatformAdmin === true ||
    (Array.isArray(positions) && positions.some(isAdminPosition));

  if (isAdmin) return { isAdmin: true, isResolved: true };

  // Legs 2, 3a and 3b are settled once the session has landed (`isLoading`);
  // leg 1 is settled once the organization/member pipeline has reached a
  // terminal state (`isMembershipResolved`). Both, because a viewer can be an
  // admin through either.
  return { isAdmin: false, isResolved: !isLoading && isMembershipResolved };
}
