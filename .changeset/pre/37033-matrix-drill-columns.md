---
'@object-ui/plugin-report': patch
---

fix(plugin-report): a report matrix cell's drill list shows the fields the cell stands for

Clause-②: no
Metadata-protocol: none

A matrix cell's drill now opens its record list with the down dimension's field, the across dimension's field and the measured field as default columns after the record name, the same defaults a summary line's drill already used. Before, the matrix drill listed only the record name. The filter is unchanged: the list still holds exactly the records the measure counted.
