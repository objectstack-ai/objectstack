---
"@objectstack/formula": minor
"@objectstack/lint": minor
---

feat(formula,lint): advisory type-soundness warnings for formula/predicate expressions (#1928 tier 4)

Closes the last open guardrail from #1928. A `Field.formula` or record-scoped
predicate that uses a **text or boolean field with an arithmetic (`+ - * / %`)
or ordering (`< > <= >=`) operator against a number** faults the runtime
overload and silently evaluates to `null` (e.g. `record.title * 2`,
`record.is_active + 1`). The build now surfaces this as a **non-blocking
warning** with the offending field and a corrective message.

Honours the ADR-0032 design law — the checker only flags what the runtime
would also fail:

- Number / currency / percent / date / datetime fields are declared `dyn`, so
  the cases the runtime rescues never warn — `record.amount / 100` (the #1930
  `registerOperator` fix), `record.due == today()` and numeric-string / ISO-date
  values (the string-hydration retry), and numeric-coded `select` option values.
- Equality (`==` / `!=`) is excluded: a heterogeneous equality is runtime-safe
  (evaluates to `false`), never a fault.

New `firstTypeMismatch` export in `@objectstack/formula` (and an optional
`fieldTypes` hint on `validateExpression`); `@objectstack/lint`'s
`validateStackExpressions` threads each object's field types into every
record-scoped site (formula fields, validation rules, action / hook / sharing
predicates). Warnings are advisory in `objectstack build` / `validate`
(fatal only under `--strict`), matching the tier-3 channel.
