---
'@objectstack/spec': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/plugin-sharing': patch
---

feat(spec): a strict response contract for `GET /auth/me/permissions`, and `hasAnyQueue` on the ownership-queue contract

Clause-②: yes
Metadata-protocol: none

`GET /auth/me/permissions` is the payload the console reads once per session for its whole permission layer. Until now nothing in `@objectstack/spec` declared its body. It is now declared, strictly:

- **`MePermissionsResponseSchema`** (`@objectstack/spec/api`), discriminated by `authenticated`:
  - `MePermissionsAnonymousResponseSchema`: `{ authenticated: false }` and nothing else.
  - `MePermissionsAuthenticatedResponseSchema`: `userId`, `tenantId` (nullable), `positions`, `permissionSets`, `objects` (effective object permissions), `fields` (`{ readable, editable }` per `object.field`), `systemPermissions` and `tabPermissions` (optional: absent only on the body a server without SecurityPlugin answers, where absent means unknown), and `hasAnyQueue: boolean`.
  - Both branches are strict: an undeclared key is refused, not dropped. A key the server starts sending is declared here first.
  - Types `MePermissionsResponse`, `MePermissionsAnonymousResponse`, `MePermissionsAuthenticatedResponse`.
- **`IOwnershipQueueService.hasAnyQueue(organizationId)`** (`@objectstack/spec/contracts`): does the organization have at least one ownership queue, `true` exactly when some name would resolve through `resolveQueue`. `@objectstack/plugin-sharing`'s `OwnershipQueueService` implements it.
- **`@objectstack/plugin-hono-server`** types the route's body builder against `MePermissionsAuthenticatedResponse`, and reads `hasAnyQueue` through the contract. The wire is unchanged.
