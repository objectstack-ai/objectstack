---
'@objectstack/plugin-security': patch
'@objectstack/service-realtime': patch
---

fix(plugin-security,service-realtime): name the person, not the raw user id, in the `sys_user_position` and `sys_presence` record titles

Clause-②: no
Metadata-protocol: none

Setup's User Positions list, the assignment's record page heading and the audit log's Record cell read `sys_user_position`'s record title, which printed the stored user id (`v34DfZXy… → showcase_exec`). The title now reads the user's name, or their email where the name is blank (`QA Member S2 → showcase_exec`), the same way `sys_user_permission_set`'s title already does. The title is computed when the row is read, so existing rows show the new text with no migration. A reader who may not see that user gets an empty title instead of the user's name. The position half still shows the position's API name.

`sys_presence`'s record title gets the same change and shows the status label: `QA Member S2 (Away)` instead of `usr_… (away)`.
