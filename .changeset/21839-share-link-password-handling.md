---
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/hono': patch
'@objectstack/runtime': patch
---

Share-link passwords follow the platform's credential rules (#21839).

- **The stored hash never leaves the server.** The share-link mint response (`POST /api/v1/share-links`, and `ShareLinkService.createLink`'s return value) no longer carries `password_hash`. The list and the redemption result are projected the same way. A client that reads a link's password state keeps reading it from the redemption route's `NEEDS_PASSWORD` answer, as before.
- **The stored form is the platform's slow password hash.** New passwords are hashed with scrypt at the parameters account passwords use, instead of one salted SHA-256. Links minted before this release keep working: a stored password in a legacy form still verifies, and it is re-hashed into the new form on its first successful redemption. Every comparison is constant-time. A deployment that injects its own `hashPassword` / `verifyPassword` pair is unaffected, and its stored forms are left alone.
- **The password travels in a header.** Both public share-link routes (`GET /api/v1/share-links/:token/resolve` and `/:token/messages`) accept the `x-share-password` request header, the preferred form, because a header is not part of the request URL. The `?password=` query parameter is still accepted for compatibility, so current consoles keep working until they move to the header. `/messages` accepted only the query parameter on this mount before.
- **Cross-origin clients can send the header.** `X-Share-Password` is in the default CORS preflight allow-list (`DEFAULT_CORS_ALLOW_HEADERS` in `@objectstack/plugin-hono-server`, which the `@objectstack/hono` adapter also applies). A deployment that passes its own `allowHeaders` is unchanged; add the header to that list to let a cross-origin client use it.
- **Public share-link answers are not cached.** Both public routes answer with `Cache-Control: no-store` and `Vary: X-Share-Password` on every outcome, on both mounts (the sharing plugin's routes and the runtime dispatcher's `/share-links` domain). The authenticated create, list and revoke routes are unchanged.
- **Hashing works in WebContainer.** On StackBlitz WebContainer, where `node:crypto.scrypt` is incomplete, the password is hashed with the pure-JS scrypt from `@noble/hashes` (now a dependency of `@objectstack/plugin-sharing`, as it already is of `@objectstack/plugin-auth`), at the same parameters and in the same stored form. A hash made on either runtime verifies on the other.
