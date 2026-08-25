# objectstack-query — Evals

Test cases for the objectstack-query skill. Each eval gives the model a
natural-language query need and checks the emitted ObjectQL against the
subset the engine actually executes.

## Planned Evals

1. **Operator choice** — "Filter accounts where status is active or pending,
   excluding deleted ones." Expect `$in` (or `$or`) plus `$ne`/`$not`;
   penalize string operators on non-string fields and `deleted_at: null`
   instead of `$null`.
2. **Nested relation filter** — "Find orders where the customer's country is
   US." Expect a nested relation filter (`customer: { country: 'US' }`),
   not a `joins` array (removed in protocol 17).
3. **Pagination pattern** — "Implement infinite scroll for a feed." Expect
   manual keyset pagination (`where` on the sort key + `orderBy` + `limit`);
   fail if the answer uses the removed `cursor` property.
4. **Aggregation correctness** — "Count deals by region and show total
   revenue." Expect `groupBy` + `count`/`sum` with aliases; on SQL targets
   the answer must stay within `count`/`sum`/`avg`/`min`/`max`.
5. **The FILTER-WHERE trap** — "One call: total orders and count of orders
   over $1000." The correct answer is **two** aggregate calls with the
   condition in `where`; fail if the answer puts `filter` on an aggregation
   (silently returns the unfiltered number).
6. **Post-aggregation filtering** — "Customers with more than 5 orders."
   Expect aggregate + app-code filter of the group rows; fail on `having`
   (schema-reserved, silently dropped).
7. **Date-bucketed time series** — "Monthly revenue for the last year."
   Expect structured `groupBy` with `dateGranularity: 'month'`, not
   client-side bucketing and not window functions (schema-reserved).
8. **Expand vs direct query** — "Show a task list with assignee names; page
   through one project's tasks." Expect `expand` for the lookup display and
   a direct query on the related object for pagination (nested
   limit/offset are not applied inside `expand`).
9. **Search subset** — "Keyword search over articles." Expect
   `search: { query, fields }` only; fail if the answer relies on `fuzzy`,
   `boost`, `operator`, `minScore`, `language`, or `highlight` (all
   schema-reserved).
