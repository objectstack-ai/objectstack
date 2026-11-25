---
'@object-ui/components': patch
---

fix(components): a wide table's right seam shadow shows when the table widens after its rows are drawn

Clause-②: no
Metadata-protocol: none

- A table wider than its box draws a shadow at its right seam while columns remain to the right. The box only re-read its overflow when the box itself or the element directly inside it changed size. A table sits inside a full-width wrapper that keeps the box's width, so when the columns widened the table after the rows were drawn (no row added, the box unchanged), the shadow never appeared, about half the time on the Studio metadata list at 1440 px. The box now also watches what sits inside that wrapper, so the shadow follows the table's own width. The same fix applies to every page that puts a table in the shared overflow box (for example the approvals inbox).
