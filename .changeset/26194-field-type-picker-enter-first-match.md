---
'@object-ui/app-shell': patch
---

fix(app-shell): in the field type picker, Enter after a search picks the type the search names

Clause-②: no
Metadata-protocol: none

In Studio's Add field popover and the field inspector, a search highlighted the first listed type, and a type whose description holds the query as a word can be listed before the type the query names. On a Phone field, typing "Number" listed Phone first ("A phone number."), Phone stayed highlighted, and Enter committed nothing. A query now highlights the first listed type it names by name, id or English name, and the first listed type when it names none, so Enter commits Number. With an empty query the current type is highlighted as before, and re-choosing it still commits nothing. The arrow keys move on from the highlighted type as before.
