---
'@objectstack/mcp': patch
---

feat(mcp): `aggregate_records` returns select groups in their declared option order and names the currency of a fixed-currency amount

Clause-②: yes (widening)
Metadata-protocol: none

Two facts the MCP `aggregate_records` tool now reads from the object as the caller is served it, on both the HTTP and the stdio door:

- Groups keyed by a `select` or `radio` field come back in the order the field declares its options, instead of the order the driver returned them in. A value no option declares, such as a null, sorts last. When the call groups by several keys, the order is applied to the leading select keys. From the first key that is not a select field onward, the driver's order stays. The groups are sorted before the tool's row cap, so the groups the cap keeps are the first ones in declared order.
- An amount column (`sum`, `avg`, `min` or `max`) over a field whose `currencyConfig` is `currencyMode: 'fixed'` is named in a new result member `currencies`, which maps the column's alias to its ISO 4217 code, e.g. `"currencies": { "total": "USD" }`. The member is present only when at least one column has a currency. `count`, `count_distinct`, non-currency fields and `dynamic`-mode amounts carry none. A `record`-mode amount is still answered only when it is grouped by its currency code field, so each group's code is already in its row.

A field the caller's served schema does not show is never ordered by its options or named. A host whose bridge cannot serve the definition answers exactly as before. Existing members (`rows`, `totalGroups`, `truncated`) are unchanged.
