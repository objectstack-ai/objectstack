---
'@object-ui/plugin-dashboard': patch
'@object-ui/app-shell': patch
'@object-ui/components': patch
---

fix(console): dashboards meet the 44 px touch-target floor at phone width

Clause-②: no
Metadata-protocol: none

Measured on a real Console at 375 and 390 px (objectstack#29078, part of the #29040 phone-width audit), the Dashboards flow had no horizontal page scroll, every overlay fit and scrolling stayed smooth at 4× CPU throttling, but most of its controls were 16 to 36 px tall. Below `sm` they are now 44 px touch targets; from `sm` up nothing changes:

- the dashboard page's Refresh All;
- the filter bar's date, select and text controls, its Reset, and the option rows of its lists;
- the custom-range calendar, which opens one month with 44 px days below `md` (two stacked months at that size ran past the viewport);
- the dataset table's sort buttons and drillable rows, the pivot's drillable cells, and Export CSV, which on a phone takes its own row above the table instead of covering the last column's sort button;
- the drill drawer's Open in list, and the Close button of every Sheet.
