---
'@object-ui/fields': patch
---

fix(fields): the tags field, the lookup search and the people picker search leave an Enter the input method owns to the input method

Clause-②: no
Metadata-protocol: none

A user typing Chinese, Japanese or Korean presses Enter (and, in a tags field, the comma) to pick a word from the input method. Those keys also reached the widget: the tags field added the half-typed pinyin as a tag, and the search box of a lookup or of the people picker took the highlighted entry. The arrow keys that move between the input method's candidates also moved the highlighted row.

The three widgets now ignore a key pressed while a composition is open, and the Enter Safari raises just after the composition ends (keyCode 229). The next Enter, or comma, does what it always did: it adds the tag or takes the highlighted entry. This applies in the record form and in the list grid's editors alike.

No metadata key, value or default changes, and nothing is added to the package's exports.
