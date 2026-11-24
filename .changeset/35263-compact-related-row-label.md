---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a record page's compact related card labels its rows from the list's columns when those columns leave the child's name out

Clause-②: no
Metadata-protocol: none

A compact related card in the record page's right column labelled every row by the child's record title, so a line item named by a stored copy of its product's title read the product page's own name on every row, even when the relationship declared the columns that tell the lines apart (`relatedListColumns: [opportunity, quantity, ...]`). When the related list declares columns and they leave the child's name field out, the compact row is now labelled from the first of those columns that is a lookup to another record, the principal may read and the block does not redact; the card still asks the server for that one column and nothing more. A list with no declared columns, columns that include the name, no readable lookup among them, or a template title (`titleFormat`) keeps the record title, and a child named by the key back to the page keeps the rule it had.
