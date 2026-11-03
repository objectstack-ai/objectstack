---
'@object-ui/fields': patch
---

fix(fields): an untyped `repeater` field edits its stored rows as JSON in the record form

Clause-②: no
Metadata-protocol: none

A `repeater` field is an untyped array of embedded JSON objects: `@objectstack/spec` declares no sub-field or column member on it. The form's type table sent it to the line-items grid (`field:grid`), which draws only declared columns, so a stored `[{ label: 'one', qty: 1 }, …]` showed numbered rows with Duplicate and Remove buttons and no cell. The content could not be read or changed, and Add line appended an empty object.

`repeater` now resolves to the JSON editor (`field:object`) that `composite`, `record` and `json` already use. The record form shows the stored array as pretty-printed JSON, an edit saves an array of objects (never a string), and unparsable text is refused before the save. Inline editing stays excluded, as before. A line-items grid that declares its columns is unchanged.

The field is no longer laid out full-row in the record form and on the Studio form canvas: the JSON editor is a normal-width widget, like `composite` beside it. The read side (record detail, the list cell's row count) is unchanged. A list that needs typed columns is a child object whose `master_detail` field sets `inlineEdit: 'grid'`.
