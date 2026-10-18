---
'@objectstack/rest': patch
---

The `/meta` history family routes live in their own module, with no route, handler or answer changed

Clause-②: no (a move: the five routes per base, their place in the `/meta` registration order, every handler, every response and the anonymous-deny gate in front of them are unchanged, and the published declarations are byte-identical)

- `RestServer#registerMetadataEndpointsInner` keeps its name, docblock, place and head, its per-item registrar included. The five statements that register `GET {metaPath}/:type/:name/history` (the change log), `GET …/audit` (the audit trail), `POST …/publish` (the promotion of a pending draft), `POST …/rollback` (the restore of an earlier version) and `GET …/diff` (the comparison of two stored versions) moved, re-indented, to `packages/rest/src/meta-item-history-routes.ts`, and the method calls them at their old position, inside the umbrella's guarded registration. They still register through that per-item registrar, so the `metadata.endpoints.item` switch gates the same mounts.
- Nothing to do for a consumer: no export of the package entry, no route, no configuration key and no response moved.
