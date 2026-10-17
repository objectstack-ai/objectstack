---
'@objectstack/runtime': patch
'@objectstack/plugin-sharing': patch
---

fix(runtime, plugin-sharing): on the standalone server, an anonymous caller of any `/api/v1/notifications` verb or any `/api/v1/share-links` path off the two token faces is answered `401 UNAUTHENTICATED` in the dispatcher's standard envelope

Clause-②: no

The v18 text for these two doors reads "`/notifications`: `401 UNAUTHENTICATED` on every face" and "`/share-links`: `401 UNAUTHENTICATED` on the create, list and revoke faces and on every path the domain does not serve", in "the dispatcher's standard envelope … with the shared message every other dispatcher domain answers with". A host that reaches the dispatcher through `@objectstack/hono`'s catch-all already answered that way. The standalone server (the one `os dev` and `os serve` run) did not:

- `/api/v1/notifications`, `/api/v1/notifications/read` and `/api/v1/notifications/read/all` were each mounted for the one verb they serve, so any other verb never reached the `notifications` domain and the HTTP adapter answered `405`, naming the allowed methods, to an anonymous caller as well.
- `/api/v1/share-links` is served there by `@objectstack/plugin-sharing`'s routes, not by the dispatcher. They registered five routes and nothing else, so another verb or path got the adapter's `405` or `404`, and the create, list and revoke faces answered `401` with a sentence of their own ("Sign in to list share links") and no `error.httpStatus`.

What the standalone server answers now:

- **Anonymous caller.** `401 UNAUTHENTICATED`, `{ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication is required to access this endpoint.', httpStatus: 401 } }`, on every verb of the three notifications paths, and on every verb and path under `/api/v1/share-links` except `GET /share-links/:token/resolve` and `GET /share-links/:token/messages`, which the capability token still admits. A body the server cannot parse does not outrank this answer anywhere under `/api/v1/share-links`, nor on the notifications verbs no face serves.
- **Signed-in caller of a verb or path that is not served.** Still refused. On the notifications paths the domain answers it: `404 ROUTE_NOT_FOUND` from the dispatcher (or the `501` capability answer on a deployment with no inbox), where the adapter used to answer `405`. Under `/api/v1/share-links` the share-link routes answer it themselves: `404 ENDPOINT_NOT_FOUND`, naming the request, where the adapter used to answer `405` or `404`. No `Allow` header is sent on either.

Every request that was served is served as before. A notifications sub-path no face names, such as `/api/v1/notifications/<anything>`, is still not mounted on the standalone server and is answered `404`.
