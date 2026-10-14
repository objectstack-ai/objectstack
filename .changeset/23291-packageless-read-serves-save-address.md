---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a metadata read that names no package serves the row a save that names no package writes, when a package-unbound row of the item is stored beside its one package's row (ADR-0048, ADR-0070)

Clause-②: no

- **What was wrong.** A save naming a package (`PUT /api/v1/meta/TYPE/NAME?package=P`) of an item that already had a package-unbound row stored the package's row beside it, with the unbound row first. The read naming no package (`GET /api/v1/meta/TYPE/NAME`) then served the unbound row's body. Meanwhile the save naming no package wrote the package's row, the delete naming no package removed it, the list served it, and the read's own `version` was the package row's token. An author editing the item without `?package=` was served a body that no save changed. A save pinned to the served token overwrote the package's row with an edit of the unbound body.
- **What it does now.** For an item whose stored active rows are bound to exactly one package, a read that names no package takes its stored content from what the read naming that package takes it from: the package's own row, else the package-unbound one. That is the address the package-less save, delete and version token already resolve. The doors whose served row changes:
  - the item read, `GET /api/v1/meta/TYPE/NAME`;
  - the layered read, `GET …/layers` and the deprecated `?layers=` (its `overlay` and `effective`);
  - the published read, `GET …/published`, on the REST server and on the dispatcher;
  - the draft reads, `?state=draft` and the draft preview, whose address comes from the same active rows, because the package-less draft save inherits that package.
  
  An item bound to two or more packages is read as before: the first stored row, ADR-0048 §3.3's best effort. A save or delete naming none of them is still refused `409 RESOURCE_CONFLICT`. The lock reported by these reads is selected as before.
- **One answer changes from 200 to 404.** Take an item whose active rows are bound to package P and whose only draft is bound to another package Q. Naming no package, the strict draft read (`?state=draft`) now answers `404 NO_DRAFT` instead of serving Q's draft. P's draft is what a package-less draft save would write, and there is none; the read's `version` was already `null`. Read that draft with `?package=Q`. The draft preview naming no package now serves P's active row.
- **What does not change.** No stored row is rewritten or removed. No key, export or schema moves. No write is refused that was accepted before. The package-unbound row still stands in for every package that has no row of its own: a read naming such a package serves it. Once the package's row is deleted, it is what the read and the next package-less save address again.
