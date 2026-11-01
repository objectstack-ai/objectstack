---
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

fix(plugin-grid): over the 5000-record cap, the "select all matching" bulk bar says that only the first 5000 matching records will be processed

Clause-②: yes (widening)
Metadata-protocol: none

A grid's "select all matching" bulk action hands the action at most 5000 records, but the bulk bar counted the whole match set. With 7200 matches it read "All 7200 matching records are selected.", and a bulk delete then processed the first 5000 and said nothing about the rest.

- **Over the cap, the bar names it.** When the match set is larger than 5000, the select-all button reads "Select the first 5000 of 7200 matching", the banner reads "Only the first 5000 of 7200 matching records will be processed.", and the selection count, in the bar and in the selection's context menu, reads "5000 selected (of 7200 matches)".
- **At or under the cap, nothing changes.** The bar keeps today's text.
- **One number.** The fan-out and every one of those strings read one constant in `@object-ui/plugin-grid`, so the screen and the action cannot disagree.
- **New strings.** `@object-ui/i18n` gains `grid.bulkSelectAllMatchingCapped`, `grid.bulkAllMatchingSelectedCapped` and `grid.bulkSelectedAllMatchesCapped` in all ten built-in packs. They interpolate `cap` and `total`.
