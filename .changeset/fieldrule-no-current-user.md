---
"@objectstack/spec": patch
---

docs(spec): field- and section-level `visibleWhen` stop advertising `current_user` (#6146)

`FormField.visibleWhen` and `FormSection.visibleWhen` documented their runtime
binding root as "`record` + `current_user`". The second half was never true at
that level, and the failure mode is silent:

- FROM: "Root: `record`+`current_user` (runtime forms) or `data` (metadata forms)"
- TO: "Root: `record` (+ `previous`, `parent`) in runtime forms, or `data` in
  metadata forms" — plus an explicit note that `current_user` is **unbound** here.

Field- and section-level rules are evaluated by `evalFieldPredicate` /
`resolveFieldRuleState` in `@object-ui/core`, which binds `record`, `previous`,
and an `extra` scope (`parent`, for master-detail line items) — nothing else.
Every production call site passes no user scope, and objectui#1582 pins the same
set for the authoring autocomplete (`FIELD_RULE_ROOTS = ['record','previous','parent']`,
commented "nothing else (no `current_user`)").

Why this mattered more than a wording slip: an unbound identifier makes the
evaluation fault, and every fault resolves to the caller's fallback — which for
visibility is `true`. So a predicate written exactly as the spec described it
(`'admin' in current_user.positions`) does not hide the field, it makes the
field **permanently visible**. Authors following the documentation got the
inverse of what they wrote, on the surface where the mistake is least visible.

`current_user` remains documented, and remains correct, for **per-option**
`visibleWhen` (`SelectOption`): options resolve through a different evaluator,
`resolveCascadingOptions` against the host's predicate scope, which does bind it
(ADR-0068 / objectui#2284). That JSDoc previously claimed the per-option
environment was "the SAME binding environment as field-level `visibleWhen`" —
the very equality that is false — so it now states the asymmetry instead of
asserting it away.

Documentation only: no schema, validation, or runtime behaviour change. Authors
whose field-level predicates reference `current_user` should know those
predicates are already faulting open today; this change does not alter that, it
stops the spec from recommending it.
