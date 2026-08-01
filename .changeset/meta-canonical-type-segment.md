---
"@objectstack/metadata-protocol": patch
---

One canonical type key at the `/meta` read/write/delete boundary (#4432).

#3985 made the per-type gates accept both spellings of the `/meta` type segment
(`/meta/actions` and `/meta/action`). It did not FOLD them, so the two spellings
addressed two different namespaces and the layers below disagreed about which
one an item lived in. `saveMetaItem`, `getMetaItem`, `getMetaItems`,
`getMetaItemLayered`, `getMetaItemCached` and `deleteMetaItem` now fold the type
to its canonical singular (Prime Directive #3) as their first act, so every layer
below them reads one key.

The damaging consequence was not the duplicate row — it was the shadowing.
`getMetaItems` hydrated overlay rows back into the SchemaRegistry under the
CALLER's spelling, so one plural-spelled read minted a plural registry entry;
from the next read on, `listItems('actions')` was no longer empty, the singular
fallback that had been supplying every code-authored action stopped running, and
a single overlay row hid the entire code-authored listing — on a spelling no
DELETE could address, because the delete path resolved the singular. Listing and
dispatch then disagreed about an item that had been deleted.

Reads of data AT REST still try the other spelling as a fallback: rows written
under a plural `type` before this fix are real, and nothing rewrites them on
upgrade. What changed is that nothing WRITES or REGISTERS a non-canonical key any
more.
