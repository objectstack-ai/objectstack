---
"@objectstack/spec": minor
"@objectstack/plugin-security": minor
"@objectstack/rest": minor
"@objectstack/client": minor
---

feat(authz): expose the caller's delegable scope — the read half of the
delegated-administration gate (ADR-0090 D12 / ADR-0105 D8)

`adminScope` decided writes but could not be READ: `assignablePermissionSets`
lived only inside `delegated-admin-gate.ts`, so a UI offering "place this
person in a unit, with these positions" (the D8 scoped-invitation form) had no
way to narrow its pickers. It would list the whole tree and let the user
discover the boundary by being refused — which turns an authorization gate into
a validator and makes the boundary invisible until it bites.

`ISecurityService.describeDelegableScope(callerContext)` answers it, exposed as
`GET /api/v1/security/my-delegable-scope` and `client.security.describeDelegableScope()`:

- `placeableBusinessUnitIds` — union of the subtrees where the caller may place
  people (scopes granting `manageAssignments`);
- `assignablePositions` — positions whose every distributed permission set the
  caller may hand out (containment check included);
- `scopes` — the held `adminScope`s with subtrees resolved, for attribution;
- `isTenantAdmin` — unconstrained, with everything enumerated so a consumer
  renders ONE uniform picker instead of special-casing.

Computed by the same helpers the write gate enforces with, so an option this
reports is one `assert()` accepts — a test asserts that agreement directly. It
NARROWS; the gate still decides.

Strictly self-scoped: no target-user parameter, so it discloses nothing beyond
the authority the caller already holds (unlike `explain`, which has one and
gates it). Fail-closed — unresolvable scopes contribute nothing, a caller with
no delegated authority gets empty lists, and a deployment without
`@objectstack/plugin-security` gets 501.
