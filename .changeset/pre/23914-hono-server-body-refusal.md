---
'@objectstack/plugin-hono-server': minor
---

fix(plugin-hono-server)!: a request body the adapter cannot parse is refused `400 INVALID_REQUEST` when a route handler reads it, never handed to the handler as `{}`

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, no stored row is rewritten or deleted, and no exported declaration is added, removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of the HTTP transport for request bodies it cannot parse: a malformed declared-JSON body, a malformed form, or a body in a media type it does not read, each of which used to reach the handler as `{}`. The remedy is in the requests a client sends, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The adapter used to build a route's `req.body` as `{}` and overwrite it only when a parse succeeded, so a body it could not parse reached the handler as an empty object. Measured on a fresh `objectstack dev` showcase boot: `POST /api/v1/data/showcase_account/query` with its closing brace missing, with `{ not json`, or with a valid body sent as `text/plain` answered `200` with all 14 rows where the filter matched 2; a truncated `PATCH` answered `200`, changed no field and moved `updated_at`; and a truncated create answered `400 VALIDATION_FAILED` "Account Name is required", for a body that carried a name.

What changes for an integrator. Each refusal is `400` with `{ "success": false, "error": { "code": "INVALID_REQUEST", "message": "…" } }`, raised when the handler reads `req.body`, so the handler acts on nothing past that read and nothing is written. The message names the failure and never echoes the body.

- A body sent as `application/json` (matched case-insensitively) that is not blank and does not parse: FROM the handler reading `{}`, TO the refusal "The request body could not be parsed as JSON (it was sent as application/json). It was refused rather than read as an empty body: send a well-formed JSON document, or no body at all."
- A body in a media type the adapter does not parse (`text/plain`, `application/octet-stream`, any other type, or no `Content-Type` at all) sent to a route that reads `req.body`: FROM `{}`, TO the refusal "The request body was sent as text/plain, which this server does not read into a request body. It was refused rather than read as an empty body: send it as application/json."
- A `multipart/form-data` or `application/x-www-form-urlencoded` body that does not parse: FROM `{}`, TO the refusal naming form data.

**Remedy, in one line.** Send a JSON body as well-formed JSON with `Content-Type: application/json`, or send no body.

**Unchanged.**

- An empty or whitespace-only JSON body is still `{}`, which the REST data doors read as an empty query; a request with no body is still `{}`, whatever it declares.
- Well-formed JSON and well-formed forms reach the handler parsed, as before.
- A route that reads `req.rawBody()` and never `req.body` receives any media type byte for byte, as before: the storage raw upload stores a JSON-with-comments file sent as `application/json` (the type its presign tells the client to send for a `.json` file) and a text file sent as `text/plain`.
- A route, or the unmatched-request fallback, that never reads `req.body` answers as before.
- A body is judged present by its framing headers (`Content-Length` other than `0`, or `Transfer-Encoding`), as RFC 9112 defines it; nothing is read to find out.
