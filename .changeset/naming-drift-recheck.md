---
"@objectstack/cli": patch
---

fix(doctor): point the retired `reference_filters` hint at `lookupFilters` (#1878 §3 recheck)

`os doctor`'s snake→camel rule table advised "Use `referenceFilters`
(camelCase)" — a key REMOVED from `FieldSchema` in #2377/ADR-0049, which the
non-strict schema silently strips. The live successor is `lookupFilters` (read
by the objectui lookup picker). The rule now matches both spellings and names
the right key.
