---
'@objectstack/spec': patch
---

docs(spec): `record:line_items` `columns` states that an identity-only column hydrates from the child object's field, as on the master-detail carriers, so its heading is the child field's label and translates with it (#24140)

Clause-②: no

`RecordLineItemsProps.columns` said that this block does not hydrate a column from the child object's field, so authors had to declare `label`, `type` and `options` on every column, and an identity-only `{ name }` column was headed by its field name. That contradicted the shared column contract the block takes by reference: `InlineGridColumnSchema.label` says it "defaults to the child field's label via hydration". It also left a declared column heading as a plain string that no translation bundle key reaches, so a non-English print of a line-items table read English headings. The describe now states the carriers' rule in the carriers' words. Identity-only entries (`{ name }`) hydrate everything else from the child object's fields, `label`, `type` and `options` included, so the heading is the child field's label, which translates through that field's own translation. Declaring `type` opts a column out of hydration.

Text only: every input that parsed before parses now, and every refusal is unchanged. The renderer half is objectui's `LineItemsPanel`, which will reuse the same column hydration the master-detail grid uses. Until the console carries it, an identity-only `record:line_items` column still draws as a text cell headed by its field name, so keep explicit labels on columns you need headed today.
