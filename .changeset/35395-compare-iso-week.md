---
'@object-ui/core': patch
---

fix(core): a chart's compare-to no longer repeats the current week when its filter uses `{current_iso_week}`

Clause-②: no
Metadata-protocol: none

`previousPeriod` now compares with last week's ISO key (week 1 steps back to the previous ISO year's W52/W53), and `previousYear` with the key of the same day one year earlier. The trend label reads "vs last week".
