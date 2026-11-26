---
'@object-ui/fields': patch
---

fix(fields): the line-item grid stores an emptied multi-record lookup cell as `null`, draws a people or lookup column's names with one read, and mutes an empty list in list mode

Clause-②: no
Metadata-protocol: none

- **An emptied multi-record lookup cell writes `null`.** Un-picking the last record of a `lookup` column with `multiple: true` wrote an empty list (`[]`) into the line, while an emptied multi-select, tags or people cell writes `null`, the value the field contract stores for a cleared multi-value field. It now writes `null` too, so every emptied multi-value cell in the grid stores the same value and the save's blank-line check reads it as empty.
- **Names are read once per referenced object, not once per line.** Each people cell and lookup cell holding a bare record id read that record on its own to draw its name, so a grid of twenty lines with a people column made twenty reads of `sys_user`, and a lookup column twenty more of its target. The grid now gathers those reads into one read per referenced object (an `$in` on the record ids, up to 50 ids per read), with each id asked for once, in editable, read-only and list mode alike. What each cell draws is unchanged.
- **A stored empty list reads muted in list mode.** A multi-select or tags cell holding `[]` drew the em dash in the normal text colour; it now takes the muted colour, as an empty value already did.

No metadata key, value or default changes.
