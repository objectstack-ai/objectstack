---
'@objectstack/formula': patch
---

fix(formula): a flow value envelope's date-text refusal says the run fails when the value is computed, not when a condition runs

Clause-②: no
Metadata-protocol: none

A flow value envelope (an `assignment` value, or a `create_record` / `update_record` `fields.*` value) that hands a `date` field's text to a call it cannot take (`timestamp(record.borrow_date)`) or does arithmetic on it (`record.due_date - record.borrow_date`) is refused by `os validate` and by `registerFlow`. The refusal reused the flow-condition sentence: "this faults wherever `record.borrow_date` holds that text when the condition runs, and a flow condition that cannot be evaluated fails the run: the flow stops at this condition …". A value slot has no condition. It now reads "… when the value is computed, and a flow value that cannot be computed fails the run: the flow stops at this step and the work the flow exists to do is not done (it does not read null)."

- **Two codes join `ExpressionRefusalCode`** (`EXPRESSION_REFUSAL_CODES`), with the params of the code each splits from: `date-text-call-value-run-may-fail` (params of `date-text-call`) and `date-text-arithmetic-value-run-may-fail` (params of `date-text-arithmetic`). `validateExpression` serves them where `ExprSchemaHint.flowValueEnvelope` is set, in place of `date-text-call-run-may-fail` / `date-text-arithmetic-run-may-fail`. A consumer keyed to the old codes on a value envelope re-keys to the new ones.
- **Unchanged:** the same sources are refused, at the same grade (an error), at the same location, with the same leading value-envelope sentence and the same fix hint. A flow condition keeps `date-text-call-run-may-fail` / `date-text-arithmetic-run-may-fail` and `-run-fails`, byte for byte.
