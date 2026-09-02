---
"@objectstack/lint": patch
---

fix(lint): consolidate the four hand-copied "Did you mean?" helpers into `object-graph.ts`'s shared `nearestName`/`suggestName` (#14268)

`validate-object-references.ts`, `validate-sortable-fields.ts` and
`validate-widget-bindings.ts` each carried a private `suggest`/`distance` (or
`didYouMean`/`levenshtein`) pair, byte-for-byte re-deriving the same
edit-distance budget `object-graph.ts` already exported on the package barrel
as `nearestName`/`suggestName` — the same drift #4330 fixed one constant over
for `SYSTEM_FIELDS`. All three now import `suggestName` (and `nearestName`
where a rule needs the bare name) from `./object-graph` and their private
copies are deleted.

The one decision the consolidation forced: `validate-widget-bindings.ts`
scored a containment match (e.g. `amount` → `sum_amount`, the ADR-0021
base-column → prefixed-measure-name drift) ahead of edit distance; the other
two rules had no such pre-pass and suggested nothing for the same class of
typo. That containment pre-pass is now `nearestName`'s behaviour for every
caller — it only ever *adds* a suggestion where the edit-distance budget
previously returned none, so a "Did you mean?" hint may now appear where one
was previously absent. The full `@objectstack/lint` suite (93 files / 2812
tests) was run against the pre-change and post-change trees and produced
identical results, so no existing suggestion assertion was affected in
practice.
