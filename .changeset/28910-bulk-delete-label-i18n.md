---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): the built-in bulk Delete reads the grid's translation key

Clause-②: no
Metadata-protocol: none

An object with no declared bulk actions gets the string bulk action `delete`, and the bulk bar drew it from its English name, so it read "Delete" in every language. `useBulkActionItems` now resolves each string action's label once: `delete` reads `grid.delete` from the active pack (删除 under zh), and any other string name is still formatted from itself. The bulk bar's button and the selection's right-click menu both read that label. A declared bulk action keeps its own label, and the action set, the button's position and its colour are unchanged.
