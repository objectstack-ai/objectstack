---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a metadata read that names no package serves the row a save that names no package writes, when a package-unbound row of the item is stored beside its one package's row (ADR-0048, ADR-0070)

Clause-②: no

- **What was wrong.** A save naming a package (`PUT /api/v1/meta/TYPE/NAME?package=P`) of an item that already had a package-unbound row stored the package's row beside it, the unbound row first. The read naming no package (`GET /api/v1/meta/TYPE/NAME`) then served the unbound row's body, while the save naming no package wrote the package's row, the delete naming no package removed it, the list served it, and the read's own `version` was the package row's token. An author editing the item without `?package=` was served a body that no save changed.
- **What it does now.** For an item whose stored rows are bound to exactly one package, the read naming no package serves what the read naming that package serves: the package's own row, else the package-unbound one. That is the address the package-less save, delete and version token already resolve, so all of them name one row. The draft reads (`?state=draft` and the draft preview) take the same address, as the package-less draft save inherits that package. An item bound to two or more packages is read as before (the first stored row, ADR-0048 §3.3's best effort); a save or delete naming none of them is still refused `409 RESOURCE_CONFLICT`.
- **What does not change.** No stored row is rewritten or removed, and no request is refused that was accepted before. The package-unbound row still stands in for every package that has no row of its own (a read naming such a package serves it), and once the package's row is deleted it is what the read and the next package-less save address again.
