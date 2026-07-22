---
"@objectstack/plugin-auth": patch
---

fix(auth): map ObjectQL `ValidationError` to a 4xx on the better-auth paths (#3398)

A field-level validation failure raised by the ObjectQL record-validator
(e.g. an invalid `image` on `POST /api/v1/auth/update-user`) surfaced to the
HTTP client as a **raw 500 with an empty body**. better-auth only maps its own
`APIError`s to structured responses; any other error thrown from an adapter
method propagates to better-call's router as an unhandled fault → `500 {}`.

Added the auth-path analogue of the REST layer's `mapDataError`: the objectql
adapter now detects the ObjectQL validation envelope at its boundary (duck-typed
by `code` / `name`, so plugin-auth keeps no hard dependency on
`@objectstack/objectql` and cross-realm `instanceof` can't bite) and re-throws
it as `APIError('BAD_REQUEST', …)`. `update-user` and friends now answer with a
`400 { code: 'VALIDATION_FAILED', message, fields }` instead of an opaque 500.
