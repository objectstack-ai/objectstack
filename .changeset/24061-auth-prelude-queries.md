---
'@objectstack/plugin-auth': patch
'@objectstack/plugin-hono-server': patch
---

Clause-②: no

perf(plugin-auth, plugin-hono-server): an authenticated request reads 8 rows in 4 round trips before its handler, down from 11 in 7, and `/auth/me/*` resolves the caller's grants once

Measured on a real engine (SQLite through `@objectstack/driver-sql`), for a signed-in user whose session has an active organization:

| before the handler | before | after |
|:--|:--|:--|
| REST and dispatcher doors (`resolveAuthzContext` with the in-process session read) | 11 reads, 7 round trips | 8 reads, 4 round trips |
| `GET /auth/me/permissions`, `/auth/me/localization`, `/me/apps` | 17 reads, 9 round trips | 8 reads, 4 round trips |
| `GET /api/v1/auth/get-session` | 11 reads, 7 round trips | 10 reads, 6 round trips when it reads the signing key; 8 in 4 while the key is held |

- **An in-process session read no longer signs a JWT.** better-auth runs `/get-session`'s after-hooks for a server-side `auth.api.getSession(...)` call too, so every door that asked "who is calling" had the jwt plugin read the signing key (two `sys_jwks` round trips) and sign a `set-auth-jwt` header the caller then discarded. The hook now runs only when the call answers an HTTP request. `GET /api/v1/auth/get-session` still carries `set-auth-jwt`, signed exactly as before. A server-side caller that wants the header dispatches the request through `AuthManager.handleRequest`.
- **The session token is not read back after the session was found by it.** `sys_session.token` is withheld from ordinary reads and recovered for better-auth through a privileged read. better-auth finds the session by its token, so that read had nothing to add. It was a second round trip between the session row and the user row on every session read. A read keyed on any other column still recovers the token.
- **`/auth/me/*` and `/me/apps` resolve the grants once.** These routes resolved the caller's grants twice per request: once inside the session read (for the payload's `positions[]`) and once more for their own context. They now resolve through `resolveAuthzContext`, whose request-scoped memo serves the second resolution from the first while no write has landed in between. The memo ends with the request. The routes still admit a session only, and the session's active organization stands as before.
- **The signing key is held across requests, under two bounds.** The keyring the jwt plugin signs with is kept after a read. Any write to `sys_jwks` that passes this process's engine drops it at once, and it is never kept longer than 30 seconds, which bounds a write this process cannot see (another node minting a key). An engine without a middleware seam keeps nothing. On a host without Ed25519 the keyring is still filtered to keys the host can use.

Unchanged: the session and user every door resolves, every grant, the `/get-session` body and its renewal, every option and environment variable, and the exports. No new configuration key.
