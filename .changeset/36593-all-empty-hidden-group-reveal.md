---
'@objectstack/spec': minor
'@object-ui/plugin-detail': minor
'@object-ui/types': minor
---

fix(record-page): a field group whose fields are all empty is counted and revealed by "Show N empty fields"

Clause-②: no
Metadata-protocol: semantic

On an object's default record page, a field group the object declares (`fieldGroups`) no longer disappears for good when every one of its fields is empty. Before, read mode drew nothing for such a group, the field list's closing "Show N empty fields" row left its fields out of the count, and pressing the row did not draw them; they appeared only in edit mode. Now the row counts them, and pressing it draws the group in its place, heading and fields. With the row not pressed the page looks as before: an all-empty group draws nothing, not even its heading.

What changed is the meaning of a `record:details` section's `hideEmpty` in read mode: it now hides an all-empty section only while the reader hides empty fields. This holds for an authored `hideEmpty: true` and for the renderer default (an omitted `hideEmpty`), which the default page's declared groups carry. When the reader shows empty fields, through the field list's row or the per-object choice a section's own "Show N empty fields" toggle writes, the section draws like any kept all-empty section. A print page has no toggle and keeps the section hidden. Edit mode is unchanged and still draws every field as an input. A group with at least one value draws exactly as before. An authored `hideEmpty: true` on a `detail-view` section gives way to the reader in the same way: it draws once the reader's remembered per-object choice is to show empty fields. Outside the field list, with no remembered choice (no host preference store, or no object name), the section stays hidden as before. This supersedes the line in the pending `36147-record-field-list` changeset that says an authored `hideEmpty` group "stays hidden and is not counted": on the record page's field list such a group is now counted by the one "Show N empty fields" row and drawn when the reader shows empty fields.

The accepted keys and values are unchanged: `hideEmpty` is still an optional boolean. Its `describe()` in `@objectstack/spec`, the `DetailViewSection` and `record:details` section docs and the `views.zod` describe in `@object-ui/types`, and the `record:details` and `detail-section` input descriptions in `@object-ui/plugin-detail` state the new reading.
