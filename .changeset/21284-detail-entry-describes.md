---
'@objectstack/spec': patch
---

docs(spec): an `object-master-detail-form` detail entry's `inlineMode` and `formFields` describes say what happens when the key is omitted on both of the renderer's paths (#21284)

Clause-②: no

- **Derived entry** (any entry that does not name both `relationshipField` and at least one column): an omitted `inlineMode` is resolved from the relationship field's `inlineEdit`, else from the child object's shape, and an omitted `formFields` is derived from the child object's fields. This is unchanged.
- **Entry kept as authored** (one that names both `relationshipField` and at least one column): the renderer resolves and derives nothing. An omitted `inlineMode` renders the collection as a grid, which offers the per-row form only when `formFields` lists more fields than `columns`. An omitted `formFields` means the per-row form is offered only when `inlineMode` is `form`, and it then draws the child object's full field list.
- The `inlineMode` describe used to say only "resolved from the relationship field's `inlineEdit` when omitted", and the `formFields` describe only "derived from the child object's editable fields when omitted". Neither holds for an entry kept as authored. The `formFields` describe also no longer says "editable": the derived list keeps `readonly` fields, as `deriveInlineRowFormFields` (`@objectstack/spec/data`) does.
- No schema accepts or refuses anything new. Only the two describes, the reference page that lifts them, and one source comment change.
