---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): a page printed in the dark theme prints on a white sheet, margins included

Clause-②: no
Metadata-protocol: none

With the Console in the dark theme and "Background graphics" turned on in the print dialog, the printed sheet was dark where nothing covered it: a record print page printed a dark 12 mm frame round its white content, and a list printed its black text on a dark sheet. The theme's dark colour scheme also darkens the canvas the browser paints under the page, and on paper that canvas fills the whole sheet. On paper the Console now uses a light colour scheme, so the canvas is white. The dark theme on screen is unchanged.
