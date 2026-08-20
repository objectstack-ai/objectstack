---
'@objectstack/metadata-protocol': patch
---

fix: a package publishes as a self-consistent unit — `publishPackageDrafts` judges each draft against the batch's own pending declarations

The batch publish door built the author-time validation context from
`engine.registry` alone, i.e. the ALREADY-LIVE universe. A draft is not in that
registry, and the batch's own promotions do not put it there either: the
registry write-through runs in Phase 2, after the Phase-1 transaction that gates
and promotes every draft. So while a batch was being judged, no member of it was
visible to any other member — in any order.

Measured consequence: a package shipping `dataset/x` together with a `dashboard`
whose widget binds `x` could NEVER publish. `validateWidgetBindings` raises
`widget-dataset-unknown` at `severity: 'error'`, which refuses the promotion,
and the batch being all-or-nothing rolls the whole package back. Renaming the
dataset could not help, and neither could re-ordering the items.

`publishPackageDrafts` now reads its own pending drafts once, before any
promotion, and folds them into all four context collections the closure carries
(`objects`, `permissions`, `books`, `datasets`) — pending declarations replace a
live one of the same name, never sit beside it. A binding that resolves to
neither the batch nor the live universe is still refused exactly as before.
