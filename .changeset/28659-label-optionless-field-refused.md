---
"@objectstack/formula": minor
"@objectstack/lint": minor
"@objectstack/objectql": patch
---

fix(formula,lint)!: a formula whose `label()` names a field that declares no options is refused at author time

`label(record.FIELD)` answers on a field whose definition carries an `options` list; on any other field the evaluator faults on every row, so the formula read `null` forever with a WARN line as the only trace. The `expression-invalid` gate refused `label(record.nope)` (unknown field) and `sqrt(4)` (unregistered function) but admitted `label(record.first)` on a text field. It now refuses that too, at `os validate`, `os build`, `os lint` and the runtime object save door (one evaluation, `runRuntimeAuthoringRules`), in the evaluator's own words: `label(record.first): `first` declares no options, so it has no option label. label() reads a select field's option label; read any other field directly (record.first).`

Clause-②: no (narrowing) — the object save door and the CLI authoring commands refuse a formula whose `label()` argument names a declared field that declares no options, which they stored before. Nothing is widened.

Metadata-protocol: narrowed (a formula field's `expression` may no longer call `label()` on a field that declares no `options`)

<!-- adr-0087: not-required (no-migration-prescription) No key is added, removed or renamed. The refused value never worked: the evaluator faults on that call on every row, so a stored formula of this shape reads null for every reader today, and no conversion could give it a label to read. The refusal names the field and the remedy (read the field directly, or point label() at a field that declares options). -->

**BREAKING** accept-set narrowing at the authoring gate (`@objectstack/formula`, `@objectstack/lint`), shipped as `minor`.

- **Before.** `PUT /api/v1/meta/object/NAME` with a formula `label(record.first)` (`first` a text field), or `label(record.kind) + label(record.first)`, answered 200; every row then read the formula as `null`.
- **Now.** The same write answers 422 `expression-invalid` naming `first`, located at the formula field's `expression`; `os validate` / `os build` / `os lint` report the same finding.
- **Unchanged.** `label()` on a field that declares options (a `select`, `multiselect`, `radio`, any type with an `options` list) is admitted and evaluates as before. The unknown-field and unregistered-function refusals are unchanged and an unknown field gets no second refusal.
- **Who sees it.** An author whose formula calls `label()` on a field without options, a formula that already reads null on every row.

**The remedy.** Read the field directly (`record.first`), or point `label()` at a field that declares `options`.

`validateExpression` gains an opt-in `ExprSchemaHint.optionFields` (the object's option-bearing fields) and the closed refusal-code set gains `label-field-no-options` (`params: { field }`). `declaresOptions(def)` is the one reading of "declares options", exported from `@objectstack/formula`; `@objectstack/objectql` builds `label()`'s map through it and `@objectstack/lint`'s formula pass hands the validator the fields it admits, so the gate refuses exactly the fields the evaluator faults on.
