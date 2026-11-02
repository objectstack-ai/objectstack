---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the Studio field panel can turn on a lookup's or user field's `referenceNameVisible`

Clause-②: no
Metadata-protocol: none

The object designer's field panel (`ObjectFieldInspector`) now offers a "Show Name When Unreadable" checkbox on `lookup` and `user` fields, the two types `FieldSchema` accepts `referenceNameVisible` on. Checking it saves `referenceNameVisible: true`, so a reader of the record sees the referenced record's name as plain text when they cannot open that record; clearing it removes the key. On a `lookup` it sits after the picker config; a `user` field, whose target is always `sys_user`, shows the checkbox alone. A retype to any other type removes the key, since the spec refuses it there (`false` included); `lookup` to `user` keeps it. The label and help text match the generic `field` metadata form's row for the same key, in the studio namespace's `en` and `zh` tables. Other field types are unchanged.
