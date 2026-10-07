---
"@objectstack/types": minor
"@objectstack/plugin-sharing": minor
"@objectstack/runtime": minor
"@objectstack/plugin-hono-server": minor
"@objectstack/hono": minor
---

feat(sharing): a share-link password can be sent in the `X-Share-Password` header whatever its characters, under a declared encoding (`X-Share-Password-Encoding: utf-8`)

Clause-②: yes (widening)

- **What was missing.** A browser cannot put a character above U+00FF in a request header (`Headers` throws a `TypeError` before the request leaves), and it strips leading and trailing spaces. `createLink` accepts any password, so a link whose password has a CJK character or an emoji could not be opened through the header.
- **What is now accepted.** A new companion request header, `X-Share-Password-Encoding`, declares how `X-Share-Password` is encoded. Its one value is `utf-8`, compared case-insensitively. Under it, `X-Share-Password` carries the password's UTF-8 bytes percent-encoded, as `encodeURIComponent(password)` produces them, and both public routes (`GET /api/v1/share-links/:token/resolve` and `/:token/messages`) decode it on both mounts: the sharing plugin's routes and the runtime dispatcher's `/share-links` domain. Both read the pair through one helper, `readSharePasswordHeader`, exported from `@objectstack/types` with the header-name constants.
- **Unchanged.** Without `X-Share-Password-Encoding`, `X-Share-Password` is read raw, exactly as before, so every value a client sends today resolves as it did. That includes a Latin-1 password and a raw password containing `%`; the server never percent-decodes a value nobody declared encoded. The `?password=` query parameter is still read first, and when it is present the header pair is not read.
- **What is refused.** `X-Share-Password-Encoding` naming any other value, or a password header that is not percent-encoded UTF-8 under `utf-8` (a `%` without two hex digits, octets that are not well-formed UTF-8, a character outside visible ASCII), answers `400 VALIDATION_FAILED` before the token is looked up. It is never compared raw instead. The message names the headers and the rule, never the presented value.
- **Response headers.** Both public routes now answer `Vary: X-Share-Password, X-Share-Password-Encoding`, still beside `Cache-Control: no-store`.
- **Cross-origin clients.** `X-Share-Password-Encoding` is in the default CORS preflight allow-list (`DEFAULT_CORS_ALLOW_HEADERS` in `@objectstack/plugin-hono-server`, which the `@objectstack/hono` adapter also applies). A deployment that passes its own `allowHeaders` must add `X-Share-Password-Encoding` beside `X-Share-Password` to let a cross-origin client send an encoded password.
