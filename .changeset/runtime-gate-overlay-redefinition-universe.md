---
"@objectstack/metadata-protocol": minor
---

fix(metadata-protocol): the runtime authoring gate judges an OVERRIDDEN item from the body the runtime serves (#16224)

The #4463 runtime authoring gate resolves references against the live metadata universe, and since #15950 it gathers that universe from BOTH homes — the `SchemaRegistry` and `sys_metadata`. That fold was **additive**: a stored row contributed a name the registry did not carry and never displaced a registry entry. Where an org or env-wide overlay REDEFINES an item a code package already declares, the gate therefore judged that item's CONTENT from the registry's copy — a body the runtime had already stopped serving.

Measured end to end, in one process and one instant. A code package ships `dataset/D` with measure `m`; an env-wide overlay redefines `D` without it:

- a dashboard widget bound to `values: ['m']` was **accepted**, and the runtime cannot serve it;
- a widget bound to the measure the overlay DOES declare was **refused** `422 widget-measure-unknown`, and the runtime can.

One cause, both directions: an acceptance that should have been a refusal and a refusal that should have been an acceptance.

The hand-rolled additive merge is replaced by `mergePackageAwareOverlay` with `foldObjectExtendersFromRegistry` as its transform — the merge, and the transform, that `getMetaItems` (the read API behind `GET /meta/:type`) already runs. The gate's universe is now the universe the platform answers reads from, by construction rather than by agreement, and ADR-0048 package slotting arrives with it: an overlay shadows the entry it actually overrides, and two installed packages shipping one `type/name` remain two entries.

**#15950's resolved-vs-base distinction is kept by folding, not by declining.** Its argument was never "an overlay must not win" but "an UNRESOLVED body must not win" — the registry's copy of an object is its RESOLVED schema (ADR-0029 D9.2: base layer plus its `extend` contributors), a `sys_metadata` row is the base layer alone — and it names its own remedy, which is what `getMetaItems` does to its winner. Pinned: an `object` overlay wins on its own columns AND keeps the registry's `extend` contributors. For a name the registry does not carry the result is byte-for-byte #15950's additive contribution, pinned in the same process.

Graded `minor` rather than `patch`: `PUT /meta/:type` is a published verb and this narrows its accept set. An `active` publish that names a reference the overlay removed now answers `422 INVALID_METADATA` where it answered `200` — one legal published answer replaced by another, not the repair of a value the schema already refused. The write it now refuses is one the runtime could never serve; the write it now accepts is one the runtime always could.
