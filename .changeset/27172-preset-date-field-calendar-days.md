---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a preset `dateRange` on a `date` field counts the reference time zone's calendar days, east of UTC too

Clause-②: no
Metadata-protocol: none

A dataset or analytics query with a preset `dateRange` (`this_quarter`, `last_30_days`, …) on a dimension whose field is `type: 'date'` counted the wrong calendar days under a reference time zone east of UTC. The preset resolves to the zone's midnight instants, and a `date` column read each instant by its leading UTC day, so the window slid one day early: in `Asia/Shanghai`, `this_quarter` (Q3 2026) counted 2026-06-30 and dropped 2026-09-30. West of UTC the days were already right.

Now a `date` field compares the calendar days the period covers in the reference zone (Q3 is 2026-07-01 through 2026-09-30 in any zone), and a `datetime` field keeps comparing instants. The fix applies on both query strategies, in the drill ranges a windowed answer reports (so a drill still lists exactly what the row counted), and in the draft preview. An explicit `[a, b]` window is unchanged, and so is a field whose type the host cannot name.
