---
'@objectstack/rest': patch
---

fix(rest): the app metadata bundle serves its objects in the object list's order

Clause-②: no
Metadata-protocol: none

`GET /meta/app/{appId}/bundle` listed its objects navigation-first, then the objects that reference them. An inbound object that is also a navigation object kept its navigation place, so a console that derives related lists from the bundle showed them in a different order than over the object list (contact before activities on an account record). The bundle now serves the same objects in the object list's order. Objects the list does not name keep their navigation order after the listed ones.

- **Unchanged.** Which objects, views, pages and dashboards the bundle holds, each member's envelope, the validator and the cache posture. A bundle whose navigation already follows the object list is served byte for byte as before.
