---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@objectstack/console': patch
---

perf(console): an object list and a record page no longer load the Studio designer's string table on first paint

Clause-②: no
Metadata-protocol: none

Opening an object list or a record page downloaded the Studio designer's English string table (about 69 KB gzipped) and the designer's header and Customize controls with it, before the page could paint, for every user, designer or not. The running app's save paths that load with those pages (a list's view save, the record page's tabs and arrangement saves, the header-pin save) read small pure helpers that lived inside the designer's component modules, and importing a helper loaded the whole module.

Those helpers now live in modules of their own, so each page's first load is about 94 KB gzipped lighter on the Console build this was measured on. Nothing changes in what the pages show or save: every name is still exported from where it was, and the designer loads its string table when it opens, as before.
