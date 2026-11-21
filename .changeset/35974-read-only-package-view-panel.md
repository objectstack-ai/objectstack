---
'@object-ui/app-shell': patch
'@object-ui/plugin-view': patch
'@object-ui/i18n': patch
---

fix(ui): a view a read-only package ships opens a read-only view panel and offers no Manage views writes

Clause-②: yes (widening)
Metadata-protocol: none

On a list view that ships inside a read-only package (a code or installed package), the admin's view panel now opens read-only. It shows the view's configuration with every control disabled and relays no edit to the list. It offers no Save and no way to publish or discard a draft, only Close. In Manage views the same view's row is read-only: no pin, no set as default, no rename and no delete, each of which the server refused ("save it into the customization package"). Its menu keeps one entry, "View config", which opens that read-only panel. A shared view the console saved into the customization package and the reader's own view are unchanged. The toolbar's personal list changes keep saving to the reader's preferences.

`@object-ui/plugin-view`: `ViewTabItem` gains an optional `readonlyConfigViewable` field. It is read on a `readonly` row only: `ManageViewsDialog` then keeps the row's configuration entry, labelled "View config" (`view.showViewConfig`, a new key in every locale of `@object-ui/i18n`), and leaves every other mutation hidden. Without the field a read-only row offers no configuration entry, as before, and a mutable row ignores it. `ViewTabBar` does not read it.

The read-only verdict is the one the footer calculation menu and Rename already use. The console takes the package the view row was served under and reads the server's `writable` verdict for it from the package list it holds for the session. While that list is unread, or when the read fails or does not name the package, everything stays offered as before and the server's refusal still applies.
