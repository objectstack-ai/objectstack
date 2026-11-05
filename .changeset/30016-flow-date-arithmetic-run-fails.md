---
'@objectstack/formula': patch
'@objectstack/lint': patch
---

fix(formula,lint): a date-arithmetic verdict in a flow condition says the run fails, not that the value reads null

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/formula`: four codes join `ExpressionRefusalCode`**: `date-arithmetic-run-fails`, `date-arithmetic-run-may-fail`, `date-text-arithmetic-run-fails` and `date-text-arithmetic-run-may-fail`, with the same params as `date-arithmetic` / `date-text-arithmetic`. A flow condition (a `'flattened'` site) that does arithmetic on a date field used to be told the field "silently evaluates to null", but the engine's `evaluateCondition` throws on the fault on every flow, so the run fails at the condition. Where the caller declares the run proven to hold the field (`faultOutcome: 'run-fails'`, with `bareNamesUnproven` unset) the verdict is served under `-run-fails` and says the run fails; anywhere else in a flow it is served under `-run-may-fail` and says the run fails wherever the name holds the field's date when the condition runs (a flow started by an API call, an action or a parent flow binds what its entrance hands over, which can be a number). The grade is unchanged: an error at every site. A `record`-scoped site (a formula field, a validation rule, a display predicate) keeps `date-arithmetic` / `date-text-arithmetic` and their sentence. A consumer keyed to the old codes on a flow condition re-keys to the new ones.
- **`@objectstack/lint`**: the fault-outcome ledger's docblock names the date verdicts' flow codes; the routing is the existing `faultOutcome` / `bareNamesUnproven` hint, unchanged.
