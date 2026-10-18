---
'@objectstack/rest': patch
---

The `/meta` per-item read routes live in their own module, with no route, handler or answer changed

Clause-②: no (a move: the four routes per base, their place in the `/meta` registration order, every handler, every response and the anonymous-deny gate in front of them are unchanged, and the published declarations are byte-identical)

- `RestServer#registerMetadataEndpointsInner` keeps its name, docblock, place and head. The statement that registers `GET {metaPath}/:type/:name/references`, `GET {metaPath}/:type/:name/layers`, `GET {metaPath}/book/:name/tree` and `GET {metaPath}/:type/:name` moved, re-indented, to `packages/rest/src/meta-item-read-routes.ts`, and the method calls it at its old position, inside the umbrella's guarded registration. The `metadata.endpoints.item` switch gates the same mounts.
- Nothing to do for a consumer: no export of the package entry, no route, no configuration key and no response moved.
