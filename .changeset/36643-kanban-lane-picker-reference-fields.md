---
'@object-ui/plugin-list': patch
---

feat(plugin-list): a board's lane field picker offers lookup, user, master-detail and tree fields

Clause-②: no
Metadata-protocol: none

A board's 视图设置 → lane field picker now offers a single-valued lookup, user, master-detail or tree field next to the select and radio fields it already offered. Choosing one draws a lane per referenced record, titled by its name, and a drag writes the new reference: choosing the owner gives one lane per owner, and dragging a card changes its owner. A field that holds several references is still not offered, and a boolean or text field is not offered either.
