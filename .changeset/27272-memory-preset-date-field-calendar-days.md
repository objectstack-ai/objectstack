---
'@objectstack/driver-memory': patch
'@objectstack/core': patch
'@objectstack/service-analytics': patch
---

fix(driver-memory): a preset `dateRange` on a `date` field counts the reference time zone's calendar days on the in-memory analytics face

Clause-②: yes (widening)
Metadata-protocol: none

An analytics query on the in-memory driver with a preset `dateRange` (`this_quarter`, `this_month`, …) on a dimension whose field is declared `type: 'date'` counted the wrong calendar days from UTC westward. The face compared the preset's resolved instants (the zone's midnight, `2026-07-01T07:00:00.000Z` in `America/Los_Angeles`) against the stored bare day as text, so `this_quarter` (Q3 2026) dropped 2026-07-01 and counted 2026-10-01, in `America/Los_Angeles` and in `UTC` alike.

Now a `date` field compares the calendar days the period covers in the reference zone (Q3 is 2026-07-01 through 2026-09-30 in any zone), and a `datetime` field keeps comparing instants: the same rule service-analytics' faces apply. An explicit `[a, b]` window is unchanged, and so is a field whose type the driver was never told through `syncSchema`.

The rule now has one home, `@objectstack/core`: `dateRangeWindowBounds` and `inclusiveCalendarDayWindow` are exported from it, and `@objectstack/service-analytics` calls them instead of its own copy (no behaviour change there). `InMemoryDriver` gains `isDeclaredDateField(object, field)`, which answers from the declared schema.
