---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: admin create-user refuses a password outside the deployment's length range, as set-user-password does

`POST /api/v1/auth/admin/create-user` saved an explicit password of any length up to the maximum: better-auth's own `createUser` checks only `maxPasswordLength`, never `minPasswordLength`. An administrator could create a user with a 1-character password and `mustChangePassword: false`, and the user signed in with it, while `POST /api/v1/auth/admin/set-user-password` and the user's own change-password refuse the same value. Both admin doors now resolve a password through one check of the deployment's `minPasswordLength` / `maxPasswordLength` (the `auth.password_min_length` / `password_max_length` settings, ADR-0069):

- **An explicit password outside the range** is refused with `400 INVALID_REQUEST`, "Password must be at least N characters" (or "at most N"), the answer set-user-password already gave. No new error code. The refusal comes before anything is written: no account, no membership, no permission-set grant, no audit row.
- **A generated password** (`generatePassword: true` with no password typed) is 16 characters, raised to the minimum when the minimum is above 16 and capped at the maximum when the maximum is below 16. Before, it was always 16, so on a deployment with a minimum above 16, set-user-password refused the password it had just generated, and create-user saved it below the minimum.

A password inside the range is applied exactly as before.

Clause-②: no (narrowing) — admin create-user refuses one request shape it used to run: an explicit `password` shorter than the deployment's `minPasswordLength` (one longer than `maxPasswordLength` was already refused by better-auth, now with set-user-password's code). Nothing is widened.

Metadata-protocol: none (an admin REST door's handling of a request body; nothing a metadata author writes changes)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is how the admin create-user door handles a request body's explicit password: a value outside the deployment's configured length range is refused, as the set-user-password door already refused it. The remedy is a request edit (send a password inside the range, or `generatePassword: true`), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a caller that created users with passwords shorter than the deployment's minimum, or that matched the error code of a too-long one.

- **Before.** `POST /api/v1/auth/admin/create-user` with `password: 'a'` answered `200` and saved the password. A password longer than `maxPasswordLength` answered `400 PASSWORD_TOO_LONG`.
- **Now.** The short one answers `400 INVALID_REQUEST`, "Password must be at least 8 characters" (the deployment's minimum), and creates no user. The too-long one answers `400 INVALID_REQUEST`, "Password must be at most 128 characters" (the deployment's maximum), set-user-password's answer.
- **Fix.** Send a password inside the deployment's `minPasswordLength` / `maxPasswordLength` range, or send `generatePassword: true` and hand the user the returned temporary password. A client that matched `PASSWORD_TOO_LONG` on this door matches `INVALID_REQUEST` instead.
