---
'@object-ui/plugin-detail': patch
---

fix(ui): the record stage bar uses its compact form in a narrow record drawer, not only on a phone

Clause-②: no
Metadata-protocol: none

`record:path` chose between its desktop row and its compact form by the viewport alone, so a narrow record drawer opened at a desktop viewport drew the desktop row: seven stages in a 380 px drawer got about 33 px each and read as 'P…', 'Pro…', 'Ne…'. The bar now draws the desktop row only when the viewport is at least `sm` and the bar itself is at least 24rem (384 px) wide. Otherwise it draws the compact form: the progress segments, then "Step N of M" and the current stage's full name, which opens the list of every stage.

- Below `sm` nothing changes: the compact form, as before.
- A full-width record page keeps the desktop row, pixel for pixel.
- Nothing is authored for this: no new key, prop or translation string.
