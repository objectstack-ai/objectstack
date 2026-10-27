---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: `GET /api/v1/meta/:type/:name/diff` refuses a `from` or `to` version that has no history row with 404 `VERSION_NOT_FOUND`, as the rollback door already does, instead of answering 200 "no change" or "everything removed"

Clause-②: yes (narrowing) — `diffMetaItem` (and the REST `/diff` door that forwards to it) refuses a named version with no history row of the item, which it answered 200 before. The default range and every version that has a row answer exactly as before.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) A read door's answer to a version that does not exist: no key of any metadata schema is added, removed, renamed or re-shaped, no export or type changes, and the refusal is the existing VERSION_NOT_FOUND code the rollback door answers. There is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at `diffMetaItem` (`@objectstack/metadata-protocol`), served by `GET /api/v1/meta/:type/:name/diff`.

- **Before.** A `from` or `to` version the item has no history row at was compared as an empty document. `?from=998&to=999` answered 200 with nothing added, removed or changed, which reads as "these versions are identical". `?from=1&to=999` answered 200 with every top-level key of version 1 under `removed`, which reads as "the item was deleted". An item that never existed answered 200 "no change". The rollback door refused the same numbers with 404.
- **Now.** A named `from` or `to` with no history row of the item is refused 404 `VERSION_NOT_FOUND`, with the rollback door's own sentence: `No history row at version N for TYPE/NAME.` An item with no history at all is refused the same way. A version number that exists only in another item's history is this item's miss, refused the same way; it was never read from the other item.
- **Unchanged.** The default range (no `from` / `to`) answers as before, for every item, including one with no history. A version that has a row answers as before, a delete tombstone included (compared as an empty side). A history read failure is still the 503 `SERVICE_UNAVAILABLE`, and a deployment that never provisioned the history table still gets the empty default diff.
- **Who sees it.** A caller who names a version that does not exist, for example a mistyped or pruned number, or `from=0` used to mean "before the first version". It now gets 404 instead of a 200 that described a change that did not happen.

**The remedy.** Name versions from `GET /api/v1/meta/:type/:name/history`. To compare a version against nothing, omit `from` on an item's first version: the default from side is absent when no earlier version differs.
