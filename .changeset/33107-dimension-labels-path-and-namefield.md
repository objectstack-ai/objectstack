---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a lookup dataset dimension serves the referenced record's name for a relationship path and for a target titled by its `nameField`

Clause-②: no
Metadata-protocol: none

**Relationship-path lookups.** A dimension whose `field` is a relationship path ending in a lookup, such as `account.owner_id`, now serves the referenced record's display name instead of its id. The label is read from the column's own field on the object the path reaches, the same object the query joins. A `select` column at the end of a path now serves its option label too, translated under that object and field. Sorting by such a dimension (`order`) sorts by the name the rows show.

**Targets titled by `nameField`.** A lookup dimension's label is read from the target object's declared `nameField` first, then from a `name`, `title` or `label` field, then from the first text field. Before, an object titled by an `autonumber` order number with no `name`, `title` or `label` field was read through its first text field (usually the platform's ownership `queue`, empty on every row), so the id was served. A `nameField` that is a formula is still skipped, as before.

**Unchanged.** Rows are still grouped by the stored id, so two records that share a name stay two rows. A target the API does not expose, or that the reader's row scope hides, still serves the stored id. A lookup to an object whose title is its `name` field labels as it did. The same labels reach every face of a saved dataset: `POST /api/v1/analytics/dataset/query`, the `query_dataset` AI tool and its MCP tool.
