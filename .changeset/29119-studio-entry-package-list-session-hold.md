---
'@object-ui/app-shell': patch
---

perf(app-shell): a platform admin reads the package list once per session for the app → Studio entries, not on every app page

Clause-②: no
Metadata-protocol: none

The app bar's Edit app pencil (and the app switcher's Studio row), the sidebar's Design entry and a page's Edit in studio pencil decide whether to draw by reading `GET /api/v1/packages`. That read was repeated on every app page a platform admin opened, and twice on one page when a reader mounted after the first read had settled, although the list is the largest response such a page reads. Those entries now hold the list for the session (the signed-in user and the active organization): an admin's session reads it once, and moving between apps reads nothing. Non-admins still send no such request.

Only these entries hold the list. Studio's own package reads (the switcher, the landing page, the writability gates) still read the server every time.

A held answer stays correct when the list changes: every package write the Console sends forgets it (create and edit, duplicate, the customization pair, the Packages page's publish, revert, discard, delete, adopt, enable/disable and import, and the marketplace install and uninstall), and a package id the held list does not name, such as a package an agent created on the server, is read again once. A writable verdict that changes outside this tab shows its previous posture until this tab writes a package, the session changes or the page reloads; Studio still opens on the verdict it reads itself, and the server's write gate is unchanged.
