---
'@object-ui/app-shell': patch
---

fix(console): the sidebar's fold width is derived from the record drawer over the list, now that the split pane is retired

Clause-②: no
Metadata-protocol: none

The console sidebar still folds to its icon rail below 1416 px, and nothing changes at any width: a 1280 px or 1366 px window keeps the rail, a click still expands it over the content, and "Keep sidebar open" still keeps it expanded. What changes is the reason the code gives for 1416. It was the split pane beside the list, which is retired. It is now the record drawer a list record opens in (720 px, non-modal, so the list beside it stays readable and clickable), the narrowest list that still draws its columns beside it (440 px), and the expanded sidebar (256 px). The module-internal `RECORD_SPLIT_MIN_CONTENT_WIDTH` is now `RECORD_DRAWER_MIN_CONTENT_WIDTH`, built from `RECORD_DRAWER_WIDTH` and `LIST_MIN_COLUMNS_WIDTH`; none of them is exported from the package entry.
