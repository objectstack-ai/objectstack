---
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
---

fix(ui): a view a read-only package ships offers no footer calculation menu and no Rename

Clause-②: no
Metadata-protocol: none

On a list view that ships inside a read-only package (a code or installed package), an admin was offered the footer's calculation menu and the options menu's Rename; the server refuses both saves ("save it into the customization package"), so the pick was taken back with a toast. Neither is offered there now. A shared view the console saved into the customization package, a stored view bound to no package and the reader's own view keep them.

The view's name cannot tell these apart, since every stored view is named `object.key`; the package the row was served under does. `listViews()` in `@object-ui/data-objectstack` now carries the row's served `_packageId` on both of its arms (the `config`-flattening arm dropped it). The console reads the server's `writable` verdict for that package from the package list it already holds for the session, the one the app bar's Studio entries read. While that list is unread, or when the read fails or does not name the package, the menu stays offered as before and the server's refusal still applies.
