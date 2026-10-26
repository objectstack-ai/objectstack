---
'@object-ui/i18n': patch
'@object-ui/components': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(i18n): the last English literals on the data table, the chart view, react pages, the References sheet and Flow Runs read the user's language

Clause-②: no
Metadata-protocol: none

- **Data table.** The hover "open record" affordance and the inline-edit row's cancel and save buttons are titled from `table.openRecord`, `table.cancelChanges` and `table.saveRow`.
- **Chart view.** A chart view's loading fallback reads the existing `chart.loading` row.
- **`kind:'react'` pages.** The capability notice, the empty-source refusal, the loading line and the two error titles read `reactPage.*`. Sentences with an inline code chip are one translated string, so each language decides where the chip sits.
- **References sheet (Studio).** The table's column headers read `engine.edit.refsColFromType`, `refsColFromName` and `refsColPath` from the Studio's own table, in English and Chinese.
- **Flow Runs.** When the client lacks the method a panel calls (`meta.getItems`, `automation.execute`, `automation.listRuns`), the panel keeps the method's name and words the diagnostic at render from `console.developer.flowRuns.clientMethodUnavailable`. A message the call threw is still shown as it came.

All ten locale packs carry the new rows. With no i18n provider every surface still renders its English.
