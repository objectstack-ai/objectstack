---
'@object-ui/core': minor
'@object-ui/fields': minor
'@object-ui/app-shell': minor
'@objectstack/spec': minor
---

feat(ui): an action param's `widget` draws the named widget in the action dialog — `widget: 'permission-ref'` on a `text` param is the permission-set picker

Clause-②: yes (widening) — `@object-ui/core`'s exported `ActionParamDef` gains one optional member, `widget?: string`; `@object-ui/fields`' `RawActionParam` gains the same optional member. No accepted key, value or answer is taken away.
Metadata-protocol: semantic

`ActionParamSchema.widget` (declared by `@objectstack/spec` with the same key, vocabulary and meaning as `FieldSchema.widget`) was accepted and stored but read by nothing: the action dialog drew every param with its `type` widget. The console now reads it:

- `resolveActionParams` copies the param's `widget` onto the resolved param. A field-backed param (`{ field }`) that inherits the field's `type` also inherits the field's `widget`; a param that overrides `type` does not, because the field's widget was chosen for the field's value. The param's own `widget` always wins.
- `paramToField` draws the named widget when it is registered, in place of the `type` widget. A name nothing registers keeps the `type` widget (a `textarea` param stays a textarea), and a registered widget on a lookup param without a target is drawn instead of the plain record-id text box.
- So `{ name: 'permissionSet', type: 'text', widget: 'permission-ref' }` opens the permission-set picker: the sets are listed by label beside their machine name, and the machine name is submitted. The server still validates the value by `type`, so the request body is unchanged.

The spec's liveness ledger marks `params.widget` live, and its `.describe()` no longer says the key is not read yet.
