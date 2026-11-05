---
'@objectstack/formula': patch
'@objectstack/lint': patch
'@objectstack/mcp': patch
---

fix(formula,lint,mcp): a fail-closed date verdict says the write is refused, and a time-relative sweep's run-fails verdict names no firing write

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/formula`: three codes join `ExpressionRefusalCode`** (`EXPRESSION_REFUSAL_CODES`), with the params of the code they split from:
  - `date-arithmetic-fail-closed` and `date-text-arithmetic-fail-closed`. On a site that fails closed (`faultOutcome: 'fail-closed'`: an `error` validation rule, a field `requiredWhen` / `readonlyWhen`, an option `visibleWhen`, a hook `condition`), date arithmetic used to be told "this faults at runtime, so the field silently evaluates to null". There the fault refuses the write instead, and the verdict now says so. A formula field and an advisory (`warning` / `info`) validation rule keep `date-arithmetic` / `date-text-arithmetic` and their sentence. A consumer keyed to the old codes on a fail-closed site re-keys to the new ones.
  - `type-mismatch-sweep-run-fails`. A time-relative sweep of the typed object is graded `run-fails` like a record-triggered flow, but no write fires its run: the sweep starts one run per row it finds. Its condition's text-vs-number verdict used to say "the write that fired it still lands". Served where the new optional `ExprSchemaHint.timeRelativeSweep` is set beside `faultOutcome: 'run-fails'`, it now says the run for that row fails and nothing else happens. A record-triggered flow keeps `type-mismatch-run-fails` and its sentence.
- The grade is unchanged at every site. What is refused, warned or passed is unchanged.
- **`@objectstack/lint`**: the flow walk passes `timeRelativeSweep` on a `time_relative` flow. The nullable-comparison verdict, which also says "still lands", runs on record-triggered flows only, so it is unchanged.
- **`@objectstack/mcp`**: `validate_expression` with `site: 'flow_condition'` and `triggerKind: 'time_relative'` passes the same key, so its answer stays the gate's.
