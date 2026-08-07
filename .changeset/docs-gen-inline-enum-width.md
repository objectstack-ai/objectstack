---
"@objectstack/spec": patch
---

fix(spec): the reference generator elides an over-wide enum inside an inline shape summary, and says how many members it hid (#5340)

`formatType()` capped how many **keys** an inline object summary prints
(`INLINE_KEY_LIMIT = 4`) but never capped how wide a single key's **type** could
be. One long enum reached through a summary therefore printed every member into
one table cell. The issue was filed on `BulkActionDef.params` at ~900
characters; measuring the whole corpus found that is not close to the worst —
the 261-member error-code vocabulary is inlined into the `error` shape of 80
rows across 13 `api/*.mdx` pages, at **6242 characters in a single cell**.

An `Enum` body rendered below a summary's `{ … }` is now cut to 80 characters
and the count of what was cut is printed in its place:

```
type: Enum<'text' | 'textarea' | 'email' | 'url' | 'phone' | 'password' | 'secret' | … +42 more>
```

The count is the safety property, not decoration. A silent prefix would leave
the page looking complete while it was not — a reader cannot tell a 7-member
vocabulary from the first 7 of 49 — and these pages are the authoritative input
for AI authors (ADR-0033), so a page that lies by omission is a worse defect
than a wide cell.

**Nothing that owns its vocabulary is elided.** The cut applies only below an
inline shape summary, which is by construction a *second* copy: a schema's own
row (`BulkActionParam.type`, `ErrorResponse.code`), a union variant on its own
row (`Enum< … > | string`, the `PageComponent.type` shape), a top-level
`Record< string, Enum< … > >` and an array of a top-level enum all still print
every member. For 457 of the corpus's 805 in-shape occurrences the elided
copy's full list is still on the same page for that reason; for the remaining
348 the count carries it, and the JSON Schema under `json-schema/` remains the
authority it always was.

**The 80 is measured, not chosen.** Across 216 pages / 8541 type cells / 1768
`Enum` occurrences, the 805 in-shape ones are bimodal and their density per
character collapses at 80 (3.6 occurrences/char over `(64,80]`, 1.6 over
`(80,100]`, 0.5 over `(100,200]`). Below it sit the ordinary short vocabularies
a reader wants spelled out; above it sit listings. A tighter budget buys almost
nothing and costs real information — budget 24 would elide 79% of them to save
4% more characters — and a fixed member cap is worse at every setting.

An elision must also **pay for its own marker**: a body only a member or two
over budget gives back less than `… +N more` costs to print, so it is left
whole. That is why 31 in-shape enums between 81 and 107 characters are
unchanged, and why the limit is not a cliff at exactly 81.

42 reference pages change, 144 rows, all in one direction: every changed row is
shorter (462,140 characters removed in total, largest single row -6266), and
every one carries a `… +N more` marker — no row is silently truncated and none
grew. Cells over 900 characters go from 76 to 4, over 200 from 246 to 145;
the p95 cell width is unchanged at 145, i.e. ordinary cells do not move.
