---
"@objectstack/plugin-sharing": patch
---

fix(sharing): the criteria-less-rule warn is once per rule per process, plus one boot aggregate (#3929 follow-up)

Pre-dedup the fail-closed evaluator warned on EVERY pass — per evaluation and
per reconciled write — so one legacy criteria-less rule could dominate a
deployment's log. Enforcement is unchanged (such a rule still matches
nothing and its grants are revoked on reconcile); the warn now fires once
per rule per process, and the boot backfill emits a single operator-facing
aggregate (count + rule names + the fix: repair the criteria or set
active: false).
