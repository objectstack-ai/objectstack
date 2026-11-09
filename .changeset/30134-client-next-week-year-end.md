---
'@object-ui/core': patch
---

fix(core): the client date-macro resolver answers `{next_week_end}` and `{next_year_end}`

Clause-②: no
Metadata-protocol: none

`resolveDateMacros` now resolves `{next_week_end}` (Sunday of next week, Monday-start weeks) and `{next_year_end}` (Dec 31 of next year), the two fixed tokens `@objectstack/spec`'s `DATE_MACRO_TOKENS` declared that the Console passed through as raw text. A test now reads `DATE_MACRO_TOKENS` from the spec and fails on any token the client leaves unresolved, so the two lists cannot drift again.
