---
'@objectstack/skills': patch
---

docs(skills): objectstack-formula eval case 4's reference answer names the refused date forms without spelling its own `must_not_contain` strings

Clause-②: no
Metadata-protocol: none

- **Before.** Case 4 of `skills/objectstack-formula/evals/cel-predicates-formulas.json` refuses `new Date(` and `today() + ` in an answer, yet its own `expected_output` spelled both (`` `new Date()` `` and `` `today() + 45` ``), so a reference-grade answer was graded wrong.
- **Now.** The reference answer says "never a JS `Date` / `Date.now()`" and "never date arithmetic on `today()` (it faults)", as case 7 names "the `label` macro". Every assertion and every fact stays: the CEL envelope seed, the determinism gate, `daysBetween(today(), record.close_date)`, the `{}` duration trap. A per-case cross-check (no `must_not_contain` string inside its own `expected_output`, every `must_contain` string present) reports 0 failures over all 7 cases; the file keeps its byte size, so its token-ratchet row does not move.
- No schema, key or behaviour changes.
