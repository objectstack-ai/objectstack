---
'@objectstack/spec': patch
---

feat(spec): declare the optional `ISecurityService.describeEffectiveAccess` and its `EffectiveAccess` answer types

Clause-②: yes (widening)
Metadata-protocol: none

`@objectstack/spec/contracts` gains three exported types and one optional member of the `security` service contract, beside `DelegableScope` / `describeDelegableScope`:

- `EffectivePermissionSetOrigin`: how a permission set reaches a user, one of `{ kind: 'default' }` (a binding to the `everyone` audience anchor, or the human baseline the resolution adds), `{ kind: 'position'; position }` (a held position's definition names the set) and `{ kind: 'direct' }` (a `sys_user_permission_set` grant row of the user's).
- `EffectivePermissionSet`: `{ name, origins }`, at least one origin; a set reached two ways is listed once with both.
- `EffectiveAccess`: `{ userId, organizationId, positions, permissionSets }`, the sets in resolution order, in the caller's organization.
- `ISecurityService.describeEffectiveAccess?(userId, callerContext?)`: describe a user's effective permission sets and where each comes from, resolved by the resolver enforcement uses, gated as `explain` is (`manage_users`, organization administration of an organization the user belongs to, or a delegated `adminScope` covering the user), with an unknown user refused exactly as one the caller may not manage. Optional: a security service that predates it omits it, and callers feature-detect and answer that the read is not served.

A TypeScript contract only: no schema, authorable key or runtime answer changes here. The reference implementation and its REST door land separately.
