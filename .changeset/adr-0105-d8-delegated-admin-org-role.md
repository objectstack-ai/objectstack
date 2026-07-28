---
"@objectstack/plugin-auth": minor
"@objectstack/platform-objects": minor
"@objectstack/spec": minor
"@objectstack/lint": patch
---

feat(auth): give ADR-0105 D8's scope-bounded issuance a caller — the
`delegated_admin` org role, capped so it cannot mint authority (#3697)

D8 authorizes invitation *placement* against the issuer's `adminScope`
(ADR-0090 D12), so a delegated plant admin may invite only into their own
subtree. That gate is implemented, unit-proven and reachable — but no principal
could reach it in a state where it did anything:

- better-auth grants `invitation: ["create"]` to `owner` and `admin` only
  (`memberAc` holds `invitation: []`, which every other registered role
  inherits);
- under a wall-enforcing posture, owners and admins are auto-elevated to
  `organization_admin` (`auto-org-admin-grant.ts`), which carries the wildcard
  `modifyAllRecords` that makes `isTenantAdmin()` true — and the gate
  short-circuits on tenant admins.

The two sets were disjoint. Issuance placement was bounded by the Layer 0 org
wall (real, and correct) but never by `adminScope`, so D8's motivating story —
"a plant admin invites into their own subtree without a platform admin
finishing the job" — could not happen.

**Two pieces, and they only ship together.**

**1. The role.** `delegated_admin` is now registered with the organization
plugin as `memberAc.statements` plus `invitation: ["create"]` — the one
membership grade that may reach `/organization/invite-member` without being an
org admin. Deliberately *not* `invitation: ["cancel"]`: better-auth's cancel
route checks the permission with no inviterId attribution, so it would mean
"cancel anyone's pending invitation in the org".

The role carries no ObjectStack authority by construction — `mapMembershipRole`
passes it through as a position name, and with no `sys_position_permission_set`
binding that name resolves to nothing. Role = *can reach the endpoint*;
`adminScope` = *what the endpoint permits*.

`sys_member.role` and `sys_invitation.role` each gain `delegated_admin` as a
fourth option. Those selects are **enforced on write** — better-auth's own
invitation and membership inserts are validated like any other row — so
registering the role with the org plugin without listing it in both would have
produced a role nobody could hold and nobody could hand out
(`ValidationError: role must be one of: owner, admin, member`). That is exactly
how the end-to-end regression caught it, twice; neither unit test could. The
three non-English translation bundles carry the English label for the new option
until localized.

**2. The role cap**, in the framework's own `beforeCreateInvitation` hook,
beside the D8 placement gate. Registering the role alone would have been a
four-step privilege escalation: better-auth's only role-level cap on *what role
you may invite someone as* is its `creatorRole` check (default `owner`), which
blocks inviting an **owner** but not an **admin** — and an accepted `admin`
membership is auto-elevated to `organization_admin` → `isTenantAdmin()`. A
subtree-scoped delegate could have manufactured a tenant admin, with every
existing defense off the path (`sys_member` is not a `GOVERNED_OBJECT`, and the
acceptance-time membership write runs under better-auth's context, not the
issuer's).

The cap refuses an invitation whose role outranks the issuer's own, and
restricts a below-admin issuer to plain `member` — not merely "not admin/owner",
because an app-registered role projects into `current_user.positions` and may be
bound to permission sets, making it a capability channel too. A delegate's
channel for capability is the invitation's *placement* intent, which the D12
gate allowlists position-by-position. The cap applies to every invitation,
placement-carrying or not (the escalation is independent of placement), and
fails closed: an issuer role that cannot be resolved confers nothing above a
plain member.

**What changes for deployments.** One new class of principal exists: members
holding the `delegated_admin` org role, who can invite into the org — as
`member` only, into the subtree their `adminScope` allows. It is opt-in twice
over (someone must set the membership role *and* grant an adminScope set), so a
default deployment changes not at all. Org owners and admins are unaffected.

Also exported: `MEMBERSHIP_ROLE_DELEGATED_ADMIN` from `@objectstack/spec`, so
console and control-plane surfaces name the role from one place.
