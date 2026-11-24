---
'@object-ui/plugin-detail': patch
'@object-ui/types': patch
'@objectstack/spec': patch
---

fix(plugin-detail): an authored record page folds its all-empty field groups into one closing line, as the default page does

Clause-②: no
Metadata-protocol: none

On a record page you author, the details body (`record:details`) used to draw every field group the page keeps with `hideEmpty: false` as its own bordered card, even when every field in it was empty: a card holding nothing but its heading and one "Show N empty fields" row. A new opportunity on such a page showed two of these, one per empty group.

Now every `record:details` body does what the default record page already did. The groups whose fields are all empty leave their places, and the body ends in one quiet line that names them, for example "Deal Narrative · Notes & Next Steps · 2 empty sections · Expand". Expanding the line draws each group in its own place, as its heading plus its "Show N empty fields" row, and from there the fields can be shown and edited in place. "Collapse" folds them back.

What does not change:

- A group with at least one value draws as before, its own "Show N empty fields" row included.
- `hideEmpty` keeps its default. An omitted key still hides an all-empty group outright, and such a group is not named in the line.
- Edit mode draws every group with every field as an input, and a print page prints every row.
- A standalone `detail-view` keeps one section per group, and still folds a body whose groups are all empty into one "Show N empty fields" row.

No metadata key, value or default changes. The `@objectstack/spec` `describe()` of `record:details` `sections[].hideEmpty`, the `@object-ui/types` docs and the component manifest now describe the closing line.
