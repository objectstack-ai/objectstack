---
'@objectstack/lint': minor
---

Internal hardening of `validate-list-view-field-refs`' own test suite: the criterion for "every field-naming position the rule walks is asserted" is now derived from the rule's own `POSITIONS` / `COLUMN_ENTRY_POSITIONS` tables instead of a hand-maintained row count, so a position added to the rule with no matching test row fails on the commit that adds it.

No published entry, type or runtime behaviour changes: the derived seam is not re-exported from the package barrel, and `@objectstack/lint`'s built `dist/` is byte-identical to the build that predates it (all nine artifacts, sha256).
