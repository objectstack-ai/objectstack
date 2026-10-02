---
"@objectstack/metadata-protocol": patch
---

`computeViewReferenceDiagnostics` no longer walks a list view's own `tabs[].filter`

Clause-②: no

The list view's own `tabs` is a `retiredKey` tombstone on every list-view shape. The write door refuses it, and a stored or artifact-shipped body has it stripped by the conversion replay before it is served, so the read could never see it. A served body that still carries it is already badged by the spec diagnostics (`computeMetadataDiagnostics`), with the tombstone's prescription. The `userFilters.tabs[].filter`, `filterableFields` and `kanban` checks are unchanged.
