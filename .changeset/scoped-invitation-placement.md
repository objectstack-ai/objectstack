---
"@objectstack/platform-objects": minor
"@objectstack/plugin-auth": minor
"@objectstack/plugin-security": minor
---

feat(authz): scoped invitations — placement intent on an invitation, gated by
the issuer's adminScope and applied on acceptance (ADR-0105 D8)

An invitation may now carry PLACEMENT INTENT — the business unit the invitee
lands in and the positions they are assigned — so a delegated (plant) admin's
invitee arrives already in the right unit and role instead of waiting on a
platform admin. This closes the structural gap ADR-0105 D8 names for
`single`-posture deployments and is the natural admission path under `group`.

The two halves ship together, deliberately:

- **Issuance is authorized** against the ISSUER's `adminScope` (ADR-0090 D12),
  by dry-running the existing `DelegatedAdminGate` against the very
  `sys_user_position` rows the acceptance would write. The gate is reused
  verbatim — no second copy of the subtree/allowlist logic to drift — so an
  invitation can never place what its issuer could not have assigned directly.
  Without that gate the feature would be an escalation hole: the built-in
  `organization_admin` is deliberately read-only on the RBAC tables precisely
  so a fresh org admin cannot rebind themselves, and applying an unchecked
  invitation payload under system context would hand that authority straight
  back.
- **Acceptance applies it**, idempotently and failure-isolated: a replayed
  acceptance converges instead of duplicating assignments, and a placement
  miss never undoes a valid membership.

Surface:

- `sys_invitation` gains `business_unit_id` + `positions` (ADR-0092 extension
  fields, registered in the D7 collision-guarded whitelist; NOT generically
  editable — placement is set only at issuance, through the gate).
- `@objectstack/plugin-security` registers the `invitation-placement` service
  (`assertIssuable` / `apply`).
- `@objectstack/plugin-auth` wires better-auth's `beforeCreateInvitation` /
  `afterAcceptInvitation` to it. **Fail closed**: an invitation that requests
  placement in a deployment without the delegated-administration runtime is
  refused, never silently placed unchecked.

Existing invitations are unaffected — an invitation without placement intent
never consults the gate and behaves exactly as before.
