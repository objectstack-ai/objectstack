---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): report editing is its own entry, and report and dashboard editing exclude the design mode both ways

Clause-②: no
Metadata-protocol: none

The console's design mode no longer hosts the report builder, so the screen shows one Save/Cancel set at a time:

- The design mode's 「Add menu item → Reports」 lists only reports that exist; its 「New report…」 row is gone, with the hand-off that let the builder save into the menu. A new report is made from the reports index, then linked from the design mode.
- The reports index offers 「New report」 in its header, opening the report builder. It is offered to workspace admins, as the builder is, and not while the design mode is on.
- While the design mode is on, a dashboard's and a report's own 「Edit」 are not offered.
- While a dashboard or report editor is open, 「Design layout」 refuses with a prompt to save or cancel those changes first, so the design mode's 「Cancel」 can no longer end the mode under an editor left open.
- The report builder's own address reached with the design mode already on (the browser's Back) shows a prompt to finish designing the layout instead of the builder; the builder opens there once the mode is saved or cancelled.

The design mode's 「New dashboard…」 is unchanged. In `@object-ui/i18n`, `designMode.menu.newReport`, `designMode.menu.newReportLeft` and `report.builder.addsToMenu` are removed from every pack, and `designMode.editorOpen`, `console.reportIndex.newReport`, `report.builder.designModeOnTitle` and `report.builder.designModeOn` are added. Nothing to migrate.
