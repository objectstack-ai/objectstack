---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the record page disables Edit when the record's state leaves its edit form nothing to edit

Clause-②: yes (widening)
Metadata-protocol: none

On a record whose every edit-form field is read-only by its `readonlyWhen` (an approved expense claim whose fields declare `readonlyWhen: "record.status == 'approved'"`), the record page's Edit was live and opened a form of read-only values with an active Update that changed nothing. Edit is now disabled there, and a status badge beside the header says why ("Not editable in its current state"), as the approval lock does; the inline-edit pencils follow the same verdict.

The verdict is the edit form's own: the fields the form draws (its system-field pass drops platform-managed, hidden and static read-only fields), each judged by `resolveFieldRuleState` over the stored record and the same predicate scope. Edit stays live as before when any drawn field is writable, when no drawn field is locked by a `readonlyWhen`, when the edit form view declares inline child collections, and when a predicate fails to evaluate.

`@object-ui/i18n` adds one key, `detail.lockedByState`, to every locale pack.
