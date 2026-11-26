---
'@objectstack/spec': minor
'@object-ui/fields': minor
'@object-ui/plugin-form': minor
'@objectstack/metadata-core': patch
'@object-ui/types': patch
---

feat: the form's line-item table edits people, multi-select, tags, check and rating cells the way the main list does

Clause-②: yes (widening)
Metadata-protocol: semantic

`InlineGridColumnSchema.type` (a relationship field's `inlineColumns`, a form view's `subforms[].columns`, and the page blocks that carry the same column) accepts five more cell types, each spelled as its namesake field type: `user` (people), `multiselect`, `tags`, `boolean` (check) and `rating`. The column also takes an optional `max`, the star count of a `rating` cell (default 5).

In the line-item table:

- A `user` cell opens the main list's person picker under the cell: a searchable list with recent people and Clear; a pick writes and closes. `multiple` holds several people.
- A `multiselect` cell holds several of its options and a `tags` cell holds free-form tags. Each opens its searchable list under the cell; a click outside or Tab writes what was picked, Esc writes nothing. A list emptied in the cell writes `null`, as a cleared multi-value field stores, so a line whose only value was removed is still a blank line. A `tags` cell takes no `options`.
- A `boolean` cell is a checkbox: a click or Space toggles it and writes `true` / `false`.
- A `rating` cell draws its stars; a click on a star, or a digit key on the cell, sets it, and 0 clears it.
- Read-only and list-mode cells show people by name, a rating as its stars, a multi-select's option labels, and a check cell as the session's yes/no word.

Visible change on existing forms: a column the table derives from a child field (no `type` written) now follows that field. A `boolean` / `toggle` field becomes a checkbox instead of the yes/no select, and it writes `true` / `false` instead of the strings `'true'` / `'false'` (the server reads both the same). A `rating` field becomes stars instead of a number box. `user`, `multiselect`, `checkboxes` and `tags` fields get their own cells instead of a plain text box that took a typed user id or a single option. A column that writes its `type` is unchanged, a `type: 'select'` column over a boolean field included. Which derived columns are visible by default is unchanged.

The field-level security scrubber classifies the column's new `max` key as kept (a number, never a field name).
