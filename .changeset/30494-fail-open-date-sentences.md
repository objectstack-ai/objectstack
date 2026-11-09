---
'@objectstack/formula': patch
---

fix(formula): an advisory validation rule's date verdict says the rule is skipped and the write proceeds

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/formula`: two codes join `ExpressionRefusalCode`** (`EXPRESSION_REFUSAL_CODES`), with the params of the code each splits from: `date-arithmetic-fail-open` and `date-text-arithmetic-fail-open`.
- On an advisory (`severity: 'warning'` / `'info'`) validation rule (`faultOutcome: 'fail-open'`), date arithmetic used to be told "this faults at runtime, so the field silently evaluates to null". There is no field there, and nothing reads null: the rule is skipped and logged, and the write proceeds. The verdict now closes on the sentence `type-mismatch-fail-open` already uses for that outcome. This replaces the earlier note that an advisory rule keeps `date-arithmetic` / `date-text-arithmetic`.
- A formula field keeps `date-arithmetic` / `date-text-arithmetic` and the null sentence. A consumer keyed to the old codes on an advisory rule re-keys to the new ones.
- The grade is unchanged: the verdict is an error, as before. What is refused, warned or passed is unchanged.
- `@objectstack/lint` and `@objectstack/mcp` `validate_expression` already pass `faultOutcome: 'fail-open'` for an advisory rule, so both serve the new sentence with no change of their own.
