---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a stored row's package in the metadata list is its column's, never its body's

The metadata list read (`getMetaItems`, and the execution read the automation engine binds from) served a stored row's `_packageId` from its `package_id` column only when the body carried none, so a row whose body carried another package's id was served as that package's item. The column now wins: a body stamp is replaced by the column's package, or dropped when the row is bound to no package. The save door has stripped a body's `_packageId` since #16702, so only a row written before that, or by another writer, carries one.

Clause-②: no (narrowing) — a stored row whose body carries a `_packageId` other than its column's is served under its column's package (or none), no longer under the body's. Nothing is widened.

Metadata-protocol: none
