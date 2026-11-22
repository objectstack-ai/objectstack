---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): on a phone, a list that declares no `pagination` loads more record cards as the card list nears its end, as the table does on a desktop

Clause-②: no
Metadata-protocol: none

A list with no declared `pagination` loads window by window as it scrolls. At phone width the grid draws record cards in a scroller of its own, and that scroller was never watched: the cards ended in a pager reading "Page 1 of 3" whose Next did nothing, so no record past the first window (the 51st, by default) could be reached. The grid now asks its host for the next window as the card scroller nears its end, and draws no card pager when its host loads as the list scrolls (`onLoadMore`), as the table draws none. A list that declares `pagination` keeps its card pager unchanged. No prop, export or metadata key changes.
