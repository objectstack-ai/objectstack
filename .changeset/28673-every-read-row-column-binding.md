---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol)!: every metadata read states a stored row's package from its column, never from its body

The list read serves a stored row's `_packageId` from its `package_id` column only (#28594); the other reads of a stored row still stamped the column's package only while the body carried none, so a body stamp the save door would strip was echoed back. Now one rule serves them all: the by-name active and strict draft reads, the by-name draft preview, the draft list, the list merge and the registry hydration (with the items a view container row expands to) state the column's package, replacing a body stamp that names another package and dropping one on a row bound to no package.

Clause-②: no (narrowing) — a stored row whose body carries a `_packageId` other than its column's is served and registered under its column's package (or none) at every read, no longer under the body's. Nothing is widened.

Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key is added, removed or renamed and no stored body is rewritten or refused: the row's package binding is its `package_id` column, which every read already served whenever the body carried no stamp; a body stamp that disagrees with the column was never written by the save door, so no author has anything to convert. -->

**BREAKING** read narrowing (`@objectstack/metadata-protocol`), shipped as `patch`.

- **Before.** A by-name read, a draft read or preview, the draft list and the registry hydration served a stored row whose body carried `_packageId` with the body's value, whatever its column said.
- **Now.** Each serves it with its column's package, or with none when the row is bound to no package, as the list read does.
- **Unchanged.** A row whose body carries no stamp, or one equal to its column, is served exactly as before.
- **Who sees it.** Only a row written before the save door began stripping body stamps, or by a writer other than the save door.
