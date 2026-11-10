---
"@object-ui/app-shell": patch
"@object-ui/i18n": patch
---

Clause-②: yes (widening)
Metadata-protocol: none

Studio's list view preview now shows the view's served `list-view-field-unknown` warnings, naming each column by its label (or its field, for a bare-string column) beside the server's sentence, in the same warnings block a form view's preview already draws. While a warning stands on one of the list's own columns, the preview canvas is not mounted: the server refuses the list query for any column naming a field the object lacks, so the canvas could only repeat the same fact as a refused-query panel. A short line says the preview runs once the columns are fixed (new Studio string `engine.viewPreview.listHeldForColumns`, en and zh). A warning at any other path draws above a mounted canvas, and a list view with no warning previews exactly as before.
