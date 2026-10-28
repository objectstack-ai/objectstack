---
'@objectstack/service-analytics': patch
'@objectstack/spec': patch
---

fix(service-analytics): a windowed dataset answer reports its window in `drillRanges`, so a drill list stays inside the picked period

Clause-②: yes (widening)
Metadata-protocol: none

A dataset query whose selection carries `timeDimensions[].dateRange` (a report's picked period) counts only that period's records, but its answer's `drillRanges` covered only the date dimensions it groups by. So a report run on "this quarter" and grouped by stage drilled to a list of every period's deals, and a month bucket cut by `last_30_days` drilled the whole month.

- **The window rides `drillRanges`.** A windowed dimension that is not grouped gets an entry on every row: the `[gte, lt)` the query filtered by. A windowed field that a bucket already bounds narrows that bucket's entry to the part inside the window, and adds no entry of its own, so an edge bucket drills only its in-window records. Drill hosts already filter by every `drillRanges` entry, by its `field`, so they need no change.
- **One window, not a second resolver.** The bounds come from the query's own steps: the preset resolved in the reference time zone, an explicit `[a, b]` as written, the shared whole-day lowering (a bare-day end runs to the start of the next day), and the engine's temporal storage form: ISO instants for a `datetime` field, `YYYY-MM-DD` days for a `date` field.
- **No entry when there is no exact spelling.** An explicit window whose end is an instant (compared with `<=`), or whose end is the last supported day (no upper bound), gets no entry, and the drill stays as wide as before. So does a field whose type is unknown under a non-UTC time zone, as for buckets.
- **Spec.** The `drillRanges` docblock on `AnalyticsResult` and its `.describe` text on the dataset answer schema say what the key now carries. No key is added.
