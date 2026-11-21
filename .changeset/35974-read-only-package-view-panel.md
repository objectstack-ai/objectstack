---
'@object-ui/app-shell': patch
---

fix(ui): a view a read-only package ships opens a read-only view panel and offers no Manage views writes

Clause-②: no
Metadata-protocol: none

On a list view that ships inside a read-only package (a code or installed package), the admin's view panel ("configure view") now opens read-only: it shows the view's configuration with every control disabled, relays no edit to the list, and offers no Save and no draft publish or discard, only Close. In Manage views such a view's row is read-only too: no pin, no set as default, no rename and no delete, each of which the server refused ("save it into the customization package"). A shared view the console saved into the customization package and the reader's own view are unchanged; the toolbar's personal list changes keep saving to the reader's preferences.

The verdict is the one the footer calculation menu and Rename already read: the package the view row was served under and the server's `writable` verdict for it, from the package list the console holds for the session. While that list is unread, or when the read fails or does not name the package, everything stays offered as before and the server's refusal still applies.
