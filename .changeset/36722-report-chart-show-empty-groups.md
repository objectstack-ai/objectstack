---
'@objectstack/spec': minor
---

feat(spec): `chart.showEmptyGroups` on a report chart — show the declared options that have no records

Clause-②: yes (widening)
Metadata-protocol: added

- `ReportChartSchema` gains an optional boolean `showEmptyGroups`. A grouped query returns only the values that have rows, so a select option no record carries was missing from a report chart rather than drawn at zero. With `showEmptyGroups: true` the report renderer adds every declared option of the `xAxis` field the answer left out, valued the way the analytics executor values any empty group (`emptyGroupValueFor`: `0` for count and sum, empty for avg/min/max).
- Optional with no default: a report that does not set it parses exactly as before and its chart draws exactly the groups the query returned. A non-boolean value is refused at `chart.showEmptyGroups`.
- Only a field that declares its options is filled. A date axis needs no switch: the executor already returns every bucket of the report's period.
