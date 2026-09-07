---
'@objectstack/hono': patch
---

The Hono adapter's `/auth/*` mount yields only a 404 that disclaims ownership

`createHonoApp`'s `${prefix}/auth/*` mount forwards every request under it to the
kernel's `auth` service and, since #4117, hands the request on to the rest of the
chain when that service answers 404 — which is what keeps `/auth/me/permissions`
and `/auth/me/localization` reachable through the gated `dispatch()`. The yield
had only the status to go on, so it could not tell "I do not serve this path"
from "I serve it and the answer is 404".

Measured on a real boot through this adapter (a real kernel with `AuthPlugin`,
`prefix: '/api/v1'`), `GET /api/v1/auth/delete-user/callback?token=…&callbackURL=…`
answered `404 {"message":"Not found","code":"NOT_FOUND"}` from better-auth and
`200 {}` on the wire. `plugin-auth`'s route ledger carries that route under its
`disabled` disposition precisely because it is published and answers 404, so the
ledger's recorded answer was true of the auth service and false on this adapter's
wire. Nothing had to be composed in for that: the `${prefix}/*` dispatcher
catch-all this same function registers is terminal and answers `200 {}` for paths
under `/auth/`.

The mount now asks the auth service whether its own router serves the path, via
an optional `ownsRoute(request)` — the seam `AuthManager` grew in the plugin-side
fix for the same defect — and yields only when it does not. Every answer that is
not a literal `true` (no such method, a throw, anything else) means yield, so a
service predating the method behaves exactly as before and a failure to decide
can never cost the ordering-independent surface.

⛔ The mount is unchanged and still claims `${prefix}/auth/*`; 401/403 were never
yielded and still are not. What narrowed is only which 404 may be handed on.
