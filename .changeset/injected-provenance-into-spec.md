---
'@objectstack/spec': minor
'@objectstack/metadata-core': patch
'@objectstack/lint': minor
---

Author-time warning for unprovisioned injected anchors on external objects (#8116). The injected-system-column definition tables and the #7865 provenance derivation (`platformProvisionsStorage`, `resolveInjectedColumnProvenance`, `unprovisionedInjectedColumns`, plus the newly exported identity predicate `isInjectedColumnDefinition`) moved from `@objectstack/metadata-core` into `@objectstack/spec/data`; `@objectstack/metadata-core` re-exports every previously-public name unchanged, so no downstream import changes. Built on the spec export, `@objectstack/lint` now warns when an expression, field conditional rule, formula, `stageField` or `highlightFields` entry references an injected system column (`owner_id`, `organization_id`, the audit family, `owning_business_unit_id`) on an ADR-0015 `external` object: the platform registers the anchor but provisions no storage behind it, so the reference silently degrades at query time (on SQLite: constant-false, HTTP 200, zero rows, no error). New advisory rule id `semantic-role-field-unprovisioned`; the expression finding is warning-severity and never fails the build. An author-declared column of the same name is treated as the author's real remote column and never warned.
