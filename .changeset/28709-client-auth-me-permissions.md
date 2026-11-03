---
"@objectstack/client": patch
---

feat(client): `client.auth.mePermissions()` reads the caller's effective permissions, typed `MePermissionsResponse`

Clause-②: yes (widening) — one new SDK method over an existing route; no wire change and no new route.

Metadata-protocol: none

- **Before.** `GET /auth/me/permissions` had a strict response contract in `@objectstack/spec/api` (`MePermissionsResponseSchema`) but no client method, so a consumer fetched the route by hand and typed the body itself.
- **Now.** `client.auth.mePermissions()` GETs `/api/v1/auth/me/permissions` and resolves `MePermissionsResponse`. Discriminate on `authenticated`: a signed-out caller resolves `{ authenticated: false }` instead of throwing, unlike `client.auth.me()`.
