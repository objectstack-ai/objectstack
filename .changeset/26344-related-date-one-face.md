---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a related list's `date` column reads in one absolute face when its field declares no `format`

Clause-②: no
Metadata-protocol: none

A record page's related list drew its `date` column in mixed faces, for example "Yesterday · 3 days ago · Sep 20, 2025", the way list grids did before their own fix. The related list builds its own table cells and did not tell the date cell that it sits in a column.

- **Default change for an undeclared `format` (visible from metadata).** In a related list's table, a `date` field that declares no `format` now renders the locale's short absolute date (`Oct 25`, with the year when the date is not in the current year), one face for every row, as a list grid already does.
- **The relative phrase moves to the tooltip.** It is shown on hover ("Yesterday", "In 2 days", or "Overdue 3d" on a declared `dueLike` field). A past declared deadline is still red.
- **A declared `format` still wins.** A field that declares `format: 'relative'` keeps the relative face.
- **Other surfaces are unchanged.** The phone-width gallery of a related list, the record detail body and the header highlights strip render `date` values as before. `datetime` cells are not affected.

What to do: nothing. To keep the relative wording in a related list's column, declare `format: 'relative'` on the field.
