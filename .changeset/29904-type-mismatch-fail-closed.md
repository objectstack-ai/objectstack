---
'@objectstack/formula': minor
'@objectstack/lint': minor
'@objectstack/mcp': minor
'@objectstack/spec': minor
---

fix(lint)!: publish refuses a validation rule (or another fail-closed predicate) that orders a text or boolean field against a number, instead of warning that it "evaluates to null" and then refusing every write (#29904)

Clause-②: no (narrowing) — the author-time gate (`os build`, `os validate`, the object save door and the package publish) refuses a `type-mismatch` it used to pass with a warning, at the predicate sites that fail closed. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: registered validation-type-mismatch-refused -->

**BREAKING** accept-set narrowing at the author-time expression gate, served by `os build`, `os validate`, the object save door and `POST /api/v1/packages/:id/publish-drafts`.

- **Before.** `record.name > 5` on a text field, written as a validation rule's `condition`, published with one `expression-invalid` advisory at `severity: warning` saying the expression "silently evaluates to null". A validation rule fails closed, so from then on every create and update whose `name` was not numeric text was refused: `400 VALIDATION_FAILED` "Validation rule 'name_gt' could not be evaluated (runtime: no such overload: dyn<string> > int) — write rejected".
- **Now.** The same rule is refused at publish as `expression-invalid` at `severity: error`, at the rule's `condition` path, with a message that says the write would be refused and how to compare like with like. This is the severity the nullable-comparison verdict (`record.qty > 1000` on a nullable number) already had at the same slot.
- **Which sites.** Those whose runtime refuses the write (or aborts the operation) when the expression faults: a validation rule's `condition` and `when`, nested `then` / `otherwise` rules included; a field's `requiredWhen` and `readonlyWhen`; an option's `visibleWhen` (a write that picks the option); a hook's `condition`. The `validate_expression` MCP tool answers the same for `site: 'validation'`.
- **Unchanged.** A formula field's `expression` keeps the warning: there the fault reads null, which is what the warning says. So do flow conditions (the run fails, the write that fired it lands), a field's display `visibleWhen` / `settledWhen`, field group and action predicates, and `conditionalFormatting`. Sharing-rule conditions compile to a query filter and are not judged by this verdict.
- **`@objectstack/spec`.** The upgrade guide entry `validation-type-mismatch-refused` (a semantic migration: no automatic rewrite, because whether the author meant the length, a number stored as text or another field is a judgement about the rule).
- **`@objectstack/formula`.** `ExprSchemaHint` gains `faultOutcome?: 'fail-closed'`, which the caller sets for a fail-closed site; the `type-mismatch` refusal's `params` carry `outcome: 'fail-closed'` when it is graded an error there.

**FROM → TO.** `condition: 'record.name > 5'` on a text field → `size(record.name) > 5` for its length, `record.score > 5` on a number field for a value, or `double(record.name) > 5` only when every value is numeric text (it faults, and refuses the write, on any other). A boolean: `record.active > 0` → `record.active == true`.
