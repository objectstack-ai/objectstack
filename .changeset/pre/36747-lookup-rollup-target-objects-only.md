---
'@object-ui/app-shell': patch
---

fix(app-shell): the Lookup's Related object and the roll-up's Child object take objects only

Clause-②: no
Metadata-protocol: none

In Studio's field inspector, the Lookup's *Related object* and the roll-up summary's *Child object* pickers committed whatever text was typed, so a typo saved a field pointing at an object that does not exist. Neither door accepts an expression, so once the picker's object list has loaded, both commit only an object it lists: typed text that names no listed object is refused, the picker says no object is chosen, and the target the field already had stays (clearing the input on purpose still removes it). While the list is not yet read, or its read failed, the typed text is still committed as before. The trigger object in the new-automation dialog, the one other picker that takes objects only, now also keeps its chosen object on a refused typo. Objects that exist only as a pending draft stay choosable, because the picker lists the draft-overlaid catalog. Flow references keep their free text.
