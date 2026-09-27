---
"@objectstack/lint": patch
---

`filter-preset-comparand` now judges a list page's `interfaceConfig.filterBy` and a lookup field's `lookupFilters`, consumed filter carriers the shared filter walk never entered (#19791).

Both carriers are rule arrays (`{ field, operator, value }`) whose values reach the engine's `where` verbatim, and neither schema carries a preset check. So `{ field: 'close_date', operator: 'gt', value: 'last_30_days' }` in either one parsed green and linted green, then the engine refused it at query time (`INVALID_FILTER` / 400). The same rule on a component `dataSource.filter` or a view `filter` was already refused. `filterBy` and `lookupFilters` join `FILTER_KEYS`, so `os lint`, `os validate` and the runtime publish gate (for `page` and `object` writes) now refuse it where it is written. Each finding carries its path (`pages[0].interfaceConfig.filterBy[0].value`, `objects[2].fields.account.lookupFilters[0].value`).

- **Which object a condition addresses.** The field-typed arm, which refuses a preset under equality or membership on a `date` / `datetime` field, binds `filterBy` to `interfaceConfig.source`. Without a `source` it falls back to the page's `object`. It binds `lookupFilters` to the field's `reference` and never to the object that owns the field, because the picker queries the referenced object. A `relatedListFilter` on the same field still binds to the owner.
- **`filter-token-unknown` reaches the same two carriers.** An unresolvable placeholder such as `{current_user}` in `filterBy` or `lookupFilters` is now reported, as it already is in a view's `filter`. `{current_user_id}` and the date macros stay clean.
- **What you do:** in a `filterBy` or `lookupFilters` rule, replace a preset name with the `{date-macro}` window the message names (`{ operator: 'gte', value: '{30_days_ago}' }`) or with an ISO date.
