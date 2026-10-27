---
'@object-ui/plugin-dashboard': minor
---

Clause-②: yes (widening)
Metadata-protocol: added

A dataset-bound KPI tile and a cross-tab cell colour their period-over-period delta by the measure's declared `polarity` (`fields[].polarity` on the dataset answer, objectstack#26602). `'lower'` draws a rise red and a fall green, so a slower approval turnaround no longer reads as good news. `'neutral'` draws the delta in the muted text colour, with no green and no red. `'higher'`, and an undeclared polarity, keep the colours every delta had before: a rise green, a fall red. The arrow still shows which way the number moved under every polarity.
