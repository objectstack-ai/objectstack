---
'@object-ui/app-shell': patch
'@object-ui/plugin-view': patch
'@object-ui/data-objectstack': patch
'@object-ui/i18n': patch
---

feat(console): Manage views restores the factory version of a customized package view

Clause-②: yes (widening)
Metadata-protocol: none

A pin, a rename or a set-default on a view a read-only package ships writes the whole view into the package's customization (`<package>.custom`), and every user of the view then sees that copy. Manage views now marks such a view "customized" and offers "Restore factory version" in its `…` menu. After one confirm, which says every user of the view sees the factory version again, the override is removed from the customization and the list shows the package's own view. A view without a customization has no mark and offers no restore; a refused restore is said with the server's own message.

- `@object-ui/data-objectstack`: `ObjectStackAdapter.restoreFactoryView(objectName, viewName)` deletes the view's draft, then its row, at the customization the ensure door names for the shipping package (`DELETE /meta/view/NAME?package=PAIR`, the door Studio's "Restore package original" uses). It refuses, sending nothing, a view that is no override of the package it is served under, and throws when the customization held no row of the view. The customization package itself stays. `listViews()` now carries a record's `overrides` declaration onto the flattened row.
- `@object-ui/plugin-view`: `ViewTabItem.customized` and `ManageViewsDialogProps.onRestoreFactory`.
- `@object-ui/i18n`: the mark, the menu entry, the confirm, its result and the failure title, in every locale pack.
