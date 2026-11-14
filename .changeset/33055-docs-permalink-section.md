---
'@object-ui/console': patch
---

fix(console): a docs cross-link to a section keeps its `#section` through the flat-permalink redirect, and the page scrolls to it

Clause-②: no
Metadata-protocol: none

A cross-reference written against a doc's flat permalink (`/_console/docs/NAME#section`) was redirected to the canonical in-book URL (`/_console/docs/BOOK/NAME`) without its fragment, so the doc opened at its top. The redirect now keeps the fragment, as do the name-prefix fallback redirect and the redirect from a book's name to its slug. The doc page scrolls the named heading into view once the doc has rendered, the same scroll an in-page anchor click gives, whether the URL arrived through a redirect, a cross-reference or the address bar. A URL with no fragment still opens at the top.
