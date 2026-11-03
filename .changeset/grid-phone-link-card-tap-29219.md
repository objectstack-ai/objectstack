---
'@object-ui/plugin-grid': patch
---

Clause-②: no
Metadata-protocol: none

On a phone, a grid card's record link no longer is a tap target of its own. Below 768 px the grid draws each row as a card, and a view whose first column is not the object's name field shows that column's record link in the card's subtitle: one text line, well under the 44 px a finger needs. The link now carries `max-md:pointer-events-none`, so a tap on it reaches the card, which opens the same record. The link keeps its focus and keyboard activation, and the desktop table is unchanged.
