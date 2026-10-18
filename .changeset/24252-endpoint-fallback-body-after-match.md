---
'@objectstack/runtime': patch
---

fix(runtime): a request to a declarative `apis:` endpoint path gets its `404` or `401` whatever its JSON body, not the transport's `400`

Clause-②: no

Only the order of refusals moves: the `404` and the `401` now answer ahead of the body's `400`. No request that was refused before is accepted, and no export changes.

On the standalone server (`os dev`, `os serve`: `HonoServerPlugin` with the dispatcher plugin), the fallback that serves metadata-declared `apis:` endpoints (`/api/v1/apps/NAMESPACE/...` under the default prefix) read the request body before it matched an endpoint or applied `authRequired`. The transport refuses a body it cannot parse when the body is read, so that refusal answered first:

- a `POST /api/v1/apps/ns/x` that no declaration owns, with `{"params": {"days": 30}` (the closing brace missing), got `400 INVALID_REQUEST`, while the same request with a well-formed body got `404 ENDPOINT_NOT_FOUND`, signed in or not;
- an anonymous `POST` to an `authRequired: true` endpoint with that body got `400 INVALID_REQUEST`, while a well-formed body got `401 UNAUTHENTICATED`.

The fallback now hands the endpoint step the body unread, and the step reads it once the endpoint is matched and its policies (`rateLimit`, `authRequired`) have admitted the caller, just before `inputMapping`. A path no declaration owns answers `404`, and an anonymous caller of an `authRequired: true` endpoint answers `401`, whatever the body. A caller the endpoint admits still gets the transport's `400 INVALID_REQUEST` for an unparseable body, and a readable body reaches the target as before.
