---
'@objectstack/service-analytics': patch
---

A dataset's date dimension reads the bucket key `@objectstack/core`'s `bucketDateKey` writes, with its year in four digits, and a draft preview keys a row the way the same dataset does once published.

- **Dimension labels (`queryDataset`).** A date dimension's grouped key is labelled as written. The year key `0050` was labelled `1970` (read as epoch seconds, because the year check admitted only 1000..9999), and a month or day key lost its padding (`0050-06` became `50-06`, `0050-06-15` became `50-06-15`). A raw date value is relabelled with the year in four digits too. A year from 1000 to 9999 is labelled as before.
- **Draft preview (`queryDataset` with `previewDrafts`).** Drafted seed rows are keyed by `bucketDateKey` itself, the key the published path's grouping writes. For 0050-06-15 the preview answered `50`, `50-Q2`, `50-06` and `50-06-15`; it now answers `0050`, `0050-Q2`, `0050-06` and `0050-06-15`. A `week` bucket is now the ISO week label (`2026-W25`), no longer the Monday's date (`2026-06-15`), so a weekly `compareTo` in the preview merges each comparison row onto its week, as the published path does. An epoch-milliseconds value is bucketed by its instant (it was the empty bucket), and a `Date` in 0001..0999 by its own year (a `Date` in 0050 keyed `1950`).
