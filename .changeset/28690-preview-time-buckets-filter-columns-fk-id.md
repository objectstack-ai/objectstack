---
'@objectstack/service-analytics': patch
---

fix(service-analytics): the draft preview groups a bucketed time dimension and reads a qualified filter member as the live faces do, and the ObjectQL strategy serves a backed `RELATION.id` dimension

Clause-②: yes (widening)
Metadata-protocol: none

Three answers `queryDataset` gave differently depending on the face, measured on real SQLite:

- **A bucketed time dimension in the draft preview.** A `timeDimensions` entry with a `granularity` is now grouped by its bucket whether or not the member is also in `dimensions`, and the bucket is a column of the answer and of `fields` (type `time` for a `date` dimension). This is the set both live strategies project. Before, the preview grouped by `dimensions` alone: one total where the live faces answered one row per month, regions without months, and a windowed `year` bucket with no key.
- **A filter member spelled other than its column, in the draft preview.** A `runtimeFilter` (or dataset filter) member such as `OBJECT.region`, `CUBE.region` or a dataset dimension `zone` declared over `region` is now read from the column it names, with that column's declared type, through the member resolution the live strategies use. Before, the preview matched no drafted row: `[]`, or under an `$or` only the other arm's rows, where both live faces served the rows.
- **A backed `RELATION.id` dimension on the ObjectQL strategy.** `account.id` (with `include: ['account']`), and two dimensions through one relationship (`account.id` beside `account.name`, or the FK column `account` beside `account.name`), are now served with the native strategy's groups. Before, the strategy handed the engine a `groupBy` naming one column twice and answered `INVALID_QUERY` / 400. The engine's duplicate-column refusal is unchanged; the strategy now names each column once.

Nothing is refused that was served, and no export, key, error code or status is added. The draft preview still refuses a relationship-path member (#28555).
