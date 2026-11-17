---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
'@object-ui/core': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

fix(objectql, metadata-protocol, console): a list view column on a field a disabled package adds no longer fails the whole list

Clause-②: yes (widening: the view save door accepts withheld names; one spec read-decoration member; one locale key)
Metadata-protocol: none

A package can add fields to another package's object. While that package is disabled, the platform leaves those fields out of the served object, and the data door refuses every request that names one (`400 INVALID_FIELD`, or `400 INVALID_SORT` for a sort). The owner's views still named the field, so a view with such a column, sort, filter, grouping level or searchable field failed for everyone. Saving the view (a rename, a pin, a Studio edit) was refused too (`422`, `list-view-field-unknown` / `sort-field-unknown`).

- **The served object read names what is withheld.** `GET /api/v1/meta/object/:name` and the object list read carry `_withheldFields: { [field]: { packageId } }` when a disabled package withholds a field from the object. It is a read decoration (`METADATA_READ_DECORATIONS`), so the save door strips it, and the execution face and the layered editor read do not carry it. The registry gains `getWithheldExtensionFields(name)`.
- **The view save door judges a view against the stored object.** A `view` write is judged against the object with every disabled package's extension folded in (the new fold option `includeDisabledExtensions`). A withheld field is a real stored field, so the view saves and keeps its column and sort. A misspelled field is still refused. Other writes are still judged against the served object, so a page or flow that names a withheld field is still refused while the package is off.
- **The console leaves withheld names out.** The list view and the grid leave a withheld field out of `$select`, `$filter`, `$orderby`, `$searchFields` and `groupBy`, and do not draw its column. A line above the rows names it (`list.withheldFieldsLeftOut`). Nothing is written to the view or to the user's list preferences, and a sort the user saves keeps the withheld entry. Once the package is enabled, the column, the sort and the grouping come back without any write.
