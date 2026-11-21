---
'@object-ui/types': patch
'@object-ui/core': patch
'@object-ui/data-objectstack': patch
'@object-ui/plugin-dashboard': patch
---

fix(dashboard): a global filter bound to a field holding several values is sent as `$contains`, not `=` / `$in`

Clause-②: yes (widening)
Metadata-protocol: none

A dashboard `select` / `lookup` global filter bound to a field that holds several values (`multiple: true` on a select, lookup or user field, or a `multiselect` / `checkboxes` / `tags` field) used to be sent as `field = value`, or `$in` for several values. The server refuses both on such a field: the data query answers `400 INVALID_FILTER`, and the dataset query answers `200` with a count of 0, so the dashboard showed no data. The filter is now sent as `{ field: { $contains: value } }`, and several chosen values as `$or` over one `$contains` each, which the server answers with the matching rows. Single-value fields keep `=` / `$in`.

To know whether the bound field holds several values, the dashboard reads the field's definition before it sends the widget's query:

- `@object-ui/types`: `DataSource` has a new optional member, `getDataset(name, { callerPackage })`. It reads a dataset definition and resolves `null` when no such dataset is served; a failed read rejects.
- `@object-ui/data-objectstack`: `ObjectStackAdapter.getDataset` reads `GET /api/v1/meta/dataset/:name`, sending the reader's package as `callerPackage`, and caches the answer like the adapter's other metadata reads.
- `@object-ui/core`: `buildWidgetScopedFilter` takes an optional fifth argument, the operators each bound field takes when it is stored as a JSON column, and lowers a `select` / `lookup` filter on such a field to `$contains`. A member filter on a structured JSON field (`json`, `address`) is skipped with a console warning. `boundMemberFilterNames` names the active `select` / `lookup` filters that bind a widget.
- `@object-ui/plugin-dashboard`: `DashboardRenderer` reads a dataset-bound widget's base object through `getDataset`, and a `provider: 'object'` widget's own object, through `getObjectSchema`. While that read is in flight, a widget that a `select` / `lookup` filter with a value binds draws a skeleton and sends no query. The operators come from `jsonColumnFilterOperators`, the helper the list quick filter and the filter builder use.

A data source without `getDataset`, or a dataset the server does not serve, keeps the `=` / `$in` lowering, and the dashboard logs a console warning that names the filter.
