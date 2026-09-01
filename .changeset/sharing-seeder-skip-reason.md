---
'@objectstack/plugin-sharing': patch
---

The sharing-rule seeder's skip WARN now names WHY a declared rule's CEL `condition` did not translate: `compileCelToFilter`'s `reason` (the aggregatable category) and `detail` (the concrete refused shape, variable path, or parse bound) are carried into the log meta instead of being collapsed to `null` one line before the log that needed them. `celToFilter` keeps its published `Record | null` signature and delegates to the new `celToFilterOutcome` sibling (the `plugin-security` rls-compiler shape from #13942, one seam over). Skip semantics are unchanged — an unlowerable or match-all condition is still never seeded as a permissive match-all rule (ADR-0049).
