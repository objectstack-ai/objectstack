---
'@object-ui/app-shell': patch
---

fix(console): a design-mode menu rename in the source language over an inline locale-map label keeps the other languages

Clause-②: no
Metadata-protocol: none

A menu entry's label can be written as an inline locale map, for example `{ en: 'Orders', 'zh-CN': '订单' }`. The menu is served with that map as it is stored, so a rename typed in the app's source language goes to the stored label, and the save used to write the new name as a plain string over the whole map: every other language's text was lost from the app. The save now replaces only the entry the editor showed for the session language (`{ en: 'Sales orders', 'zh-CN': '订单' }`), adds that entry when the map has none, and a cleared name drops only that entry. The entry is chosen the way Studio's navigation editors choose it. A plain-string label is replaced by the typed name as before, and where a rename lands (the stored label or a translation) is unchanged.
