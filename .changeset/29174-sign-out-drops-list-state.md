---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): signing out no longer hands your list's filter, search and sort to the next person who signs in

Clause-②: no
Metadata-protocol: none

A list keeps its toolbar state in the URL (`uf__filter`, `uf__search`, `uf__sort`, `uf__group`, quick-filter `uf_<field>` and `uf__tab`). When a session ended, the Console sent the visitor to the sign-in page with a return link built from that whole URL, and the sign-in page follows the link after any successful sign-in. On a shared desk or kiosk browser, the next person to sign in therefore opened the previous user's filtered, searched and sorted list, and their first data request carried it.

The return link now keeps the list's path and every other parameter (a record open beside the list, a tab, a deep link's own query), and drops the `uf_*` list state. The list then opens on the signing-in user's own stored state, or on the view's default. Rows were always read under the signing-in user's own permissions; what changes is that none of the previous user's filter values reach the next user's list, their first data request, or the sign-in page's address bar.

The Console cannot tell an explicit sign-out from an expired session at that point, so both behave the same way. Someone whose session expired and who signs back in returns to the same list with their own saved filter, search and sort; quick-filter chips and a toolbar grouping fall back to the view's. A signed-out visitor who opens a shared link carrying list state lands on that list after signing in, on their own state rather than the link's. An invitation link (`?redirect=/accept-invitation/ID`) is unchanged.
