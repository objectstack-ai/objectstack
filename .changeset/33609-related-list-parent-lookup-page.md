---
'@object-ui/console': patch
'@object-ui/plugin-detail': patch
---

fix(console): a related list keyed by a parent lookup no longer blanks the record page

Clause-②: no
Metadata-protocol: none

A `record:related_list` may name the parent field its `relationshipField` stores (`relationshipValueField`), for example an order's `selected_plan` lookup keying the plan's lines. On a record page such a list made the whole page fail with "Couldn't load this record" (「无法加载此记录」): the Console put it into the one-request record page call, which only answers lists keyed by the record's own id and refuses the whole request otherwise (400 `invalid_relationship`).

- The record page call now leaves out every related list it cannot answer, by the same rule the related-count prefetch already used: a list keyed by a parent field other than `id`, or bound to a `dataSource` / `parentDataSource` of its own. Those lists read their rows themselves, as before the one-request page. Lists keyed by the record's id still come with the page call.
- A related list keyed by a parent lookup now filters by the lookup's stored id. The page record (and a `parentDataSource` parent) is read with its lookups expanded, so the list used to filter by the related record object, which the filter refused, and drew no rows.
