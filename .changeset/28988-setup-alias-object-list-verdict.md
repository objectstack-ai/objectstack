---
'@object-ui/app-shell': patch
---

fix(console): a caller the Setup app refuses gets "You don't have access to this app" on an object list spelled with the `setup` alias, as on the package-id spelling, instead of the list inside another app's shell

Clause-②: no
Metadata-protocol: none

`/apps/setup/OBJECT`, `/apps/setup/OBJECT/view/ID` and `/apps/setup/OBJECT/data` (and the legacy `/apps/setup/system/users`, which forwards onto the first) now wait on the Setup app's access verdict, the way Setup's root, metadata, settings and marketplace routes already did. A member the server refuses the Setup app sees the access-denied screen there, as on `/apps/com.objectstack.setup/OBJECT`; before, they saw the object list under the default app's header and sidebar while the address bar read `setup`. The server's data reads are unchanged, and so is everything an admitted caller sees. Record pages under the Setup segment (`/apps/setup/OBJECT/record/ID`, the address the approvals inbox links to) stay reachable as before.
