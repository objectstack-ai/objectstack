---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): an object the presence read served is not read again by name

Clause-②: no
Metadata-protocol: none

A list page whose object has a lookup to an object outside the app's package (on the showcase, `sys_user`) asked for that object twice: first in the `GET /api/v1/meta/object?names=` presence read, which already answers with the object's definition, and then by name (`GET /api/v1/meta/object/sys_user`) about 0.7 s later. The by-name read now takes the definition from the presence read when that read served it, so the lookup target costs one request. The same holds for the objects an app's entries require (`requiresObject`) and a dashboard's widget objects, which were also asked by name after their presence read had served them.

What does not change: a name the presence read left out is still asked by name, so an object that is refused (`OBJECT_PACKAGE_DISABLED`) is still told apart from one that does not exist. A name the presence read has not answered yet is still asked by name. The draft preview still reads every object by name. The definition a scope holds is the same document the by-name read returned. No metadata key, value or default changes.
