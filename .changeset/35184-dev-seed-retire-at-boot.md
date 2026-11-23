---
'@objectstack/plugin-auth': patch
---

fix(auth)!: a boot outside development mode retires what the development seed issued

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is what a boot outside development mode does to the credentials the development seed's accounts were issued: no metadata, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment that serves a database `os dev` seeded. At every boot outside development mode (`NODE_ENV` is not `development`), before the server serves a request, the platform retires what each account the development seed created (its admin and the stack's `demoStaff`) was issued, while that account still has the password it was seeded with: its sessions, its API keys, the apps authorized to it and its device sign-ins, its outstanding password-reset links, any sign-in account linked to it, the OAuth applications it registered (disabled) and the SCIM credentials it minted (revoked). It is the revocation `os user set-password` performs, without setting a password, and with a host `secondaryStorage` it also ends the sessions held there.

- FROM: a session, an API key or an authorized app the seed's admin or a demo account was issued under `os dev` kept working on a server outside development mode, until an operator ran `os user set-password` on that account.
- TO: the boot retires them. A retired session's next request is unauthenticated, a retired key is refused `403 API_KEY_REVOKED`, and both carry the reason `admin_password_reset`, so only a platform administrator restores such a key. The log names each account and what was retired. When the retirement cannot complete, the boot fails with an error naming the accounts.

**Not moved.** A boot in development mode retires nothing. An account the seed did not create is never read. An account whose password was set since the seed (by `os user set-password`, by an administrator or by its own reset) holds a credential the seed did not issue and is untouched, and so is every credential it was issued after that. A database with no account the seed created costs one indexed read per boot.

The fix: set each seeded account's password with `os user set-password <email>` before serving the database outside development mode (the refusals added in the previous release already require it to sign in), then sign in and issue new keys.
