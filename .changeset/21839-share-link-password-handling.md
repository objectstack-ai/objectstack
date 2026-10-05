---
'@objectstack/plugin-sharing': patch
---

Share-link passwords follow the platform's credential rules (#21839).

- **The stored hash never leaves the server.** The share-link mint response (`POST /api/v1/share-links`, and `ShareLinkService.createLink`'s return value) no longer carries `password_hash`. The list and the redemption result are projected the same way. A client that reads a link's password state keeps reading it from the redemption route's `NEEDS_PASSWORD` answer, as before.
- **The stored form is the platform's slow password hash.** New passwords are hashed with scrypt at the parameters account passwords use, instead of one salted SHA-256. Links minted before this release keep working: a stored password in a legacy form still verifies, and it is re-hashed into the new form on its first successful redemption. Every comparison is constant-time. A deployment that injects its own `hashPassword` / `verifyPassword` pair is unaffected, and its stored forms are left alone.
- **The password travels in a header.** Both public share-link routes (`GET /api/v1/share-links/:token/resolve` and `/:token/messages`) accept the `x-share-password` request header, the preferred form, because a header is not part of the request URL. The `?password=` query parameter is still accepted for compatibility, so current consoles keep working until they move to the header. `/messages` accepted only the query parameter on this mount before.
