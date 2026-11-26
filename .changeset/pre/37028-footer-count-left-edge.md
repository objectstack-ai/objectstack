---
'@object-ui/components': patch
---

fix(ui): the list footer's record count starts on the list page's one left edge

Clause-②: no
Metadata-protocol: none

- The summary row at the foot of a list table led with its record count inside the first column's cell, after the 40px selection cell, so the count sat 52px in while the page bar's icon, the select-all box and every row checkbox sit 16px in. Where the table draws a selection or row-number cell, the summary row's first cell now spans that cell and starts at its 16px inset, so the count lines up with the select-all box, on a list that fits and on one that scrolls sideways (the cell stays frozen with the selection column). The first column's own figure still ends at its column's right edge.
