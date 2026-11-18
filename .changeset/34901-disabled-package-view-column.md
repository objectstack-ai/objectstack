---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
'@objectstack/metadata-core': patch
'@objectstack/plugin-security': patch
'@object-ui/core': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

fix(objectql, metadata-protocol, console): a list view column on a field a disabled package adds no longer fails the whole list

Clause-②: yes (widening: the view save door accepts withheld names; one spec read-decoration member; one locale key; one optional security-service member, add-only)
Metadata-protocol: none

A package can add fields to another package's object. While that package is disabled, the platform leaves those fields out of the served object, and the data door refuses every request that names one (`400 INVALID_FIELD`, or `400 INVALID_SORT` for a sort). The owner's views still named the field, so a view with such a column, sort, filter, grouping level or searchable field failed for everyone. Saving the view (a rename, a pin, a Studio edit) was refused too (`422`, `list-view-field-unknown` / `sort-field-unknown`).

- **The served object read names what is withheld.** `GET /api/v1/meta/object/:name` and the object list read carry `_withheldFields: { [field]: { packageId } }` when a disabled package withholds a field from the object. It is a read decoration (`METADATA_READ_DECORATIONS`), so the save door strips it, and the execution face and the layered editor read do not carry it. The registry gains `getWithheldExtensionFields(name)`.
- **A caller who may not read a withheld field is not told it exists.** The object-schema projection (ADR-0106) keeps a `_withheldFields` entry only for a caller the security service admits. `ISecurityService` gains an optional member, `getMetadataReadableWithheldFields(object, context)`, which answers the withheld names the caller may read; `@objectstack/plugin-security` implements it from each field's stored definition: the permission set's field entry, the field's own `requiredPermissions`, the fallback set for a caller with no set, and the on-behalf-of delegator. A security service without the member, an `undefined` answer or a throw drops every entry. Each dropped entry moves the caller's ETag, so two callers who are told different things never share a `304`. A caller exempt from the projection (a platform admin, a system context) is served every entry, as before.
- **The view save door judges a view against the stored object.** A `view` write is judged against the object with every disabled package's extension folded in (the new fold option `includeDisabledExtensions`). A withheld field is a real stored field, so the view saves and keeps its column and sort. A misspelled field is still refused. Other writes are still judged against the served object, so a page or flow that names a withheld field is still refused while the package is off. A served view's `_diagnostics` is judged against the same stored object, so it no longer warns `list-view-field-unknown` or `form-field-unknown` on a withheld name the save door accepts; a misspelled field still warns.
- **The console leaves withheld names out.** The list view and the grid leave a withheld field out of `$select`, `$filter`, `$orderby`, `$searchFields` and `groupBy`, and do not draw its column. A line above the rows names it (`list.withheldFieldsLeftOut`). Nothing is written to the view or to the user's list preferences, and a sort the user saves keeps the withheld entry. Once the package is enabled, the column, the sort and the grouping come back without any write.
