---
'@object-ui/components': patch
---

fix(components): a grid's select-all draws a dash for a partial selection

Clause-②: no
Metadata-protocol: none

With some but not all rows of the page selected, the data table's header checkbox was already announced as mixed (`aria-checked="mixed"`) but drew the same check mark as "all selected", so a user could read two selected rows as the whole page. It now draws a dash, filled like the checked state; all selected still draws the check and none selected draws nothing. The upstream Shadcn `Checkbox` is unchanged: the header uses a package-internal tri-state wrapper.
