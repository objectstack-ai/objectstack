---
'@object-ui/app-shell': patch
---

perf(app-shell): a record in a packaged app reads the objects that point at it through the app's package, not the whole object registry

Clause-②: no
Metadata-protocol: none

Opening a record in a packaged app, when its object has no declared record page, read the whole object registry so the synthesized page could find the objects that point at the record's object for its related lists: 561 KB of a 1.58 MB record open on the CRM example. When the app's navigation reaches the record's object, the app bundle already names every object that points at it, so the route now reads the app's package list and, by name, the record's lookup targets and any pointing object from another package (answered from the bundle). The related lists are the same, in the same order. The route still reads the registry for an object outside the app's navigation, with no bundle (draft preview, or a host without one), and under a record drawer.
