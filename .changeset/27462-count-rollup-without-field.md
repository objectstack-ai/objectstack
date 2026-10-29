---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(spec): a count roll-up saves without `summaryOperations.field`

Clause-②: yes (widening)
Metadata-protocol: none

The description of `summaryOperations.field` always said it is ignored for `count`, yet the schema required it for every function, so a count roll-up with no child field was refused (`422 INVALID_METADATA` at `fields.<name>.summaryOperations.field`, "expected string") and Studio's author had to pick an arbitrary child field to save one. The schema now follows its own description:

- **`count` may omit `field`.** A count counts the matching child rows and reads no field, so `{ object, function: 'count' }` parses and saves as written. A count that carries a `field` is still accepted, and the field is still ignored.
- **Every other function still needs it.** `sum`, `min`, `max` and `avg` without `field` are refused at `summaryOperations.field`, and the message names the function and the fix: name the child field to aggregate, or use `function: 'count'`.
- **One rule, read twice.** `summaryFunctionReadsField(fn)` (exported from `@objectstack/spec/data`) is where "does this function read a child field" is written. The schema's refusal reads it, and Studio's roll-up editor reads it: for a count the editor offers no "Child field to aggregate" control, only a note that a count needs none, and saves the roll-up without `field`.
- **The engine counts it.** The roll-up index carries no source field for such a count (`SummaryDescriptor.sourceField` is now optional), and the recompute and bulk-insert paths count child rows without reading one, as they already did for every count.
- **Published JSON Schema.** `summaryOperations.field` is no longer in `required`; the "required unless `count`" rule is a refinement the JSON Schema does not state, so `summaryOperations` joins the dropped-refinements ledger at each schema that embeds a field.
- **Metadata forms.** The `field` sub-row of the roll-up composite (field editor and object quick-add grid) is no longer marked required; its help text, "ignored for count", is unchanged.
