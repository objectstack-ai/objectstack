---
'@objectstack/spec': patch
---

fix(spec): the bulk-param widget-config refusal names `allowCreate` among the field keys a promoted action carries

Clause-②: no
Metadata-protocol: none

Since #36919, a promoted bulk action's field-backed lookup param takes the field's `allowCreate`, so `allowCreate: false` on the field keeps the picker's create entry out of the selection bar's dialog. The `BULK_PARAM_WIDGET_CONFIG_KEYS` prescription and the `list.bulkActionDefs` liveness note still left it off the carried keys, telling authors the opposite. Both now name `allowCreate` with `lookupFilters` / `lookupColumns` / `lookupPageSize` / `descriptionField`. Text only; the refused key set is unchanged.
