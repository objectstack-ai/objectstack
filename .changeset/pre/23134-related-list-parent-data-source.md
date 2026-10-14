---
'@objectstack/spec': minor
---

feat(spec): `record:related_list` declares its parent record with a binding of its own, `parentDataSource`, beside the child-row `dataSource` (#23134)

Clause-②: yes (widening)

- **What is new.** `ComponentPropsMap['record:related_list']` (`RecordRelatedListProps`) accepts `parentDataSource`: the PARENT record the list hangs off, bound by a query. Its shape is the element data-source object binding `{ object, view?, filter?, sort?, limit? }` (`ElementDataSourceSchema`, referenced, not copied), the same binding `dataSource` takes on every page component. A binding the data-source shape refuses (no `object`, an unknown key, the MongoDB-style `filter` record, the `api` arm) is refused here too, at `parentDataSource`.
- **The single-record rule.** The parent is the FIRST row of the bound set by the binding's `sort`; declare `limit: 1` to say one row is meant. When no row answers, the block renders a loud absence, never an empty list. `relationshipValueField` is read on that row. This is the rule `record:details`, `record:highlights` and `record:quick_actions` already take for their own `dataSource`.
- **The fallback.** Without `parentDataSource`, the record page's record context remains the parent, as before. Every related list that parsed before parses unchanged.
- **`dataSource` keeps its meaning.** The node-level `dataSource` on `record:related_list` is still the CHILD rows the list draws (it fills `objectName`, `columns`, `filter`, `sort` and `limit`) and is never read as the parent.
- **Planned, not yet rendered.** The key's describe opens with `[PLANNED — not yet rendered]`: no objectui renderer reads it yet. objectui reads it once a release carrying this key is installable there; until then a related list on an `app` page still finds no parent.
- **Refused elsewhere.** Every other `ComponentPropsMap` row refuses `parentDataSource` as an unknown key, and `os validate` reports it as `component-props-unknown-key`.

```ts
{
  type: 'record:related_list',
  properties: {
    objectName: 'contact',
    relationshipField: 'account_id',
    parentDataSource: {
      object: 'account',
      filter: [{ field: 'is_primary', operator: 'equals', value: true }],
      limit: 1,
    },
  },
}
```
