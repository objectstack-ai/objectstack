---
'@object-ui/app-shell': patch
---

fix(app-shell): on a phone, a list authored to open nothing opens nothing

Clause-②: no
Metadata-protocol: none

The Console's object list now honours an authored `navigation.mode: 'none'` and `navigation.preventNavigation: true` on a phone as it does on a desktop. Before, the phone rule that opens every record as a page ran before the authored setting was read, so on a phone a tap on such a list's card opened the record page and the card was drawn as tappable. Now the card draws no pointer and no hover wash, a tap on it opens nothing, and a `?recordId=` link to one of its rows opens no record page, as it opens no drawer on a desktop. A list that opens its records still opens them as a page on a phone.

On a phone a list shows each row as a card with only some of its columns, so on a `none` list the columns a card does not show cannot be reached there: declare `none` or `preventNavigation` only where the rows need no detail view.
