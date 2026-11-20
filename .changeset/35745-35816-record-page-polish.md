---
'@object-ui/fields': minor
'@object-ui/plugin-detail': minor
'@object-ui/plugin-form': minor
'@object-ui/components': minor
'@object-ui/app-shell': minor
---

fix(record-page): business dates read as dates, Save is the edit state's primary button, and a new detail line starts on its defaults

Clause-②: yes (widening)
Metadata-protocol: semantic

Three things on the record page.

**Dates.** A `date` field that declares no `format` read as a relative phrase on the record page ("6 days ago", "Tomorrow") while the list beside it wrote the date ("Nov 13"), so the reader had to work the day out. The record page's field sections and its highlights strip now write the date itself, with its year, as the list's columns do; the relative phrase (an overdue deadline's "Overdue 5d" included) is the date's tooltip, and a deadline past due still reads red. A declared `format`, `'relative'` included, still wins. The record footer's created and modified times keep their relative wording, and card surfaces (kanban, gallery) are unchanged. `@object-ui/fields`' cell props gain `absoluteDate`, read by the `date` cell.

**Edit-state buttons.** In the record page's edit state, Cancel drew as the filled primary button and Save as an outline one, so the hand fell on the button that throws the edit away. Save is now the one filled button, after Cancel, the order a form's footer uses. `page:header` now makes a host button declaring `variant: 'primary'` the primary over the page's own actions, in the place the host gave it; no other host button declares one, so every other header is unchanged.

**New detail lines.** A line added to a master-detail table in the record page's edit state started blank, so a required column with a default (a status that defaults to "Pending") read red although the save then stored the default. A new line now starts on the child object's static defaults, the values a create form seeds; a default the server resolves at insert (`NOW()`, a CEL expression) is left to the server. A new line's empty required cell reads red only after a save was refused, with the server's reason listed under the table; a stored line is flagged as before. A new line left as it came, holding only its defaults, is still skipped at save like a blank one. `LineItemsField` gains `newRowValues` and `newRowRequiredShown`, and `isBlankRow` (with the batch inputs) an optional `newRowValues`; a host that passes neither sees no change. The save request and its transaction are unchanged.
