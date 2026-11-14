---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): a list-only object's rows no longer open a record page that always fails

Clause-②: no
Metadata-protocol: none

**Objects whose data API serves no single-record read.** An object can declare `enable.apiMethods` without `get`, such as `['list']` for the SCIM connection credentials in Setup. The Console still opened a record drawer or page when one of its rows was clicked. That page reads the record with `get`, so it always showed "This record could not be loaded" (`OBJECT_API_METHOD_NOT_ALLOWED`), with a Retry that could never succeed. The Console now reads the object's served operations from `/me/permissions` (`apiOperations`, the set the server already hands down) and opens no record surface for an object whose set leaves `get` out. A row click and a Cmd/Ctrl-click open nothing, the name cell carries no record URL and draws no "Open as full page" arrow, and a `?recordId=` link opens no drawer. This holds on the object list, the object data page and interface list pages. A related-list row of such an object opens nothing, and a lookup value or a record link that points at one renders as plain text. The row menu is unchanged, so its `list_item` actions, such as Revoke on a SCIM credential, stay where they were. An object that serves `get`, or whose served set the Console does not have, opens its records as before.
