---
'@object-ui/plugin-form': patch
---

feat(plugin-form): a form dialog with no declared `columns` spreads a field-heavy form to three columns, and to four in a `full` dialog

Clause-②: no
Metadata-protocol: none

A record dialog whose form declares no `columns` drew every form two fields per row, however many fields it had. On a wide screen a long business form left most of the dialog empty. The dialog now picks its column count from the number of fields it shows:

- **Up to eight fields:** two per row, as before.
- **Nine or more fields:** three per row, in the standard dialog sizes.
- **Sixteen or more fields in a `full` dialog** (`modalSize: 'full'`): four per row.

The bounded `xl` dialog stops at three because its field area is already wider than the four-column breakpoint. Columns still follow the dialog's real width, so a narrow dialog and a phone show one column. Sections and the object's field groups that declare no `columns` get the same count. Long text, rich text, markdown, html and inline grid fields still take a whole row.

A declared `columns`, including `1`, is drawn as written, on the form and on each section. The dialog's inferred size (`lg` or `xl`) is unchanged. Full-page, tabbed and wizard forms are unchanged: a section with no `columns` still draws two per row there.

If your forms declare `columns: 2` only to keep the old dialog layout, you can remove it to get the wider layout.
