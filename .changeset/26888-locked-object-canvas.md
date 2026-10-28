---
'@object-ui/app-shell': patch
---

fix(app-shell): a locked metadata item's designer canvas is read-only

Clause-②: no
Metadata-protocol: none

In Setup › All Metadata Types, a locked item (for example an object installed by a package, under the banner "This item is locked and cannot be edited or deleted.") still had a live designer canvas. On an object you could add a field, add a field to a section, move a section or remove one: the change showed in the canvas with an "Unsaved" chip, but the page offers no Save on a locked item, so the work was dropped without a word when you left.

What changes: when the page cannot write the item (it is locked, or you lack the capability to author metadata), the designer canvas gets no edit callback, so it renders read-only for every designer type, the way the Studio canvas already does for a read-only package. The Description box was already disabled on a locked item. Writable items are unchanged.

What to do: nothing.
