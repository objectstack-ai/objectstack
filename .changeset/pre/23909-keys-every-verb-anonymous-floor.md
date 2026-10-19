---
'@objectstack/runtime': patch
---

fix(runtime): the standalone server hands every `/api/v1/keys` verb to the `keys` domain, so an anonymous caller is answered `401 UNAUTHENTICATED` whatever the verb

Clause-②: no

The v18 text for this door reads "`/keys`: `401 UNAUTHENTICATED` for every verb". The `keys` domain takes that decision first, but the standalone server (the one `os dev` and `os serve` run) mounted `/api/v1/keys` for `POST` only. Any other verb never reached the domain: the HTTP adapter answered it itself, with a `405` that named `POST` as the allowed method.

What a `GET`, `PUT`, `PATCH` or `DELETE` call to `/api/v1/keys` is answered on the standalone server:

- **Anonymous caller.** Before: `405 METHOD_NOT_ALLOWED` with `Allow: POST`, from the adapter. Now: `401 UNAUTHENTICATED` in the dispatcher's standard envelope, `{ success: false, error: { code: 'UNAUTHENTICATED', message, httpStatus: 401 } }`.
- **Signed-in caller.** Before: `405 METHOD_NOT_ALLOWED` with `Allow: POST`, from the adapter. Now: still `405 METHOD_NOT_ALLOWED`, answered by the `keys` domain in the same standard envelope (`error.httpStatus: 405`, no `error.details`), and without an `Allow` header.

`POST /api/v1/keys` is unchanged, and so is every answer on a host that reaches the dispatcher through `@objectstack/hono`'s catch-all, which already answered this way. A `HEAD` request follows `GET`: `401` anonymous, `405` signed in. A sub-path such as `/api/v1/keys/<anything>` is still not mounted on the standalone server and is answered `404`.
