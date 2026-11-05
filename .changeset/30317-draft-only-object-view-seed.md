---
'@object-ui/app-shell': patch
---

fix(studio): on a draft-only object, a new or first-edited list view starts from the object's first five fields

Clause-②: no
Metadata-protocol: none

In Studio Interfaces, a list view created on an object that so far exists only as a draft in the package started with no columns. The first edit of a default view that did not exist yet wrote only the column the author touched, and New view with no columns picked wrote none. The list-view panel seeded those columns from the shell's merged objects, which hold published objects only. When the merged definition is missing, the panel now reads the object's drafted definition from this package (`GET /meta/object/:name?preview=draft&package=`, the read the field picker already makes) and seeds from it, so both start from the same first five fields a published object gets. A published object reads nothing new. If the drafted read fails or finds nothing, the seed stays empty as before.
