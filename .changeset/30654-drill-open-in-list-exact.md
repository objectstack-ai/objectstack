---
'@object-ui/react': patch
'@object-ui/plugin-dashboard': patch
'@object-ui/plugin-charts': patch
'@object-ui/app-shell': patch
---

fix(drill): "Open in list" from a dashboard or report drill is offered only when the list can show exactly the drawer's records

Clause-②: yes (widening)
Metadata-protocol: none

A drill filter is the clicked bucket AND the widget's filter AND the measure's drill scope. The list route holds one value per filter param and has no spelling for `$in`, so a drill with two conditions on one field (a `status = sent` bucket under a `status = paid` measure scope) or an `$in` scope opened a wider list than the drawer: the drawer showed 0 invoices and the list showed every sent one. The Console now offers "Open in list", and follows `drillDown.target: 'navigate'`, only when the route can write every condition of the drill filter, after resolving its placeholders; otherwise the drill stays in the drawer. A plain equality or date-range drill opens the same URL as before.

`DrillNavigationValue` (`@object-ui/react`) gains an optional `canOpenRecordList(objectName, filter)`. The drill drawers (`DrillDownDrawer`, `OpenInListButton`, `ObjectChart`) offer the escape hatch only when `openRecordList` is present and `canOpenRecordList` is absent or answers `true`. A host that does not provide it behaves exactly as before.
