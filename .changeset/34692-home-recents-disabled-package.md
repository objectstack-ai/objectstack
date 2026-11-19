---
'@object-ui/app-shell': patch
---

fix(console): Home's Recently Accessed leaves out a row whose object is not registered, and never asks that object by name

Clause-②: no
Metadata-protocol: none

Home's Recently Accessed kept a row for a record, an object or a list view whose object's package was disabled after the row was stored. The row opened a page the environment no longer serves, and its icon and label asked `GET /meta/object/NAME` by name, which answered 404 on every Home render.

Now the objects the recent rows name are asked in one `GET /meta/object?names=` read, which leaves an unregistered object out instead of answering 404. A row whose object that read leaves out is not drawn and takes no place among the six rows. Only an object the read answered served is read by name for its icon and label. While the read has not answered, or after it failed, the row is drawn with its stored title or its object's bundle label and its kind's icon, and nothing is asked by name. Once the whole object registry is loaded, Home reads presence from that list. This is the rule a record page's related lists, a dashboard's `requiresObject` widgets and the navigation's `requiresObject` entries already follow.
