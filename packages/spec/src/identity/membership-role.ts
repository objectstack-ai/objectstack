// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Organization membership roles — a CLOSED, framework-owned vocabulary (#3723).
 *
 * `sys_member.role` answers **"what is your standing in this organization"**.
 * It does not answer "what may you do" — that is what positions are for.
 *
 * ## Why the list is closed
 *
 * [ADR-0090 D3] "role" is a reserved-forbidden word in this system, with a
 * single documented exception: `sys_member.role` is better-auth's own schema,
 * which we do not own. It survives *as a third-party column*, projected as
 * `org_membership_level`, and its naming commandment is explicit —
 * **capability = `permission_set` · distribution = `position` · hierarchy =
 * `business_unit` · collaboration = `team`.** Distribution is a position, so a
 * membership role is not a distribution channel.
 *
 * [ADR-0095 D3] No enforcement-time code path may consult the better-auth role
 * directly. `mapMembershipRole` normalizes the four names below into their
 * canonical built-in identities at PROVISIONING time (`resolve-authz-context`),
 * which is a grant-provisioning concern, not an authorization input.
 *
 * [ADR-0057 D4, carried forward] App-declared names were once fed to
 * better-auth's `additionalOrgRoles` so invitations naming them would not be
 * rejected — "**never as the authority for RBAC**". That qualifier was the
 * whole point, and it did not hold: whatever string lands in `sys_member.role`
 * is projected into `current_user.positions`, so an app role stored here WAS
 * capability, granted with none of ADR-0090 D12's controls (no `granted_by`,
 * no validity window, no subtree or allowlist check). #3747 made those names
 * storable and #3779 auto-derived them in every host; ADR-0108 retires the
 * channel and this list is closed again.
 *
 * ## What replaced it
 *
 * An app that wants `sales_rep` declares a **`position`** and assigns it
 * through `sys_user_position` — the governed path, with the full ADR-0090 D12
 * apparatus. At admission time the one-step flow is an **invitation carrying
 * placement** (ADR-0105 D8): `business_unit_id` + `positions`, authorized
 * against the issuer's `adminScope` by dry-running `DelegatedAdminGate`, and
 * applied on acceptance. That path is strictly more capable than the retired
 * one — a delegated admin may use it, where the membership role was
 * admin-only.
 *
 * ## Three facts that look like one — do not merge them
 *
 * A future reader will be tempted to "unify the role lists". Only the first of
 * these is a list; the other two are rules that belong near what they govern:
 *
 *  1. **what names exist** — this module, the one source;
 *  2. **which names mean administrative authority** — `orgRoleGrade`
 *     (invitation cap) and `auto-org-admin-grant.ts`;
 *  3. **how a name projects into an identity** — `mapMembershipRole`.
 *
 * Naming lives in `@objectstack/spec` rather than in plugin-auth because the
 * platform objects (`@objectstack/platform-objects`) need the options too, and
 * they must not depend on the auth plugin.
 */

/** better-auth's built-in organization roles. */
export const MEMBERSHIP_ROLE_OWNER = 'owner';
export const MEMBERSHIP_ROLE_ADMIN = 'admin';
export const MEMBERSHIP_ROLE_MEMBER = 'member';

/**
 * [ADR-0105 D8 / #3697] The better-auth organization role that makes the
 * scope-bounded issuance path REACHABLE.
 *
 * D8 authorizes invitation *placement* against the issuer's `adminScope`
 * (ADR-0090 D12) — but better-auth grants `invitation: ["create"]` to `owner`
 * and `admin` only, and under a wall-enforcing posture those two are
 * auto-elevated to tenant admins (`auto-org-admin-grant.ts`), for whom the
 * scope gate narrows nothing. The two sets were disjoint: the gate had no
 * caller. This role is the missing one — a membership grade that may reach
 * `/organization/invite-member` **without** being an org admin.
 *
 * It carries NO ObjectStack authority by construction: `mapMembershipRole`
 * passes it through as a position name, and with no
 * `sys_position_permission_set` binding that name resolves to nothing.
 * Reaching the endpoint is not authority to place — placement authority comes
 * solely from a separately-granted `adminScope`. Role = *can reach the
 * endpoint*; adminScope = *what the endpoint permits*.
 *
 * Doubly opt-in, so a default deployment changes not at all: someone must set
 * the membership role AND grant an adminScope set.
 *
 * This is the shape EVERY membership role must have (ADR-0108): a grade that
 * decides what you can reach, never a bundle of what you may do.
 */
export const MEMBERSHIP_ROLE_DELEGATED_ADMIN = 'delegated_admin';

/**
 * The membership roles — the WHOLE vocabulary, in display order (ADR-0108).
 *
 * Not "the built-ins, plus whatever an app adds": there is no second source.
 * A stack that needs another business role declares a `position`; see the
 * module doc for the migration.
 */
export const BUILTIN_MEMBERSHIP_ROLES = [
  MEMBERSHIP_ROLE_OWNER,
  MEMBERSHIP_ROLE_ADMIN,
  MEMBERSHIP_ROLE_DELEGATED_ADMIN,
  MEMBERSHIP_ROLE_MEMBER,
] as const;

export type BuiltinMembershipRole = (typeof BUILTIN_MEMBERSHIP_ROLES)[number];

/**
 * `select` options for `sys_invitation.role` and `sys_member.role` — the
 * complete option list both objects declare statically.
 *
 * Nothing widens these at boot any more (ADR-0108). The closed list IS the
 * feature: it is the write-side guardrail that makes an ungoverned capability
 * grant unrepresentable, and it is the picker's vocabulary.
 */
export const BUILTIN_MEMBERSHIP_ROLE_OPTIONS: readonly Readonly<{ label: string; value: string }>[] = [
  { label: 'Owner', value: MEMBERSHIP_ROLE_OWNER },
  { label: 'Admin', value: MEMBERSHIP_ROLE_ADMIN },
  { label: 'Delegated Admin', value: MEMBERSHIP_ROLE_DELEGATED_ADMIN },
  { label: 'Member', value: MEMBERSHIP_ROLE_MEMBER },
] as const;
