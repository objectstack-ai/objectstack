---
'@object-ui/app-shell': patch
---

fix(app-shell): inside a package's second app, the sidebar and the `nav:menu` block link into that app

Clause-②: no
Metadata-protocol: none

`/apps/SEGMENT` opens a package's first app when SEGMENT is the package id, and a package can ship more than one app. The sidebar built every entry link, and the route its area election reads, on the package id, so inside a package's second app a click on any entry opened the first app. The `nav:menu` page block built its links the same way. Both now build on the app's one address among the metadata app list (`appAddressSegment`, the address the app page resolves its own links with): the package id when it reaches the app, else the app's name. A package's first or only app keeps its package-id links unchanged.
