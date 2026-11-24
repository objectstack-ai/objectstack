---
'@object-ui/auth': patch
'@object-ui/console': patch
---

fix(console, auth): a cold console load sends `me/localization` once, and asks for the cookie session at parse time

Clause-②: no
Metadata-protocol: none

On a device's first visit the console sent `GET /api/v1/auth/me/localization` twice. The language seed asked before the app mounted. The localization provider asked again after its own mount, because the seed's request had already settled and requests are shared only while they are in flight. The provider's boot read now takes the seed's answer to the same request once, but only when it was an authenticated answer about the browser's current owner. A re-read after a write to the user's own row still asks the server, and so does any later mount.

With no stored Bearer (a cookie session), `get-session` was asked by `AuthProvider` only after React mounted. That mount waits on the seed's bounded race, so the session check waited for the language read. `index.html`'s parse-time session check now asks the cookie session's question too, without an `Authorization` header. `preflightAuth()` hands the answer to `AuthProvider` through the existing slot with a null token. A signed-out answer is handed on as well: a body naming no user, or the server's 401 `UNAUTHENTICATED`. A signed-out visitor therefore still sends one `get-session`. `AuthProvider` takes a null-token answer only while no token is stored. A protected route still waits for the session answer, and the seed's race and the language applied before first paint are unchanged.
