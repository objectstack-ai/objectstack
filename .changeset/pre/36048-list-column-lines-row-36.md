---
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

feat(plugin-grid): a list draws a line between columns, its default rows and header are 36px tall, and the footer shows 「+ Add calculation」 at rest

Clause-②: no
Metadata-protocol: none

- A line of the same colour and weight as the row lines now runs between columns in the header, the rows and the footer row, with none after the last cell. The last frozen column keeps its scroll shadow on top of its line.
- The default row height (`compact`, the density a view without `rowHeight` gets, shown as Compact in the row-height menu) is 36px instead of 32px, and the header is 36px too. The Standard and Spacious densities are unchanged.
- In a list whose reader may change the view, every footer cell without a calculation shows a faint 「+ Add calculation」 at all times instead of only on hover. A reader who may not change the view still sees only the calculations already set. The `grid.summary.calculate` text changes in every language pack to match.
