---
'@objectstack/formula': minor
'@objectstack/lint': minor
'@objectstack/service-automation': minor
'@objectstack/spec': minor
---

fix(formula): the `list-equality` refusal prescribes a rewrite that works where it is read, and a flow condition is judged only where the run binds a row of the typed object

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up #36217

The two widenings. A flow condition in a flow that no record write or sweep starts (an API, scheduled or trigger-less flow) is no longer refused as `list-equality`, bare or `record.`: that run holds what its entrance handed it, so `labels == 'frontend'` can be correct code there. And `ExprSchemaHint` gains the optional key `filterCompiled`, which tells the validator that the site's source compiles to a query filter.

The rewrite the refusal prescribes now depends on the site, and is parenthesised whole so it can stand where the comparison stood (`A && (…)`):

- **A `record.` / `previous.` read evaluated as CEL** (a validation rule, a field rule, a formula, an action's `visible` / `disabled` / `pressed`, a hook condition):
  - FROM `record.labels != null && "frontend" in record.labels`
  - TO `(has(record.labels) && record.labels != null && "frontend" in record.labels)`
  - `has()` answers on a sparse row or a null `previous`, where the old form faulted.
  - For `!=` the TO form is `(!has(record.labels) || record.labels == null || !("frontend" in record.labels))`. The old `!=` form, with no parentheses, split under a leading `&&`.
- **A bare name at a flow condition:**
  - FROM `labels == null || !("frontend" in labels)`
  - TO `(labels == null || !("frontend" in labels))`
  - For `==` the TO form is `(labels != null && "frontend" in labels)`.
- **A sharing rule `condition`**, which compiles to a query filter:
  - FROM `record.labels != null && "frontend" in record.labels`, which does not lower (`in` needs a field on its left), so the rule was dropped as `sharing-rule-unlowerable-condition`.
  - TO `(record.labels != null && record.labels.contains("frontend"))`, which lowers to a membership filter (`$contains`).
  - For `!=` the TO form is `(record.labels == null || !record.labels.contains("frontend"))`.
  - A number or boolean operand is passed as its text (`contains("3")`).

One-line fix: write the rewrite the refusal names.

`registerFlow`'s advisory pass now hands the validator `faultOutcome: 'run-fails'` on a record-triggered flow and on a time-relative sweep of the typed object, the same flows `os validate` declares it on. On those flows its logged type-mismatch lines now use the wording `os validate` prints. It still only logs and never throws.
