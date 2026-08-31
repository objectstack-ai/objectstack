---
'@objectstack/service-analytics': patch
---

The analytics read-scope compiler (`read-scope-sql.ts`) now refuses an empty `$nin` (`READ_SCOPE_COMPILE_FAILED` / 500) instead of folding it to constant TRUE. An emptied exclusion ("NOT IN () excludes nothing") vacated the whole read scope — every row admitted — on the ADR-0021 lowering, where a widening is scope over-reach; no in-repo producer can emit the shape (the CEL lowering never emits `$nin`, and the RLS guard drops even-polarity empty-`$nin` policies upstream), so the refusal costs no live traffic. Deliberately asymmetric: `$in: []` keeps its ruled constant-FALSE fold (#5322/#5243), which the RLS compiler's inert positive composite — an emptied membership `$or`-ed beside an own-rows grant — depends on.
