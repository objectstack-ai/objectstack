---
"@objectstack/spec": minor
---

feat(spec): the error-code ledger's "no synonym of the standard catalog" rule is now mechanical, with recorded waivers (#8211, option C)

The ledger header has always said: if the condition is generic, use the
standard catalog instead of registering a synonym. That rule was prose only —
the admission gate rejected a code that is *literally* a `StandardErrorCode`
member, so four semantic synonyms (`CONFLICT`, `NOT_FOUND`, `FORBIDDEN`,
`INTERNAL`) accumulated without anyone deciding to allow them.

The rule now has teeth. New exports on `@objectstack/spec`:

- `standardSynonymOf(code)` — a **closed, mechanical** detector (no NLP fuzz):
  a code is a semantic synonym of a standard member when it is the
  SCREAMING_SNAKE spelling of an HTTP reason phrase whose status
  `HttpStatusErrorCodeMap` maps to a member (`FORBIDDEN` → 403 →
  `PERMISSION_DENIED`), or when every `_`-token of the code appears in a
  member's name (`CONFLICT` ⊆ `RESOURCE_CONFLICT`).
- `standardSynonymViolations(ledger, waivers)` — every unwaived synonym
  registration; the admission suite asserts it is empty and pins that the same
  function rejects a newly-introduced synonym (both prongs).
- `StandardSynonymWaiverSchema` / `StandardSynonymWaiver` /
  `STANDARD_SYNONYM_WAIVERS` — a waiver names the member the code shadows and
  carries a recorded reason, so admission is a decision on the record, never
  drift. Stale waivers fail the suite.

No wire change: the existing synonyms — the four above plus `UNAUTHORIZED`
(401 reason phrase of `UNAUTHENTICATED`'s condition, surfaced by the detector)
— are grandfathered via explicit waiver entries. Consolidating any of them
onto the member it shadows (option B) is deferred until a specific code has a
measured victim. One rule, two doors: this is the admission-door half of the
family whose dispatcher-door half was ruled in #8087.
