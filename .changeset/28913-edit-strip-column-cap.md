---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the record page's highlight strip edits in at most three columns, so a lookup keeps its chosen name

Clause-②: no
Metadata-protocol: none

On the default record page, entering edit mode draws every highlight field, empty ones included, so they can be filled in place. With six declared fields the strip put all six editors in one row, and a lookup picker was left showing one letter of the chosen name beside its buttons. The edit face now caps the grid at three columns, so six fields wrap to two rows of three. The read face is unchanged and still shows up to six in a row. No key, option or prop changes.
