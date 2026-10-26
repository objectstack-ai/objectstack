---
'@object-ui/app-shell': patch
'@object-ui/components': patch
---

Clause-②: no
Metadata-protocol: none

A page whose `label` or `description` is an inline locale map (`{ en, 'zh-CN' }`) now opens, and shows both in the viewer's language (objectui#13488). A dashboard whose `label` is one no longer blanks its route through the app bar.

`@objectstack/spec` types a page's `label` and `description`, and a dashboard's `label`, as `I18nLabel`, so the map is valid metadata and is served unchanged. The page drew it straight into its own heading, the line under it, and the description a titled `page:header` draws, and the app bar drew a page's or a dashboard's label as the phone bar's title: React refused the object (error #31) and the route was blank for every viewer. Each of these now resolves the map to the viewer's language. A plain-string label or description draws exactly as before.
