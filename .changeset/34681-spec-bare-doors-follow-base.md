---
'@objectstack/spec': patch
---

docs(spec): the request texts state that a request naming no package follows the row-held base

Clause-②: yes (widening)
Metadata-protocol: none

The `packageId` descriptions of the save, draft save, per-item publish, delete and history/diff/rollback requests (`HISTORY_PACKAGE_SELECTOR_DESCRIPTION`) said a request naming no package is refused `409 RESOURCE_CONFLICT` wherever an item's active rows are bound to two or more packages. They now state the exception the server answers: a bundled type's member that a base package and a package declaring it both hold, with no package-unbound row beside them, is the row-held base's, as the read naming no package serves it, and the request addresses the base's row, draft or versions as naming the base does. Two packages neither of which declares the other are still refused `409`. The delete text states the consequence: the dependent's row is served next, a second delete naming no package removes it too, and the base's copy comes back only by saving it again. Description text only; no schema shape, key or accepted value moves.
