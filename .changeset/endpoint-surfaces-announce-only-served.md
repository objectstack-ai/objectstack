---
'@objectstack/rest': minor
---

The two machine-readable endpoint surfaces announce only the declarations the runtime actually serves

`GET {basePath}/meta/api` and `GET {basePath}/openapi.json` enumerated declared `api` items
through the metadata protocol (ObjectQL SchemaRegistry + `sys_metadata`). Whether a declared
route is SERVED is decided by a different reader — `IMetadataService.matchEndpoint` and the
endpoint matcher behind it, which sees the metadata manager's registry and its registered
loaders. A real boot measured the two disagreeing: an `api` row written through
`PUT /meta/api/{name}` was enumerated by both surfaces — the OpenAPI document publishing it as
a path with `security: []`, i.e. as needing no credentials — while every request to it answered
404.

Both surfaces now ask the matcher, per declaration, and announce only what comes back. An
`/openapi.json` is what SDKs, codegen and AI clients generate from, so an endpoint advertised
there that does not exist propagates into everything built on top of it.

**What changes for you:** an `api` declaration that this runtime will not serve disappears from
both surfaces. That covers a row created by a runtime/Studio metadata write rather than
published from a stack artifact, and one excluded at load by the ADR-0121 publish gates (for
example `authRequired: false` with no armed `rateLimit`). If a declaration you expected has
vanished, it was already answering 404 — the surface has stopped mis-reporting it, and the
server log now names each omitted declaration, its route, and why. Publish it through a gated
path (a stack artifact, or `publishPackage` with the package's `manifest.namespace`) to make it
real. Endpoints declared in a stack artifact are unaffected: they are served, so they are still
listed and still documented in full.

Two surfaces deliberately keep their previous behaviour: `GET /meta/api?preview=draft` answers
"what is pending", which is by construction not the served set, and the single-item
`GET|PUT|DELETE /meta/api/{name}` routes stay reachable so an unserved declaration can still be
inspected and removed.

Hosts that embed `RestServer` directly get a new optional final constructor argument,
`metadataServiceProvider`, resolving the `metadata` service. `rest-api-plugin` wires it; a host
that does not pass it keeps the old enumerate-everything behaviour and logs, once, that the
surfaces can no longer promise they describe only served routes.
