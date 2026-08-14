---
"@objectstack/spec": patch
---

<!-- adr-0087: registered engine-find-formula-filter-refused -->

docs(spec): register the FILTER-axis formula refusal in the ADR-0087 ledger (#8370)

The refusal itself shipped in 17.0.0 (#8296 / PR #8369): a `where` naming a
`formula` field is `400 INVALID_FIELD` at both doors — the REST ingress
(`assertFilterFieldsExist`) and the engine's own filter seam
(`assertFilterIsMaterializable`), which saved reports, flows and dashboard
widgets reach directly. It shipped with **no** ADR-0087 semantic entry, so
`objectstack migrate meta`, `spec-changes.json` and the generated upgrade guide
said nothing about it.

Its SORT-axis twin (#7095, `engine-find-formula-order-by-refused`) carries one,
for the identical shape. This adds the FILTER-axis sibling —
`engine-find-formula-filter-refused` under protocol 17 — and regenerates the two
projections of the registry.

For a code-path API there is no `sys_metadata` row for the D2 chain to rewrite
and no mechanical rewrite in either direction (the platform cannot invent the
stored column, and it must not filter post-hoc — `driver.find` has already
applied `limit` / `offset`, so a post-hoc predicate would filter an arbitrary
PAGE), which makes the ledger entry the only notification channel this class
has. The remedy it prescribes is the one the sort and search axes already
prescribe, in the same words: denormalise the value onto a stored field written
when the source changes, and filter that. `summary` and `autonumber` fields need
no action — both get real maintained columns and filter correctly.

No behaviour changes: registration and regenerated artifacts only.
