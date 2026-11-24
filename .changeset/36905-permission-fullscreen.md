---
'@object-ui/app-shell': patch
---

feat(studio): a permission set opens full-screen at its metadata address; the record-visibility overview gets its own route

Clause-②: no
Metadata-protocol: none

A permission set in Studio now opens at its own address, `/studio/PACKAGE/metadata/permission/NAME`, full-screen beside the left menu, instead of the Access pillar's rail and workbench. The header is the one every full-screen item page has: × back to the list of sets (its filters kept), ‹ › through it, the set's label (its machine name on the title's tooltip), type and package, and a ⋯ menu. The Access pillar's own page and its list of sets are gone. The tab row is the matrix's five sections (Objects, System capabilities, Row-level security, Tab visibility, Delegated admin), then References, History and Source; History replaces the matrix's History sheet and is addressable (`?tab=history`). Save stays the Studio top bar's, and leaving with unsaved edits (×, ‹ ›, the menu, a reload, closing the tab) asks first.

What the pillar drew around the matrix comes along: Discard draft, Explain access, the suggested-audience strip, and on a read-only base "New similar", now in ⋯ and also on each of the base's rows in the list of sets; the copy opens at its own address with the strip saying where it landed. A draft the AI assistant left (copilot or MCP) shows the designers' notice, and 「放弃 AI 的改动」 drops that one set's draft; a person's own leftover draft keeps Discard draft.

The organization-wide default sharing overview ("Who can see which records") is a page of its own, `/studio/PACKAGE/owd`, the Access group's menu entry; a set's per-object visibility badge opens it on that object (`?object=NAME`).

Old addresses keep working: `/studio/PACKAGE/access?surface=permission:NAME` redirects to the set's address, `?surface=owd:overview` to the overview, and a bare `/studio/PACKAGE/access` to the list of sets; other query parameters are kept. `/studio/PACKAGE/metadata/permission/NAME/history` opens the History tab. The cross-package leg (`/studio/~all/...`) keeps the matrix's environment page. No locale keys, props of published packages or exports change.
