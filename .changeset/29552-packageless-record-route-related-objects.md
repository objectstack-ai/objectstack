---
'@object-ui/app-shell': patch
---

perf(app-shell): a record of an app built in the console reads the objects that point at it from the app bundle

Clause-②: no
Metadata-protocol: none

An app created in the console has no package. Opening a record whose object has no declared record page read the whole object registry, so the synthesized page could find the objects that point at the record's object for its related lists: 553 KB of an 888 KB record open on the CRM example. When the app's navigation reaches the record's object, the app bundle already holds every object that points at it, so the route now reads those by name, from the bundle, together with the record's object and its lookup targets. The related lists are the same. The route still reads the registry for an object outside the app's navigation, with no bundle (draft preview, or a host without one), under a record drawer, and in an app that has a package.
