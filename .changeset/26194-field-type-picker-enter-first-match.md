---
'@object-ui/app-shell': patch
---

fix(app-shell): in the field type picker, Enter after a search picks the type the search names

Clause-②: no
Metadata-protocol: none

In Studio's Add field popover and the field inspector, typing a type's name into the type search and pressing Enter kept the field's current type whenever that type's description held the query: on a Phone field, "Number" still listed Phone first ("A phone number."), Phone stayed highlighted, and Enter committed nothing. A query now highlights the first listed type it names by name, id or English name, and the first listed type when it names none, so Enter commits Number. With an empty query the current type is highlighted as before, and re-choosing it still commits nothing. The arrow keys move on from the highlighted type as before.
