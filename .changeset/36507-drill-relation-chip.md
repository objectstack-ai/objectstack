---
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
---

fix(plugin-list): a list's locked chip for a condition on a related record's field names the field and the value, instead of reading `[object Object]`

Clause-②: no
Metadata-protocol: none

A view filter that compares one field of a related record, the nested-relation form `{ crm_account: { industry: 'technology' } }`, now reads as one locked chip on the path `crm_account.industry`: 「Account › Industry: Technology」. The form is read as written and as lowered to `['crm_account', '=', { industry: 'technology' }]`, the shape a dashboard or report drill on a relationship-path dimension hands its list. Before, that chip read the lookup's label and `[object Object]`.

- The lookup's name is its label in the list's own field list. The related field's name and its option labels come from the related object's definition, translated as the list translates its own fields (`fields.<object>.<field>`, `fieldOptions.<object>.<field>.<value>`). Where a label is missing, the raw name shows.
- The row reads the related object's definition once per related object, only while such a chip is shown, through the host's data source.
- A nested condition the chip cannot say as one equality (several fields, an operator, a deeper relation) reads as the view's own condition (「View filter」), never as `[object Object]`.
- Every console locale gains `listConditions.chips.relationPath`.

The chip stays locked: the list cannot edit a related-record condition.
