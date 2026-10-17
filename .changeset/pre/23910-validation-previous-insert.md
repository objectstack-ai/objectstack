---
'@objectstack/objectql': minor
---

Clause-②: yes (widening)

On insert, `previous` is now bound to `null` in validation rules and in declarative hook
conditions, so a rule or condition that reads it decides the insert — the binding a flow's start
condition already gets on its create leg. Until now `previous` was unbound on insert: any
reference to it faulted `Unknown variable: previous`, and the write was refused (validation) or
aborted (hook) as `unevaluable`. So this widens what an insert can pass: a rule shaped
`previous != null && …` ("judge updates only") now ADMITS the inserts it used to refuse with that
fault, and a field's `requiredWhen: previous == null` now requires the field on insert instead of
refusing every insert. `previous == null || …` judges an insert, `previous != null && …` skips
one. A column read off `previous` on insert (`previous.stage`) still has no value and still
refuses the write; the refusal now names that read and the guard to add.

A violating insert under a rule that reads `previous` now answers with the rule's own message.
The platform's own `validity_window_order` on `sys_user_permission_set` is the measured case: an
inverted grant window answers `400 VALIDATION_FAILED` with "Valid Until must be later than Valid
From …", not a CEL fault.

The binding is the same for every predicate a write evaluates — a `script` / `cross_field`
condition, a `conditional`'s `when`, a field's `requiredWhen` and an option's `visibleWhen` —
and for a hook's `condition` on `beforeInsert` / `afterInsert`; the validate-only preview judges
an insert the same way. Only the CEL binding is `null`: a hook's `ctx.previous` is unchanged. No
shipped rule's verdict changes: every rule and hook this repository ships that reads `previous`
refused and admitted the same inserts before and after; only the refusal's reason moved. A write
to an existing row whose prior state is not in hand keeps `previous` unbound and still fails
closed, so `previous == null` never reads an update as an insert.
