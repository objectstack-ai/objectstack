---
'@object-ui/app-shell': patch
---

Clause-②: no
Metadata-protocol: none

A metadata item's history page now opens the item again from **Back to item**. Outside Studio's "All metadata" area (Setup's datasource history, with or without an active app, and the exported `MetadataResourceRouter`) the link used to resolve against the matched route, so it landed on a type list named after the item, or on a path at the app root, and dropped the query. It now opens `…/metadata/TYPE/NAME` with the query the page was opened with (`?package=`, `?scope=environment`). The Studio area's link is unchanged.
