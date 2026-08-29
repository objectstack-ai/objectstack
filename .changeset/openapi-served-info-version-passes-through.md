---
'@objectstack/rest': minor
---

`GET {basePath}/openapi.json` no longer overwrites `info.version` — the served
document publishes the version `packages/spec` put in the artifact

**FROM** the deployment's declared API version identifier (`api.version`, which
`normalizeConfig` defaults to `'v1'`) — **TO** the published artifact's own
version (`@objectstack/spec`'s `./openapi.json` export, `17.2.0` at the time of
this change, set from that package's version by `build-openapi.ts`).

The `info` block is the half of the document `packages/spec` produces and owns,
and this route's own test twin has asserted that "serve-time enrichment must not
touch it" since #5588 — with the assertion narrowed to `info.title` alone,
precisely because `version` was overridden. The invariant was stated and then
excepted, in the same file. The override is deleted, the exception is gone, and
the twin's assertion now covers the whole `info` block.

Nothing is lost. The declared API version identifier still exists and is still
observable where a caller can act on it: it builds the mount
(`${basePath}/${version}` gives `/api/v1`). The runtime version is still
answered by `{basePath}/discovery` and `/health`. OpenAPI 3.1 defines this field
as "the version of the OpenAPI document (which is distinct from the OpenAPI
Specification version or the API implementation version)" — the document being
served is the artifact, so its version is the artifact's.

**Measured consumer pull: zero.** No consumer reads this document's
`info.version` by value, and nothing derives a route prefix from it or compares
it against `api.version` — the repo's one route-prefix derivation
(`packages/core/src/qa/http-adapter.ts`) reads the config directly and is
unaffected. That sweep covers `objectstack` only: `objectui`, `cloud` and
`cloud-v1` were not reachable where it ran, so the zero across those three is an
earlier reading carried forward, not re-measured here.

The one deployment shape that changes is one scraping the served `info.version`
to learn its own `api.version`; it should read the mount, or
`{basePath}/discovery`, both of which state that fact on purpose.

This supersedes the `info.version` half of the unreleased
`openapi-info-version-is-the-api-version` entry in the same cycle: that entry's
fallback removal stands, its statement that the served field carries the API
version identifier does not.
