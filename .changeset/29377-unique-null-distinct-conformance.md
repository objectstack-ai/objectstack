---
'@objectstack/spec': patch
---

spec(data): a shared NULL-distinct `unique` conformance case-set, so every driver proves two NULLs do not collide

Clause-②: yes (widening)
Metadata-protocol: none

`@objectstack/spec/data` now exports `UNIQUE_NULL_DISTINCT_CASES`, the case-set a driver suite runs to show that its `unique` constraint follows SQL's NULL rule: a row whose unique key holds a NULL (`null` or an absent value) in any key part is exempt, while `''` and equal non-null values still collide. It covers a field-level `unique` and a declared two-column unique index. `UNIQUE_NULL_DISTINCT_OBJECTS` is the two fixture objects, `UniqueNullDistinctCase` the row type, and `uniqueNullDistinctDivergence(case, second, stored)` the shared judge, which also checks how many rows the store kept.

The driver-conformance census (`pnpm check:driver-conformance`) scores the new column. No driver runs it yet: each driver adopts it in its own PR, and until then its cell is a tracked DEBT row. Nothing about how any driver stores, accepts or refuses a value changes.
