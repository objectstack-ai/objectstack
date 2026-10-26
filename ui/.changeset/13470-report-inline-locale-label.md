---
'@object-ui/app-shell': patch
---

Clause-②: no
Metadata-protocol: none

A report whose `label` or `description` is an inline locale map (`{ en, 'zh-CN' }`) now opens, and shows both in the viewer's language (objectui#13470).

`@objectstack/spec` types both keys as `I18nLabel`, so the map is valid metadata and is served unchanged, but the report page drew it straight into its heading, the line under it and the report's crumb in the app bar: React refused the object (error #31) and the page was blank for every viewer. A drill on the whole report titled its drawer `[object Object]`. Each of these now resolves the map to the viewer's language with the reader the app's report index already names a report with. A plain-string label or description draws exactly as before.
