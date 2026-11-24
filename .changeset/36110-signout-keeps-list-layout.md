---
'@object-ui/auth': patch
---

fix(auth): signing out keeps the list layout for the same person; a change of user still clears it

Clause-②: no
Metadata-protocol: none

Column widths, row height and tab order are kept only in the browser, so the sign-out purge (`purgeSignedOutUserClientState`, run by `AuthProvider` on `signOut()` and on every session read that answers "no session", including a session that ended on its own) reset every list at every sign-out. It now keeps the list layout: `localStorage` keys starting `list-layout:` (written by `@object-ui/app-shell`) and `grid-columns-` (the grid's own copy of column widths and order, also used by a record page's related tab). An entry is kept only while it holds that layout and nothing else: view ids, field names, widths and a row height. An entry holding anything more, such as a filter, a search term or record data, is removed like any other key. These keys are kept only in `localStorage`; the same keys in `sessionStorage` are still removed.

A different person signing in on that browser still clears everything (`purgePreviousUserClientState` keeps none of these keys), so their lists open at each view's defaults. Nothing changes for an app that writes no keys under these prefixes.
