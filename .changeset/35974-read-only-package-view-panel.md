---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/plugin-view': patch
'@object-ui/i18n': patch
---

fix(ui): a view a read-only package ships hides only Delete in Manage views and opens its view panel read-only

Clause-②: yes (widening)
Metadata-protocol: none

This applies to a list view that ships inside a read-only package (a code or installed package). The console no longer offers that view the two writes the server refuses:

- Manage views hides Delete on its row.
- The row's configuration entry reads "View config". It opens the admin's view panel read-only: the configuration is shown read-only, no edit reaches the list, and there is nothing to save. The panel has no Save, no draft bar to publish or discard, and only Close.

Rename, pin and set as default stay offered. They land in that package's customization (the console creates it on first use), so no lock icon is drawn on the row. The list's options menu offers Rename on such a view again. A shared view the console saved into the customization package, and the reader's own view, are unchanged. The toolbar's personal list changes keep saving to the reader's preferences.

`@object-ui/plugin-view`: `ViewTabItem` gains an optional `definitionReadonly` field. When it is `true`, `ManageViewsDialog` hides Delete and labels the configuration entry "View config" (`view.showViewConfig`, a new key in every locale of `@object-ui/i18n`). Rename, pin, set as default and the configuration entry stay. `readonly` still wins when both are set. Without the field a row behaves as before. `ViewTabBar` does not read it.

The read-only verdict is the one the footer calculation menu already uses. The console takes the package the view row was served under and reads the server's `writable` verdict for it from the package list it holds for the session. While that list is unread, or when the read fails or does not name the package, everything stays offered as before and the server's refusal still applies.
