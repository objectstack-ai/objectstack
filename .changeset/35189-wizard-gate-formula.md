---
'@object-ui/plugin-form': patch
---

fix(plugin-form): the wizard's final-submit gate judges a `visibleWhen` that reads a formula on the computed value

Clause-②: no
Metadata-protocol: none

`WizardForm` re-checks every declared field when it submits, including the fields on steps the user skipped. The simple form's mobile stepper submits through the same check. That check now computes the object's `formula` fields over the record being written before it judges field rules, the same way the form renderer does (`planObjectFormulas`, ADR-0113). Before, it used the formula value from the last read. So after an edit that moved a required field out of its `visibleWhen`, the wizard still demanded the field even though the server does not require it. After an edit that moved the field into its `visibleWhen`, the wizard sent the save without the field and the server refused it.

The `visibleWhen` of a field that reads a formula the form cannot compute is handled as the step forms handle it: the field counts as shown and keeps its `required` flag. The plan is built from the object schema the wizard already reads. When that read fails, or no data source is given, the gate judges the record as it holds it, as before.
