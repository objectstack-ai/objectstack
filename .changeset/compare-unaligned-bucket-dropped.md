---
'@objectstack/service-analytics': patch
---

Clause-②: no
Metadata-protocol: none

fix(service-analytics): a `compareTo` bucket with no counterpart in the current window is dropped instead of keeping its own key.

With `previousPeriod` on a bucketed time axis, the previous window can tile into one more bucket than the current one (December by week: six previous weeks against five; Q2 by month: four previous months against three). That extra bucket used to keep its own key, so it either overwrote the comparison value of a current bucket it was never aligned to (the previous period's own `2026-W49` replaced the aligned value on December's first week) or appeared as an extra row outside the requested window (a November bar on "this month" by month). It is now left out of the comparison grid; the empty (null) bucket still merges as before.
