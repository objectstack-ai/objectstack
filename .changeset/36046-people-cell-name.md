---
'@object-ui/fields': patch
---

fix(fields): a person picked in a list cell shows their name at once, and avatar initials are letters only

Clause-②: no
Metadata-protocol: none

A list cell of a `user` field stores the picked person's id, and the save answers the id too, while the cell draws a person from the expanded record a list read brings. So after a pick the cell showed the raw id, marked as an unresolved reference, until the list was read again. The picker now keeps the records a pick hands back in the reference cache the lookup cell already reads (one cache, now in its own module), and the person cell draws a stored id as the person that cache holds for it: the name and face show as soon as the pick commits, while the save is on the wire and after it lands, with no read of the list or of the person. An id nothing on the page holds is still drawn as an unresolved reference, as before. A lookup cell whose column names no display field reads the same entry, so it also shows a picked record's name without reading it again.

Avatar initials (`getPersonInitials`, the people-field chips, the person picker rows, the comment author avatar) are made of letters only: brackets, punctuation and digits are skipped, so `Alice (Sales)` draws `AS`, never `A(`, and a name with a single letter draws that letter. The person cell and the `avatar` field widget now draw their initials through the same function instead of their own copies, so a single-word name draws its first two letters (`Ada` → `AD`) and a CJK name its given-name characters, as the chips already did.
