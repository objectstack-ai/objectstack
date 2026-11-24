---
'@objectstack/lint': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(lint, studio): warn about a required field's `visibleWhen` formula read only when the form cannot compute the formula

Clause-②: no
Metadata-protocol: none

A `required` field whose `visibleWhen` reads a `formula` field used to draw a warning from `os validate` (and the object save door) and an advisory in Studio's field inspector for every formula it read. The form now computes the object's formulas over the record being edited, so for a formula it can compute the form and the server judge the same value, and that warning named no real problem. Both now fire only for a formula the form cannot compute:

- **The server cannot compute it either.** The formula reads through a reference, calls `label()` or `current_user.can()`, or reads such a formula. The server counts the field as shown, so it stays required on every record. Same verdict as before, now stated on its own.
- **Only the form cannot compute it.** The formula reads `os`, or reads such a formula. The server computes it and can waive the field where the form still shows it and keeps it required. Before this change such a formula drew only the generic warning, which said the form computes it.

Either message now says that the form's half holds for a form that computes the object's formulas. A form check that computes none judges the value it last read, and can hide the field or not ask for it.

A formula that reads the acting user draws nothing, as before. Both sides compute it for a signed-in writer.

Studio catalogue (en, zh): `designer.field.requiredVisibleWhenFormula` is removed. `designer.field.requiredVisibleWhenFormulaUnservable` is now a full sentence on its own. `designer.field.requiredVisibleWhenFormulaFormOnly` is new. The lint rule's location and severity (warning) are unchanged. No props or exports change.
