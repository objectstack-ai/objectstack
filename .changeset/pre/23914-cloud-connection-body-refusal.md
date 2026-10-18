---
'@objectstack/cloud-connection': minor
---

fix(cloud-connection)!: the cloud-connection and install-local routes refuse a declared JSON body that does not parse with `400 INVALID_REQUEST`, instead of answering as if no body was sent

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, no stored row is rewritten or deleted, and no exported declaration is added, removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of four of this package's own routes for one input: a body declared as JSON that does not parse, which used to be read as no body. The remedy is in the requests a client sends, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`POST /api/v1/cloud-connection/bind/start`, `/bind/poll`, `/install` and `POST /api/v1/marketplace/install-local` read their bodies as `try { body = await c.req.json() } catch { body = {} }`, so a truncated body was answered as if the client had sent none: `/bind/poll` answered `400 "device_code is required"` for a body that carried `device_code` and lacked a closing brace.

What changes for an integrator. A body sent as `application/json` (matched case-insensitively) that is not blank and does not parse: FROM the route's answer for an empty body, TO `400` with `{ "success": false, "error": { "code": "INVALID_REQUEST", "message": "The request body could not be parsed as JSON (it was sent as application/json). It was refused rather than read as an empty body: send a well-formed JSON document, or no body at all." } }`. Install-local refuses it after its sign-in and capability checks and before anything is fetched, registered or written.

**Remedy, in one line.** Send a JSON body as well-formed JSON with `Content-Type: application/json`, or send no body.

**Unchanged.** An empty or whitespace-only JSON body is still no body, and every route answers it as before (for `/bind/poll`, `400 "device_code is required"`). A body that parses, and a body that does not declare JSON, are read as before.
