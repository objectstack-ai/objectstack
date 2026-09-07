---
"@objectstack/spec": minor
---

feat(spec): `ComponentPropsMap['object-kanban']` declares `limit`, the row cap four objectui faces already implement (#16503, the spec half of objectui#8172)

`object-kanban` gains one optional authorable key:

```ts
limit: z.number().int().positive().optional()
```

Maximum number of records loaded onto the board (row cap), lowered to the top-level `$top` of the board's one query. The renderer default stays 100 and is documented rather than declared, so an unset key remains unset. The component-level `dataSource.limit` wins when both are set, and a bound named view's `pagination.pageSize` fills the key only when the component authored none — the `ElementDataSourceGate` precedence table, unchanged.

Measured at the objectui pin this repo builds against (`.objectui-sha` = `a472b0716`): `plugin-kanban` reads `schema.limit` as the query's `$top` (wired by objectui#4025), `OBJECT_KANBAN_DATA_SOURCE` maps `limit: 'limit'`, `KanbanSchema` declares `limit?: number`, and `content/docs/plugins/plugin-kanban.mdx` teaches it with a typed snippet (`limit: 250`) plus a Properties row. The strict props map refused the key by name, so an author following the published docs wrote a node the save gate rejected with the same `unrecognized_keys` verdict a typo gets. Decision batch #68 (2026-09-07, option A): the contract declares the capability that is already implemented, documented and in use.

Widening a published accept set (Clause-② yes): `safeParse({ objectName: 'x', limit: 250 })` now succeeds; every other undeclared key on the node is refused exactly as before. objectui#8172 publishes the key in the registry declaration on its side.
