---
'@object-ui/app-shell': patch
---

fix(app-shell): the Lookup's Related object and the roll-up's Child object take objects only

Clause-②: no
Metadata-protocol: none

In Studio's field inspector, the Lookup's *Related object* and the roll-up summary's *Child object* pickers committed whatever text was typed, so a typo saved a field pointing at an object that does not exist. Neither door accepts an expression, so both now commit only an object the picker lists: typed text that names no listed object saves nothing and the picker says no object is chosen. Objects that exist only as a pending draft stay choosable, because the picker lists the draft-overlaid catalog. Flow references keep their free text.
