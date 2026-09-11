---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): build ONE better-auth instance per boot, so the RFC 8707 resource row is seeded once (#17176)

`AuthManager.getOrCreateAuth()` assigned its `this.auth` memo only after `createAuthInstance()` had resolved, and that function awaits a dynamic `import('better-auth')`, the plugin list, the password hasher and finally better-auth's own `$context`. Every caller arriving inside that window read `this.auth === null` and started its own build, so overlapping callers constructed one better-auth instance each — measured: three concurrent `getAuthInstance()` calls returned three distinct instances.

The boot has such callers. `AuthPlugin` dispatches `registerOidcDiscoveryRoutes()` with `void` from its route-mounting `kernel:ready` hook, which returns while that call is still pending, and a later `kernel:ready` hook reads the instantiated social providers off the instance for the account-issuer backfill.

Each duplicate instance re-runs every better-auth plugin's `init`, and `@better-auth/oauth-provider` seeds the RFC 8707 `sys_oauth_resource` row from there. Its seed is already check-then-insert — `findOne` by `identifier`, then `create` only on a miss — so on a warm database every instance finds the row and inserts nothing. On a FRESH one all of them miss together, all of them insert, and the unique index refuses all but the first: the `Insert operation failed {object: sys_oauth_resource}` line on the first boot of a fresh project.

`getOrCreateAuth()` now holds the in-flight build so concurrent callers share it. The seed runs once per process on every driver, because there is only one plugin `init` to run it. Two consequences of the new in-flight slot: `setRuntimeBaseUrl()` now reports "already created" for a build in flight (it silently no-opped before), and `applyConfigPatch()` discards a build composed from the pre-patch configuration instead of letting it install itself.

No log level changed, in this package or any other.
