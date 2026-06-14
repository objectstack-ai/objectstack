---
"@objectstack/objectql": patch
---

fix(objectql): seed reference resolution falls back to matching by `id`

`SeedLoaderService.resolveFromDatabase` only matched a reference value against
the target's natural-key field. A seed that wires a lookup to a REAL existing
record by its internal id — e.g. a people field (approver/applicant → user)
pointed at the current user — dangled to `null` when that id is not a
UUID/ObjectId (so the caller's `looksLikeInternalId` guard did not
short-circuit) and is not the target's natural key.

Adds an id fallback: when the natural-key lookup finds nothing, try resolving
the value as the target's `id`. Safe — an id either exists or it doesn't, so
there is no risk of a false natural-key match, and it is tenant-scoped like the
primary lookup.
