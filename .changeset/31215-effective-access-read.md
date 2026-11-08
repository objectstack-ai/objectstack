---
'@objectstack/core': patch
'@objectstack/plugin-security': patch
'@objectstack/rest': patch
'@objectstack/client': patch
---

feat(security): read one user's effective permission sets, each with where it comes from

Clause-②: yes
Metadata-protocol: none

A user page could list only the permission sets stored as that user's own grant rows. Sets that arrive through the `everyone` default binding or through a held position were never rows, so a user who holds plenty of access through defaults and positions showed none. Now one read lists them all, each with its origins.

- **`GET /api/v1/security/users/:id/effective-access`** (`@objectstack/rest`, beside `security/explain`) answers the spec's `EffectiveAccess`: the user, the organization it was resolved in, the positions held there, and the permission sets in force, each listed once with every origin it arrives through (`direct`, `position` with the position's name, `default`, or `derived` with its standing). It takes no query parameter: one is refused `400 VALIDATION_ERROR` naming it. A deployment whose security service does not serve the read answers `501`.
- **Who may read whom is explain's caller gate**, now one function both reads call (`mayDescribeAnotherUser` in `@objectstack/plugin-security`): your own access always; someone else's with `manage_users`, as the organization administrator of an organization they belong to, or with a delegated `adminScope` covering them. An id no user has is refused with the same `403 PERMISSION_DENIED`, word for word, as a user you may not manage, for every caller. This is where the read differs from `security/explain`, which answers an admitted caller `404` for an unknown id.
- **`ISecurityService.describeEffectiveAccess`** is served by `@objectstack/plugin-security`. The origins come from the resolver itself: `resolveUserAuthzGrants` (`@objectstack/core`) takes a new `withPermissionOrigins` option and returns `permissionOrigins`, recorded where each name is derived. Asking for it is a fresh resolution, like explain's. A resolution that does not ask returns the same envelope as before, from the same reads.
- **`client.security.describeEffectiveAccess(userId)`** (`@objectstack/client`) returns `EffectiveAccess`.
