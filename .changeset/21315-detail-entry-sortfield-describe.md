---
'@objectstack/spec': patch
---

docs(spec): an `object-master-detail-form` detail entry's `sortField` and `amountField` describes say what happens when the key is omitted on each of the renderer's paths (#21315)

Clause-②: no

- **Entry the renderer resolves** (any entry that does not name `relationshipField` together with at least one column whose every column has a `type`): an omitted `sortField` is the child object's first field named `position`, `sort_order`, `sequence`, `line_no`, `line_number` or `sort`, and an omitted `amountField` is picked from the grid's number and currency columns. This is unchanged. It includes an entry that names `relationshipField` and columns of which some have no `type`: the renderer keeps that entry's `formFields` and `inlineMode` as authored, but it still derives these two.
- **Entry kept exactly as authored** (one that names `relationshipField` and at least one column, and gives every column a `type`): the renderer derives neither. An omitted `sortField` means the grid stamps no line position, so a drag-reorder is not saved. An omitted `amountField` means the sums read a child column named `amount`, and the grid shows a running total only when `totalField` is set.
- The `sortField` describe used to say only "derived from a `position` / `sort_order` / … field when omitted", which does not hold for an entry kept exactly as authored. The `amountField` describe said nothing about omission.
- No schema accepts or refuses anything new. Only the two describes and the reference page that lifts them change.
