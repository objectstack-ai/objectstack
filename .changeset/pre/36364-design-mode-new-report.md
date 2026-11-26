---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): a new report is built from the design mode's 「Add menu item」 and lands in the place held for it

Clause-②: yes (widening) — new `@object-ui/i18n` keys (`designMode.menu.newReport`, `designMode.menu.newReportLeft`, `report.builder.addsToMenu`) in all 11 locales; no package export, spec or schema change
Metadata-protocol: none

In the design mode's 「Add menu item」 picker, the 「Reports」 list now starts with 「New report…」. A report needs a data source and a measure before it can be published, so it is not created from a name: the place stays held in the menu (「New report…」) and the report builder opens at the app's `reports/new`, saying that saving adds the report to the menu. The builder's Save creates and publishes the report in the package the menu is saved to (the app's package when it is writable, else its customization package), puts its entry in the held place, and saves the menu with every other change staged in the mode; the mode is then left and the report's page opens. When the menu save is refused the report is removed again, the mode and the held place stay, and the builder stays open with the reason. The builder's Close, or leaving the builder any other way, drops the held place and writes nothing. Opened outside the design mode, `reports/new` saves on its own as before.
