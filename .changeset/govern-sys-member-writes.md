---
"@objectstack/plugin-security": patch
---

fix(security): govern `sys_member` writes — organization membership is not a delegable capability (#3697 follow-up)

`DelegatedAdminGate`'s `GOVERNED_OBJECTS` covered the four RBAC link tables but
not `sys_member`, so the table that decides *who is an org admin* was the one
authority surface the delegated-administration gate never saw.

That matters because a membership row is an authority dial: `role` containing
`owner`/`admin` is auto-elevated to `organization_admin` by
`auto-org-admin-grant.ts`, and that set's wildcard `modifyAllRecords` is exactly
what `isTenantAdmin()` tests. Writing one mints a tenant admin — the same
escalation the invitation role cap closes on the issuance path, one layer down
at the table.

**Not exploitable today, and this changes no working behaviour.** Every
`sys_member` writer is a better-auth path running under `isSystem`, which
short-circuits the whole security middleware before this gate; the ADR-0092 D2
identity write guard refuses user-context writes to better-auth-managed tables
upstream of it. The gate is added so the chain cannot silently reopen the day a
direct-write surface is introduced — a `case` label is not enforcement, and the
call site is what decides (AGENTS.md Prime Directive #10).

The rule is tenant-admin-only rather than scope-delegable, deliberately: no axis
of `AdminScope` expresses "organization membership" (its vocabulary is BU
subtree, action flags and an assignable-set allowlist), so there is nothing for
a delegated scope to approve part of — and a delegate who could write one would
mint authority strictly greater than their own, which is what ADR-0090 D12
exists to prevent. Adding people to an organization already has a delegable
path: the **invitation**, whose placement is authorized against the issuer's
`adminScope` and whose role is capped at the issuer's own grade. The refusal
message says so.
