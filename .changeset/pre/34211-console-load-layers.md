---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console, app-shell): discovery starts with the session check, and Setup's open no longer reads the whole object registry

Clause-②: no
Metadata-protocol: none

The console asked for `GET /api/v1/discovery` from its main bundle, after the session check had answered and the bundle had downloaded, and the data layer waited for it before the first permission and app reads. `index.html` now sends it during parse, beside `get-session`, and the console's one shared discovery read takes that request, so it is no longer a round trip of its own in the boot.

Opening Setup (the root of an app whose package holds no objects of its own) read the package's empty object list and then the whole object registry. The root now reads as that app's object routes do: the package list, then the objects its entries require (`requiresObject`), and an object the entered app's bundle holds is answered from the bundle without a request. On the showcase app the registry is about 860 KB; Setup's open there now reads two object lists that answer empty instead.

What does not change: the routes that read the whole registry before (a record overlay, a record route with no declared record page) still do; which entries the sidebar shows is unchanged. No metadata key, value or default changes.
