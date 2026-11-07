---
'@objectstack/spec': patch
---

feat(spec): declare the optional `ISecurityService.describeEffectiveAccess` and its `EffectiveAccess` answer types

Clause-②: yes (widening)
Metadata-protocol: none

`@objectstack/spec/contracts` gains three exported types and one optional member of the `security` service contract, beside `DelegableScope` / `describeDelegableScope`:

- `EffectivePermissionSetOrigin`: how a permission set reaches a user, one of `{ kind: 'direct' }` (a `sys_user_permission_set` grant row of the user's), `{ kind: 'position'; position }` (a held position's definition names the set, including a built-in identity position's static binding), `{ kind: 'default' }` (a binding to the `everyone` audience anchor, or the human baseline the resolution adds) and `{ kind: 'derived'; source }` (standing the resolver confers without a grant row or a position, from the closed sources `'platform_admin_config'` and `'ai_access'`).
- `EffectivePermissionSet`: `{ name, origins }`, at least one origin; a set reached two ways is listed once with both.
- `EffectiveAccess`: `{ userId, organizationId, positions, permissionSets }`, in the caller's organization; `positions` and `permissionSets` in the resolver's own order, which the contract spells out.
- `ISecurityService.describeEffectiveAccess?(userId, callerContext?)`: describe a user's effective permission sets and where each comes from, resolved by the resolver enforcement uses, gated as `explain` is (`manage_users`, organization administration of an organization the user belongs to, or a delegated `adminScope` covering the user), with an unknown user refused exactly as one the caller may not manage. Optional: a security service that predates it omits it, and callers feature-detect and answer that the read is not served.

A TypeScript contract only: no schema, authorable key or runtime answer changes here. The reference implementation and its REST door land separately.
