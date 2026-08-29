---
'@objectstack/spec': patch
---

Every view-family conversion now reaches all three persisted `view` spellings.

`ViewMetadataSchema` accepts three body shapes and all three land in `sys_metadata` rows — the `defineView` container (`list`/`listViews`/`form`/`formViews`), the standalone ViewItem record (`{ viewKind, config }`), and the flattened runtime overlay (a raw ListView/FormView config at the top level plus its `object` + `viewKind` binding). Every view-family conversion walked only the container keys, so for the other two spellings the whole chain replayed by `applyConversionsToStoredItem('view', row)` was a no-op: a row written under an older protocol kept its historical shape while the conversion layer reported it canonicalized, and the rehydration parse then refused exactly what had never been rewritten.

A new shared walker (`mapViewPayloads` in `conversions/walk.ts`) discriminates the three spellings using `ViewMetadataSchema`'s own discriminators — `viewKind` plus a `config` object for a record, the container slots for a container, `viewKind` with those slots absent for a flattened overlay — and hands each conversion the list/form payload wherever it lives, labelled with its family. All five view-family conversions adopt it: `view-visibleOn-to-visibleWhen`, `view-inert-keys-removed`, `view-list-passthrough-keys-removed`, `view-export-options-pdf-removed` and `form-view-option-default-removed`.

The family label is load-bearing rather than informational: these conversions are shape-scoped, and two of them strip a key that is inert on one family and live on the other (`aria` is retired on a form and live on a list, `data` the reverse), so a walk that could not tell the two apart would delete live keys.

No authoring surface moves and no accept set changes — this is data-at-rest canonicalization catching up to shapes the schema already ruled on. Container behaviour, including every notice path, is unchanged.
