---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): Studio's home currency amount editor holds a partial pick instead of autosaving it

Clause-②: no
Metadata-protocol: none

A record-mode currency field's home currency amount (`currencyConfig.homeAmount`) names three fields together or none: the home amount field, the document date and the rate field. The Studio field editor committed each pick on its own, so the autosave sent the field with one, then two, of the three, the server refused both (`422 INVALID_METADATA`) and "Changes not saved" showed twice before the third pick saved. Clearing the three showed the same twice. A pick that leaves one or two of the three set now stays in the editor and is not saved, with one line under the pickers naming the fields still to pick; the field saves once, when all three are set or all three are cleared. Editing a complete home amount to another complete one saves at once, as before. The rate field picker is judged against the document date on screen, picked or not yet saved. Nothing the server accepts changed.
