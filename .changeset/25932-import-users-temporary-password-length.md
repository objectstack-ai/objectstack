---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: admin import-users sizes a generated temporary password to the deployment's length range, as create-user does

`POST /api/v1/auth/admin/import-users` minted every temporary password at 16 characters, whatever the deployment's `minPasswordLength` / `maxPasswordLength` (the `auth.password_min_length` / `password_max_length` settings, ADR-0069). With a minimum above 16, an imported row got a password below that minimum and the user signed in with it. With a maximum below 16, better-auth refused the 16-character password and the row failed. This covers the `temporary` policy and the `auto` policy's fallback for a row with no deliverable channel. A generated temporary password is now 16 characters, raised to the minimum when the minimum is above 16 and capped at the maximum when the maximum is below 16: the same sizing create-user's `generatePassword` uses, read from the same better-auth context. With the default range it is still 16 characters. Nothing else about the import changes.

The import reads the range once, before any row is written. If the context cannot be read, the request is refused (`500 INTERNAL_ERROR`, `import-users failed`) and no account is created, the same mapping create-user uses for the same read.

Clause-②: no (narrowing) — the exported `IdentityImportDeps` gains a required member, `getAuthContext()`, so a deps object without it no longer type-checks against `runAdminImportUsers`. No request shape is widened or refused.

Metadata-protocol: none (an admin REST door's handling of a request; nothing a metadata author writes changes)

<!-- adr-0087: not-required (runtime-interface-only packages/plugins/plugin-auth/src/admin-import-users.ts#IdentityImportDeps) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped. The one exported declaration that changes is the runtime deps interface `IdentityImportDeps`, which gains a required member; it has no Zod schema, no spec declaration and no stored form, so there is nothing for `objectstack migrate meta` to rewrite, and the compiler names every host that must supply the new member. -->

**BREAKING** for a host that calls `runAdminImportUsers` itself (the `AuthPlugin` route is already wired).

- **Before.** `IdentityImportDeps` had no auth-context member, and every temporary password was 16 characters.
- **Now.** `IdentityImportDeps.getAuthContext()` is required. It answers better-auth's `$context`, whose `password.config` holds the range. A JavaScript host that omits it has every import refused with `500 INTERNAL_ERROR` before anything is written.
- **Fix.** Pass `getAuthContext` in the deps, wired to the same reader create-user uses, for example `AuthManager.getAuthContext()`.
