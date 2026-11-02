---
'@object-ui/app-shell': patch
---

fix(app-shell): Home asks for the objects it names instead of loading the whole object registry

Clause-②: no
Metadata-protocol: none

Every visit to `/home` read `GET /api/v1/meta/object` (the whole registry, the largest metadata payload of the page) and `GET /api/v1/meta/view`, for a few object names. Now:

- The command palette is mounted from its first open. Opened, it reads its host app's object scope over the objects its navigation lists, without views: the objects its record search reads.
- Outside an app, the activity feeds' `sys_activity` check (`useObjectPresence`) and their roster's capability gate (`useNavMemberGates`) ask their names by name, without views.
- Recent rows (Home's and the palette's) and activity rows read the object each one names, by name (`readObjectsByName`, `useNavTargetLabel({ byName: true })`, `useRecentItemLabel`, `ActivityObjectLabel`). A list-view row reads its object with its views.

Once something has loaded the whole list (inside an app, say), every one of these reads it and asks nothing more. What Home and the palette show is unchanged.
