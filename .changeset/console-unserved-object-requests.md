---
'@object-ui/app-shell': patch
---

fix(app-shell): the console no longer asks for an object or record the boot does not serve

Clause-②: no
Metadata-protocol: none

Three requests that answered 404 on a stock boot are no longer sent; where the object or record is served, each surface behaves as before.

- **A dashboard widget's `requiresObject` is asked in one `GET /meta/object?names=` read**, never by name. The list door answers a name this runtime does not register by leaving it out, so the widget is hidden as before with no 404; on a single-environment boot that is Setup → System Overview's cloud-only `sys_package_installation`, which was a 404 on every open. A served widget object is still read for the route as before.
- **No related list is derived for a child object declared `enable.apiEnabled: false`.** The data API answers every read of such an object's records `404 OBJECT_API_DISABLED` (on the stock boot, `sys_user_device` on a user's record page and drawer). Studio's related-list editor still lists the relationship, flagged hidden.
- **A record deleted from its own record page is not read again.** The page held the record's reads only after the router left it, so the delete re-read its record page payload, field access and approval lock, each answered 404. The page now draws the missing state as soon as the delete of its record lands; any other write to the record still re-reads it in place.
