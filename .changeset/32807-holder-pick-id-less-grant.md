---
'@object-ui/app-shell': patch
---

fix(app-shell): the Assigned users section shows a grant row read with no id without a Remove, never as the grant "undefined"

Clause-②: no
Metadata-protocol: none

A follow-up of objectstack#32774. A `sys_user_permission_set` row read with no `id` has no row for Remove to delete. The Assigned users section used to key such a row as the grant id `"undefined"`, in its holder's rows and in the unresolved block alike. It is now listed with no Remove (and, as a direct grant, without the "held via a position" hint), no delete is ever sent for it, and it never displaces the same user's removable grant.

New pins also cover the Add pick when the server's refusal names one holder (one button, and nothing is sent again until it is clicked) or an empty list of holders (no pick, the server's sentence only). A name with one holder is read and written as before. No server behaviour, permission or security check changes.
