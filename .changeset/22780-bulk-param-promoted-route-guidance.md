---
'@objectstack/spec': patch
---

fix(spec): the bulk action param's rejection text names the promoted field-backed route instead of saying the bulk surface has none (#22780)

Clause-②: no

`BulkActionParamSchema` still refuses `field`, and the widget-config keys, on an authored `bulkActionDefs[].params` entry. An authored param reaches the bulk dialog as written, and nothing on that path resolves it against the object's field definitions. What changed is the reason and the remedy in two rejection messages, which said the bulk surface has no field-backed param route at all. The console now has one. An action the object declares, named in a list view's `bulkActions`, is promoted with its params, and a field-backed param on it (`{ field }`, plus `objectOverride`) is resolved through the single-record dialog's resolver when the bulk dialog opens.

- **`field`.** The rejection now offers two fixes. Declare the param inline (`name` + `type`, plus `object` and optionally `labelField` for a picker). Or declare the action on the object with the field-backed param and name it in `bulkActions`. The promoted form runs the action once per selected record.
- **Widget-config keys** (`min`, `max`, `step`, `accept`, `lookupFilters` and the rest of that family). The rejection states what the promoted route carries from the field: `type`, `label`, `options`, `required`, `description` (as the help text), `placeholder`, `defaultValue`, `multiple`, `accept` and `maxSize`, plus a reference field's `reference`, `displayField` and `dependsOn`. Of the refused keys, only `accept` and `maxSize` reach the bulk dialog that way. `lookupFilters`, `lookupColumns`, `lookupPageSize` and `descriptionField` are dropped on the bulk path, and the rest are never read off the field.

Nothing to migrate: the accepted and refused keys are unchanged. Only the text of the two rejection messages, and two source comments, moved.
