---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a package publish refused by a lock or a 409 now leaves its own audit row (#8594)

`publishPackageDrafts` — Studio's "publish whole app" — promotes every draft
inside ONE `engine.transaction()` (ADR-0067 D2, "a commit cannot half-land").
`promoteDraftForPublish` runs inside that closure, and it used to write its
**denial** audit rows there: the ADR-0010 lock refusal (`code: 'item_locked'`,
with the `lock_state` column) and the optimistic-lock 409
(`code: 'metadata_conflict'`).

On a transactional engine both rolled back with the batch. The refusal is what
aborted the batch, so the row describing that refusal was destroyed by the very
rollback it caused — the defect #7748 exists to close, surviving on this one
route. A compliance query filtering `code = 'item_locked'` found **nothing** for
a package publish refused by a lock, however many times it had been attempted.

The `batch_aborted` row added in #8400 gave a refused batch *a* trail, but it
carries the batch's fact ("the whole batch rolled back; nothing landed"), not the
item-level verdict's vocabulary or its lock column — so the query above still
came back empty.

**What changed.** `promoteDraftForPublish` no longer writes those rows. It hands
each refusal its own row as data, and each of its two callers records it on its
own side of its own transaction:

- `publishMetaItem` (single-item) records it where it always effectively landed —
  that route opens no transaction of its own, and its rows are unchanged, still
  filed under `source: 'protocol.publishMetaItem'`;
- `publishPackageDrafts` (batch) records it from the rollback handler, outside
  the transaction, filed under `source: 'protocol.publishPackageDrafts'`.

The placement no longer depends on the engine's capabilities either: an engine
with no `transaction()` at all lands the same row in the same place.

**What a refused batch now leaves.** Two rows for the causal item, each carrying
a different fact and neither replacing the other: the inner verdict
(`item_locked` with its `lock_state`, or `metadata_conflict` naming the losing
race) and #8400's `batch_aborted`. A refusal that never reached either gate — a
driver fault, `NOT_OVERRIDABLE`, `INVALID_METADATA` — still leaves exactly the
one `batch_aborted` row it left before; no code value is minted for it.

No new `code` value: ADR-0112 D6b keeps `sys_metadata_audit.code` a closed
persisted vocabulary, and the values that now land are the ones that were already
in it. Nothing about ADR-0067 D2 changes — a refused batch still promotes
nothing, records no commit, and reports `publishedCount: 0`.
