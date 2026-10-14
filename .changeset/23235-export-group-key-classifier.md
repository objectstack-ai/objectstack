---
"@objectstack/lint": minor
---

feat(lint): export the dataset dimension leg's group-key classifier, so a consumer asks the lint instead of composing the analytics door's two predicates itself (#23235)

Clause-②: yes

`@objectstack/lint` now exports `groupKeyClassOf(shape)` and its result type `GroupKeyClass`:

- `groupKeyClassOf(shape)` answers "may a dataset or cube dimension group by a column declared this way?". `null` means yes: the column stores one scalar value, and the analytics door serves it as a group key. Otherwise it names the JSON-stored class the door refuses with `400 INVALID_FIELD`: `'structured-json'` (a type in `STRUCTURED_JSON_TYPES`) or `'multi-value'` (`isMultiValueField`: `multiselect`, `checkboxes`, `tags`, or a multi-capable type such as `select` declared `multiple: true`). The two spec predicates are applied in the door's order.
- `shape` is `ValueShapeFieldDef` from `@objectstack/spec/data`, the slice of a field definition the predicates read (`type`, `multiple`). A declared `Field` passes as it is. The classifier reads no object graph: for a dotted path, pass the leaf field's definition.

A consumer that derives dataset dimensions keeps a field as a group key when `groupKeyClassOf(field) === null`, and gets the lint's own verdict. The `dimension-json-stored-field-refused` rule (dataset dimensions and cube dimensions) keeps calling the same function; on the rule's own fixtures, every declared field type with and without `multiple: true` and every column of the cube fixture, the export and the rule agree on the verdict and the class. The rule's findings, paths and texts are unchanged.

No export is removed, and no accepted or refused shape changes.
