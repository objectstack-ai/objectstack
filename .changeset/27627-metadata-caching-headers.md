---
'@objectstack/rest': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/cloud-connection': patch
'@objectstack/types': minor
---

feat(rest,plugin-hono-server,cloud-connection): metadata lists, the uncached item reads, `runtime/config` and `auth/me/localization` answer an `ETag` and `304`; every timed response carries `db`, `meta` and `total`

Clause-②: no
Metadata-protocol: none

The Console's first reads on every load sent no validator, so each one was a full download every time. Measured against HotCRM on `main`, none of these sent an `ETag`, a `Cache-Control` or a `304`: `GET /runtime/config`, `GET /auth/me/localization`, the type list (`GET /meta`, `GET /meta/types`), every `GET /meta/:type` list, and the item reads the shared item cache never serves (`GET /meta/app/:name`, `/meta/dashboard/:name`, `/meta/doc/:name`, `/meta/book/:name`, and drafts, `?package=` and member-scoped reads). Each of them now answers:

- **`ETag`**: a weak validator (`W/"…"`) that hashes the body actually served, after every per-caller step (read gates, the app filter, the field mask, the translation, the host's environment). Two callers whose permissions change what they see get different validators, and one caller's validator never answers `304` for another caller's body.
- **`Cache-Control: private, no-cache`**: the browser keeps the body and revalidates it on every use, so a publish, a permission change or a language switch shows on the next read. No shared cache stores it. A schema served under an undetermined field visibility keeps `private, no-store` and gets no validator.
- **`304 Not Modified`**, with no body, when `If-None-Match` names the current validator.

`metadata.enableCache: false` still switches the `/meta` validators off, as its description says ("Enable HTTP cache headers").

`Server-Timing` (still opt-in: `OS_SERVER_TIMING=true`, or an admin's `X-OS-Debug-Timing: 1`):

- Every timed response carries `db` and `meta` beside `total`. A request that ran no SQL or read no metadata says so with a zero member (`db;dur=0;desc="0 queries"`), so "nothing spent there" no longer reads like "not measured".
- The `/meta` routes count each metadata read into `meta` (`meta;dur=…;desc="N reads"`).
- `GET /runtime/config` now opens the timing gate for an admin who sends `X-OS-Debug-Timing`. It resolves the caller only when that header is sent; the payload never depends on who asked.

`@objectstack/types` exports the rule the three packages share: `representationEtag(body)`, `ifNoneMatchHits(header, etag)` and `REVALIDATE_PRIVATE_CACHE_CONTROL`.
