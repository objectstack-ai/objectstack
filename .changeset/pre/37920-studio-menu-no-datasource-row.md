---
'@object-ui/app-shell': patch
---

feat(studio): the Studio menu draws no datasource row; a connection is managed in Setup → Integrations alone

Clause-②: no
Metadata-protocol: none

The 平台 Platform group of App Studio's left menu no longer lists Datasources, in any scope (a package, the organization's flows, the cross-package leg), and neither does the ⌘K palette, which lists the menu's own entries. The type stays registered `system`, the 全部类型 All types directory still lists it, and its tile and every `datasource` URL in the area still open Setup's Datasources page.
