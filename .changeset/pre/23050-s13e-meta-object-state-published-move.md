---
'@objectstack/rest': patch
---

The `/meta` object state-machine read and the published read live in their own modules, with no route, handler or answer changed

Clause-②: no (a move: the two routes per base, their place in the `/meta` registration order, every handler, every response and the anonymous-deny gate in front of them are unchanged, and the published declarations are byte-identical)

- `RestServer#registerMetadataEndpointsInner` keeps its name, docblock, place and head, its per-item registrar included. The statement that registers `GET {metaPath}/object/:name/state/:field` (the legal next states of an object field's state machine) moved, re-indented, to `packages/rest/src/meta-object-state-routes.ts`, and the block that registers `GET {metaPath}/:type/:name/published` (an item's published version) moved to `packages/rest/src/meta-item-history-routes.ts`, beside the history family. The method calls each at its old position, inside the umbrella's guarded registration. The state read still answers to `api.enableMetadata` alone, and the published read still registers through the per-item registrar, so the `metadata.endpoints.item` switch gates the same mounts.
- Nothing to do for a consumer: no export of the package entry, no route, no configuration key and no response moved.
