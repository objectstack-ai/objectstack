---
'@objectstack/spec': patch
---

Correct the `$search` expansion description: it compiles to `$icontains`, not `$contains`

The `DriverCapabilities.fullTextSearch` tombstone prescription in `driver.zod.ts` said
`$search` is compiled into "an `$or` of `$contains` predicates". It has compiled to
`$icontains` since #7641 — textual search is case-insensitive by ruling, and `$contains`
is contractually case-**sensitive** (#4706 Q2 = A). The prescription now says so, and the
four generated driver reference rows it feeds regenerate with it.

The same false sentence is corrected on the three hand-written pages that carried it
(`protocol/objectql/query-syntax.mdx`, `data-modeling/queries.mdx`,
`data-modeling/schema-design.mdx`), including a callout that told readers the
case-insensitivity question "remains a separate open question" when #7641 closed it.

Documentation only — no accept/reject, emitted-shape or runtime behaviour change.
