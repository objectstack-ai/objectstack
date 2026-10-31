---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): a metadata form row the served form marks required holds Save when it is left empty

Clause-②: no
Metadata-protocol: none

A served metadata form row's `required: true` is a layout override, and the type's schema may leave the field optional: the permission set's Label is the case today. The Console drew such a row with a required star only, so the create page saved it empty, because its checks read the schema and the server accepts the body.

Now the metadata create and edit page judges those rows itself, for every metadata type. A row the form offers (in a visible section, not hidden, editable) whose served row says `required: true` and whose value is empty shows "This field is required." at that field, and Save sends no request until it is filled. A row in a collapsed section or another tab still counts; a hidden or read-only row never does, so Save is never held on a field the author cannot fill. A field the schema itself requires keeps the verdict it had before, and a field the schema gives a default is never empty. The server's accept sets do not change.

`SchemaForm` gains an optional `onRequiredRowFieldsChange(fields)` prop that reports those rows.
