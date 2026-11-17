---
'@object-ui/components': patch
---

fix(components): an authored page's region row follows the page's own width, so a narrow record drawer stacks the rail below main

Clause-②: no
Metadata-protocol: none

An authored page's body row (sidebar | main | aside) and its rail widths switched on the viewport `md` breakpoint. A record page with an `aside` rail in a record drawer dragged to 380 px at a 1280 px viewport therefore kept the row: the rail kept its 256 px, `main` was squeezed to a few pixels, and the rail's cards covered the tab row and the field cards.

Each region template (`default`, `three-column`, `header-sidebar-main`, and a page that names no template) now lays its root out as a named container (`@container/regions`). The row goes side by side, and a rail takes its fixed `small`/`medium`/`large` width, from that container's `@3xl`: 768 px, the same pixel value as the viewport `md`, now measured on the page's own layout. A full page wider than 768 px draws exactly as before. A narrower layout stacks the rails below `main`, and that includes the record drawer at its default 720 px width, as the synthesized record page already does below 760 px. A phone viewport still stacks. The `dashboard` template's grid is unchanged.
