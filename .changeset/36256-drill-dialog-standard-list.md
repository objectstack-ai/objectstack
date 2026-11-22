---
'@object-ui/plugin-dashboard': patch
'@object-ui/plugin-report': patch
'@object-ui/react': patch
'@object-ui/app-shell': patch
'@object-ui/components': minor
---

feat(plugin-dashboard): a dashboard or report drill opens a centred dialog over the standard list, and a report's chart marks drill

Clause-②: yes (widening) — additive members only, among them the new `PageRegionPostureReset` export of `@object-ui/components`; nothing is removed or renamed
Metadata-protocol: none

Clicking a number on a dashboard (a chart mark, a metric tile, a table cell) or on a dataset report used to open a full-height side drawer whose table listed every field of the object, with no sort, no filter and no word on which conditions selected the records; a row stacked a second record panel on top. The drill now opens a dialog about 70% wide and 65% tall that dims and blurs nothing behind it, and its body is the standard list the object list page draws (`list-view`): the same row height, column-header sort, filter chips, added columns, record count and column calculations. The drill's conditions (the clicked bucket, the widget's filter, the measure's scope) are the list's own chips and can be changed or removed; a condition no chip can say (a relationship path, an `$or`) still filters the list. The default columns are the record's name, the grouped fields and the measured fields. Nothing done in the dialog is saved, and it writes nothing. A record's name opens the record's full page, whose 「N of M」 stepper walks the drill's rows and whose way back is the dashboard or report; no second panel is stacked. 「Open in list」 is unchanged. On a phone the drill keeps the side drawer, with the same list.

A dataset report's chart marks now drill too: a bar opens the same records as the summary line it stands for.

Additive members: `DrillNavigationValue.openRecord` and the `DrillRecordOrigin` type (`@object-ui/react`), `DrillDownDrawerProps.defaultColumns` (`@object-ui/plugin-dashboard`), `DatasetDrillArgs.fields` (`@object-ui/plugin-report`), `PageRegionPostureReset` (`@object-ui/components`). A renderer without `@object-ui/plugin-list` registered lists the drilled records in the dashboard's data table. A host that gives no `openRecord` (a page block's metric or pivot) opens the drilled record in a dialog, from either body.

Inside a page the drill draws the same standard list: the page region's posture (the compact or capped list a page block draws) is cleared for the drill's dialog by the new `PageRegionPostureReset` (`@object-ui/components`), so a page block's metric or pivot drill shows its chips, its record count and its pager, and no 「View all」 link to a list without the drill's condition. A drill whose filter names no condition any read can carry (a string, a number) lists nothing and says so, instead of listing every record.
