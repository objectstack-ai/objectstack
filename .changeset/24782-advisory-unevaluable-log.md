---
'@objectstack/objectql': patch
---

fix(objectql): an advisory validation rule that cannot be evaluated logs one line saying the write proceeded, not two saying it was rejected (#24782)

Clause-②: no (log text only: no response, status, code, outcome or export moves)

A `severity: 'warning'` or `'info'` validation rule whose predicate cannot be evaluated never blocks the write. Only `error` rules fail closed (#4649). The write answers 2xx and the row persists. The server log said the opposite, twice. The predicate evaluator logged "— write rejected: a rule that cannot be evaluated fails closed, it is never skipped" before the rule's severity was consulted. Then the advisory per-write line repeated the unevaluable violation's own message, which also ends "— write rejected.".

Such a rule now logs ONE line: `Validation rule 'NAME' (warning): the rule could not be evaluated (FAULT) — write proceeded: the rule is advisory, so it was not applied to this write`. This covers a `script` / `cross_field` condition, a `conditional`'s `when`, and the relationship-traversal refusal. On the seed / boot path the same text folds into that load's advisory summary line, which keeps its shape.

Unchanged: an unevaluable `error` rule is refused with the same `400 VALIDATION_FAILED` body, and its log line still says the write was rejected and the rule fails closed. Which rules block is unchanged. An unevaluable rule still stays out of a write answer's `warnings`. `requiredWhen`, `readonlyWhen` and the option `visibleWhen` gate still refuse on every severity.
