---
'@objectstack/skills': patch
---

docs(skills): objectstack-formula evals check that a record name built from a select field reaches for `label(record.kind)`, and that a predicate never calls `label()`

Clause-②: no
Metadata-protocol: none

- **Before.** `skills/objectstack-formula/SKILL.md` teaches `label(record.f)`, but no eval in `evals/cel-predicates-formulas.json` exercised it: an agent authoring a record name from a select field could hand-roll a ternary over the stored value with hard-coded English or Chinese strings, and nothing caught it; nor did anything catch `label()` written into a validation rule, where it faults and aborts every write.
- **Now.** Eval 6 asks for a `contract_version` name built from its `kind` select and expects `label(record.kind)` in an `F` formula, refusing a `== 'clean' ?` ternary. Eval 7 asks for a validation rule and a `visibleWhen` on the same object and refuses `label(` in either, expecting predicates over the stored value. Four sentences in evals 1, 2, 3 and 5 that restated their own `must_not_contain` assertions are gone; every fact and assertion stays.
- No schema, key or behaviour changes.
