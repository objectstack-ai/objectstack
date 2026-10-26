---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): a grouped grid orders a level's groups by its `grouping.fields[].orderBy`, the label still from `field`

Clause-②: no
Metadata-protocol: none

A view grouped by `period_label` with `orderBy: 'period_start', order: 'desc'` now lists one header per label in descending `period_start` order, where it used to list the labels as text (`Nov 2026` before `Oct 2026` before `Q1 2027`).

- **Server-grouped grid.** The grid forwards the level's `orderBy` into the group header query, so the query carries the `min` (asc) / `max` (desc) column the spec compiles for it, and sorts the header rows by the column `listViewGroupOrderColumn` names. An `orderBy` field the user may not read is not forwarded: that level orders by its own key.
- **Rows handed in whole.** Each group's order value is the `min` (asc) or `max` (desc) of `orderBy` over its rows, so a group sits where its first row would if the rows were sorted by `orderBy`.
- **Both paths.** A group with no `orderBy` value sorts last in both directions; equal values fall back to the existing key comparison (declared option order, then label) in the same direction. A level without `orderBy`, or with `orderBy` naming the grouping field itself, orders exactly as before.
