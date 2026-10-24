---
'@objectstack/service-analytics': patch
'@objectstack/metadata-protocol': patch
---

fix(service-analytics)!: an analytics read gate that could not decide answers `503 SERVICE_UNAVAILABLE`, not the `403 PERMISSION_DENIED` of a real denial

Three of the analytics door's refusals are operator-side faults: the object-level read admission provider threw, the field-level read permissions could not be resolved, or the API exposure declaration could not be read. Each refused the query, which is right, but each answered with the same body as a real denial, `403 PERMISSION_DENIED`. A caller could not tell "you may not read this" from "the server could not decide", except by parsing the English message. All three now answer `503 SERVICE_UNAVAILABLE`. That is an existing ADR-0112 code, and it is the spelling `@objectstack/core` already uses when the permission store is unreachable. The refusal names the object and nothing else; it names no gate, grant or existence fact. The cause stays in the server log, as before. Fail-closed is unchanged: nothing that was refused is now admitted. Real denials keep their answers byte for byte: `403 PERMISSION_DENIED` when the caller holds no read grant or reads a hidden field, and `404 OBJECT_API_DISABLED` / `405 OBJECT_API_METHOD_NOT_ALLOWED` for an unexposed object. `POST /api/v1/analytics/dataset/query` relays the declared fault as `503 SERVICE_UNAVAILABLE`, with the message withheld as for every declared server fault. It does not answer `500 ANALYTICS_QUERY_FAILED`. The cube query door relays the status the same way.

The publish build probe (`@objectstack/metadata-protocol`) reads the code too. A widget query that fails with `SERVICE_UNAVAILABLE` now gets a `widget_query_failed` fix that names the server-side fault: the dataset is not the cause, and the server could not decide read access to the named object. Before, it fell to "Fix the dataset definition…", which is wrong for an outage. The finding's `code`, `severity` and `message` are unchanged.

Clause-②: no
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored shape or exported declaration is added, removed, renamed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the code and status three analytics refusals answer when a permission or exposure resolver fails (403 PERMISSION_DENIED to 503 SERVICE_UNAVAILABLE); every request that was refused is still refused and every request that was served is still served. The remedy is on the consumer's side, reading the code, never a rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the wire answer of three fault refusals changes; no request that was served is refused and none that was refused is served), shipped as `patch` because the metadata protocol does not move.

- **Before:** when the analytics read-admission provider threw, or the field-level read permissions or the API exposure declaration could not be resolved, the query was refused `403 PERMISSION_DENIED`. That was the same code and status as a caller who genuinely may not read the object.
- **Now:** the same refusals answer `503 SERVICE_UNAVAILABLE` (`status: 503`, `object` naming the object). On `POST /api/v1/analytics/dataset/query` the body is `{"code":"SERVICE_UNAVAILABLE","error":"Internal server error"}`. Real denials still answer `403 PERMISSION_DENIED` (and `404` / `405` for exposure), unchanged.
- **Fix:** a client that treated every analytics `403` as "no access" should treat `503 SERVICE_UNAVAILABLE` as a server-side fault: retry once the permission or exposure resolver is healthy, and check the server log for the cause. Do not show it as a missing grant.
