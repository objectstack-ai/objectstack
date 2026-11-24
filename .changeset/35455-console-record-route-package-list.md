---
'@object-ui/console': patch
---

perf(console): a record page asks its app's object list beside the page list, not after it

Clause-②: no
Metadata-protocol: none

Opening a record page inside an app read the page list first and asked the app's object list only once that answer had landed, so the record's data waited one more round trip than a list page's. Both outcomes of the page list read that object list first, so it now leaves in the same round trip as the page list: the same request, earlier. When the app bundle already says it cannot name the record's related objects (no bundle, a draft preview), nothing is started early, and the record page reads exactly what it read before.
