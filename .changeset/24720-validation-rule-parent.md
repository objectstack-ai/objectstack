---
"@objectstack/lint": patch
---

fix(lint): `os validate`, `os build` and the object save door refuse a `validations[]` rule whose predicate reads `parent` (#24720)

Clause-②: no

A `validations[]` rule's predicates — a `script` or `cross_field` rule's `condition`, a `conditional` rule's `when`, and the same slots on the rules nested in its `then` / `otherwise` — are evaluated by the server against `record` and `previous` only. The master-detail header is bound as `parent` for a field's own `readonlyWhen` and `requiredWhen` alone, on an object with exactly one `master_detail`. A rule that read `parent`, such as `parent.status == 'paid'`, still passed `os validate`, because `parent` is a root the platform declares. At runtime the predicate faulted (`Unknown variable: parent`) and every write the rule judged was refused as unevaluable, the seed's own rows at boot included.

The build's expression rule (`validateStackExpressions`) now refuses such a predicate at `error`, located where the rule's other findings are (`object 'NAME' · validation 'RULE'`, `… when`, or the nested rule's label). The message names the slot, the rule and the root. The object save door runs the same pass, so its verdict is the build's finding: the same rule id (`expression-invalid`), location and message.

**Remedy.** To lock or require a field on the header's state, write the predicate on that field's own `readonlyWhen` or `requiredWhen`, where `parent` is bound. For any other check, read a column the detail object declares, and denormalise the header value you need onto the detail.

**Unchanged.**

- The runtime is unchanged: a `validations[]` rule still binds `record` and `previous` and no `parent`. If the runtime comes to bind `parent` there, this refusal is lifted in that same change.
- `parent` on a field's own `readonlyWhen` / `requiredWhen` is still accepted, as before, and so is a `record` column spelled like the root (`record.parent_code`).
- Such a rule could never pass a single write, so no working stack moves. No example or package object in this repository authors `parent` in a `validations[]` rule.
- No public export or signature moves.
