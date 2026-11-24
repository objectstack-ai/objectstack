---
'@object-ui/app-shell': patch
---

fix(studio): a view's conditional formatting rule that compares a list field with a single value is refused while typing

Clause-②: no
Metadata-protocol: none

A formatting rule such as `record.tags == 'vip'` on a list field (`multiselect`, `checkboxes`, `tags`, or a `select` / `lookup` / `user` declared `multiple: true`) compares a list with a single value, so it never matches any row and the style never shows. The conditional formatting editor accepted it without a word. It now hands the lint the object's field types and `multiple`, as the field inspector's condition editors already do, so the rule is flagged while the author types, with the membership rewrite (`'vip' in record.tags`), and counts as a blocking issue for Save. Both places the editor appears do this: the view inspector in the metadata admin and the list-view panel in Studio. A membership test on the same field, and `==` on a single-value field, stay clean.

`ConditionalFormattingEditor` takes an optional `fieldDefs` prop (each field's name, `type` and `multiple`); omitted, the lint is what it was before. What the server accepts on save is unchanged.
