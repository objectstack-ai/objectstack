---
'@objectstack/runtime': patch
---

fix(runtime): the MCP doc tools name a page's manual in the request's locale

Clause-②: no
Metadata-protocol: none

`search_package_docs` and `read_package_doc` served the page title in the request's locale but the manual's `book.label` in the base language, so a Chinese user was cited "HotCRM Order to Cash Manual" beside a Chinese page title. The manual's label now goes through the translation the `/meta/book` door applies (`books.<name>.label` in the translation bundle), in the same locale the page is served in, and keeps the authored label when the bundle has none. The manual a page opens in, its slug and the address are unchanged.
