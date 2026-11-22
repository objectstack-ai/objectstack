---
'@object-ui/plugin-grid': patch
---

fix(grid): after a cell save in a list that selects a cell first, a grouped row moves to its new group once the user leaves the row, and group subtotals and the footer total follow the save

Clause-②: no
Metadata-protocol: none

A list that selects a cell first (the list page) saves each cell and redraws only that row. Until now the groups and the footer did not follow that save:

- **A changed group field.** The row stays where it is while the user is still on it. Once a cell of another row is selected, the row shows in its new group, and both groups' counts and subtotals are correct. A grid grouped on the server reads its group headers and the open groups' rows again at that moment. A grid that groups the rows it was handed puts the saved row in its new group.
- **Any other field.** The group subtotals include the saved value straight away. A grid grouped on the server reads its group headers again and reads no row. A grid that groups the rows it was handed recounts them.
- **The footer total.** A flat grid whose rows are the whole set totals the saved value straight away. A grid paged on the server already read its whole-set figures again after a write, and still does.

A grid that is not select-first still reads everything again after each save, as before.
