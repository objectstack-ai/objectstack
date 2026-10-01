---
'@objectstack/spec': minor
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': patch
---

feat(spec): discovery reports which optional `/auth` route families are mounted, starting with the better-auth admin family (`authFamilies.admin`) (#21046)

Clause-②: yes

**New key.** `DiscoverySchema` declares an optional `authFamilies` block, `{ admin: boolean }`. `admin` says whether the better-auth admin family (`{routes.auth}/admin/*`: `list-users`, `set-role`, `update-user`, `ban-user`, …) is mounted on this deployment. On a deployment that does not enable the admin plugin those routes answer a plain `404`, the same as a mistyped path, so a caller checks `authFamilies.admin` before building a URL into the family. `@objectstack/spec/api` also exports the block's schema (`AuthFamiliesSchema`, type `AuthFamilies`) and its reader, `readAuthFamilies(authService)`.

**Same answer as `/auth/config`.** The value is the auth service's own `getPublicConfig().features.admin`, the object `GET /api/v1/auth/config` serves. Both discovery producers read it through `readAuthFamilies`: `getDiscovery()` in `@objectstack/metadata-protocol` (served by `@objectstack/rest` at `GET /api/v1/discovery`) and `getDiscoveryInfo()` in `@objectstack/runtime` (served at `GET /.well-known/objectstack`). Neither re-derives whether the admin plugin is on, so on one boot the two documents and `/auth/config` agree. On a stock boot `authFamilies.admin` is `false`. With the admin plugin on (`plugins.admin: true`, or SCIM, which forces it on) it is `true`.

**When the key is absent.** A producer that cannot read the answer emits no `authFamilies`, rather than a guessed `false`. That happens when no `auth` service is registered (then `routes.auth` is absent too), when the registered service has no `getPublicConfig()`, or when that call throws (`/auth/config` answers `500 AUTH_CONFIG_ERROR` in that state). Treat an absent block as "not known to be mounted".

**What did not change.** No existing key, route or status moved. The unmounted admin routes still answer a plain `404`.
