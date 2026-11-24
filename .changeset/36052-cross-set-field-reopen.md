---
'@objectstack/lint': patch
---

feat(lint): warn when another permission set's View All, Modify All or View All Fields re-opens a field one set hides

Clause-②: no
Metadata-protocol: none

A new warning, `security-cross-set-field-reopen`. When one permission set hides a field (`readable: false`) or makes it read-only, and another set holds View All (`viewAllRecords`), Modify All (`modifyAllRecords`) or View All Fields (`viewAllFields`) on the same object (on its own entry for the object, or on its `'*'` entry when it has none), a user who holds both sets still reads the field, and under Modify All still edits it. The warning names both sets and the field. Its fix: drop the bit from the second set, give the second set its own `readable: false` row on the field (this works beside View All and View All Fields, not beside Modify All), say `viewAllFields: true` when the second set really should read every field, or, for a field that must stay hidden from everyone without a capability (a salary, an ID number), declare `requiredPermissions` on the field itself, with a `maskingRule` where a partial value is needed. It is a warning only: nothing that builds today stops building.

Not reported: a field that declares `requiredPermissions` (that gate applies after the permission sets are merged, so no set's bit opens it); a set's own Modify All over its own row, which stays `security-superuser-field-mask-inert`, so one row gets one finding; a second set whose own `readable: false` row on the field keeps it closed beside View All or View All Fields; an edit lock beside View All or View All Fields, which never grant an edit; and a key on an object or field the stack does not declare. Fields are never judged by their name.

`security-wildcard-vama` also reads `viewAllFields` on a package-authored `'*'` entry, as an error like the two record bits: such a set reads every field of every object, other packages' objects included. The key is new in this release, so no stack accepted by a released version is refused. On an object's own entry the bit is not reported. `os explain security-cross-set-field-reopen` prints the full reasoning, and Studio shows the warning in every platform locale.
