---
'@objectstack/rest': patch
---

The `/meta` type list, whole-store maintenance and per-type list routes live in their own module, with no route, handler or answer changed

Clause-②: no (a move: the seven routes per base, their place in the `/meta` registration order, every handler, every response and the anonymous-deny gate in front of them are unchanged, and the published declarations are byte-identical)

- `RestServer#registerMetadataEndpointsInner` keeps its name, docblock, place and head. The statements that register `GET {metaPath}` and `GET {metaPath}/types`, `GET {metaPath}/diagnostics`, `GET {metaPath}/_drafts`, `POST {metaPath}/_migrate-stored` and `GET {metaPath}/:type` moved, re-indented, to `packages/rest/src/meta-collection-routes.ts`, and the method calls them at their old position, inside the umbrella's guarded registration. The `metadata.endpoints.types`, `.maintenance` and `.items` switches gate the same mounts.
- Nothing to do for a consumer: no export of the package entry, no route, no configuration key and no response moved.
