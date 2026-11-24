---
'@object-ui/plugin-grid': patch
---

feat(plugin-grid): a row's "⋮" menu and its right-click menu follow the object's `actionLayout.record` order

Clause-②: no
Metadata-protocol: none

On an object whose served `actionLayout` carries a `record` arm, the actions a row's "⋮" menu and its context menu list (and the one-record menu of the list page's selection bar, which reads the same plan) now come in the arm's order: the actions `pinned` names first, then the ones `more` names, each in the arm's order, then every other action in the order the menus used before (primaries above secondaries, each in declared order). Which primary the row draws as its inline button, and where the built-in Edit and Delete sit, are unchanged. An object with no `record` arm lists exactly as before.
