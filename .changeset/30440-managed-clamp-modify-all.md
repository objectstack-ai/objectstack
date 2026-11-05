---
'@objectstack/core': patch
---

fix(core): effective object permissions on a guarded managed object grant no edit, delete or transfer the write guard refuses, `modifyAllRecords` included

Clause-②: yes (widening)
Metadata-protocol: none

The managed write clamp behind `/auth/me/permissions` and `ISecurityService.getEffectiveObjectPermissions` cleared `allowEdit`, `allowCreate` and `allowDelete` on an object in a guarded `managedBy` bucket (`better-auth`, `engine-owned`, `append-only`) that does not opt the verb in through `userActions`, but left two grants the write guard refuses:

- **`modifyAllRecords`**, which grants edit, delete and transfer on its own. A permission set naming such an object with `{ modifyAllRecords: true }` made `current_user.can(object, 'edit' | 'delete' | 'transfer')` answer `true` while every one of those writes was refused. It is now lowered to `viewAllRecords` (the read it implies, so read is unchanged), and each verb the object still opts in is kept as its plain bit: an object opting `edit` in keeps edit and transfer and loses delete. An object opting both `edit` and `delete` in keeps `modifyAllRecords`.
- **`allowTransfer`**, which now follows `edit`: an owner change is an update, refused unless `edit` is opted in. This also corrects a super-user wildcard admin, who was answered `can(object, 'transfer')` `true` on every guarded object.

No write changes: the guard refused each of these before and still does. Only the served capability answer, and the console buttons that read it, now match it.
