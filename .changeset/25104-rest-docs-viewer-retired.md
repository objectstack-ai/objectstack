---
'@objectstack/rest': patch
---

feat(rest)!: `GET {base}/docs`, the OpenAPI document's HTML viewer page, is retired; `GET {base}/openapi.json` stays

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) A runtime route retirement in RestServer.registerOpenApiEndpoints, not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped: the page was an HTML answer on one REST path, and `objectstack migrate meta` has nothing to rewrite. The machine-readable document, its `api.enableOpenApi` gate and its answer are unchanged. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this route and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only / runtime-export-retired). -->

**BREAKING** (a published route stops being served), shipped as `patch` because it is a non-protocol change: it changes what a REST caller is served, not what a metadata author can write.

`RestServer.registerOpenApiEndpoints` mounted two routes on every base: the OpenAPI document and an HTML viewer page for it. The viewer page is retired on both route shapes, the unscoped `{base}/docs` and the environment-scoped `{base}/environments/:environmentId/docs`. Nothing read it, and the API origin serves no HTML viewer.

- **Not served now:** `GET {base}/docs` has no route. A request to it gets the host's ordinary not-found answer, the same one any unmounted path gets: on the standard server (`@objectstack/plugin-hono-server`) that is `404` with code `ENDPOINT_NOT_FOUND`, for a signed-in caller and an anonymous one alike.
- **Unchanged:** `GET {base}/openapi.json` on both route shapes, its `api.enableOpenApi` gate, its anonymous `401` and the document a signed-in caller receives. The document no longer lists the `/docs` path, because it describes only mounted routes.
- `api.enableOpenApi` now gates one route, the document.

What changes for you. If you opened the page, load the document from `GET {base}/openapi.json` into an OpenAPI viewer of your choice.
