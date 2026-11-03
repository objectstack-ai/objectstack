---
'@object-ui/app-shell': patch
---

perf(app-shell): the root of an app built in the console reads the objects its entries require by name

Clause-②: no
Metadata-protocol: none

An app created in the console has no package. Opening its root (`/apps/APP`) read the whole object registry before it landed on the app's first entry: 553 KB on the CRM example. The root now reads, by name, only the objects the app's entries require (`requiresObject`), plus the navigation's objects while the command palette is open, the same names an object route of that app already reads. A root with nothing to ask reads nothing. A record drawer opened over the root still reads the registry for its related lists, and once something else has loaded the registry the root reads from it and asks nothing more.
