---
"@objectstack/spec": major
"@objectstack/metadata-protocol": major
---

feat(spec,metadata-protocol)!: a sort node spelling its direction `direction` is a 400, not a silently reversed page (#4721)

**FROM → TO:** `orderBy: [{ field: 'updated_at', direction: 'desc' }]` →
`orderBy: [{ field: 'updated_at', order: 'desc' }]`. One word. If you are on the
`{field, direction}` shape because you moved code over from
`IReportService.orderBy`, that contract is unchanged — it is `orderBy` on the
QueryAST / `EngineQueryOptions` axis that has always been `{field, order}`.

## What was wrong

`SortNodeSchema` was a plain `z.object`, so zod's default `.strip` applied.
Measured on `main` before this change:

```
SortNodeSchema.parse({ field: 'updated_at', direction: 'desc' })
  →  { field: 'updated_at', order: 'asc' }
```

`direction` was discarded and `order` fell back to its `asc` default. The sort
therefore ran in the **opposite** direction and the request succeeded. Paired
with `limit` — which is how a caller asks for "the latest N" — that is not a
reordered page but a **different set of rows**, returned under an ordinary 200
with nothing in the response to distinguish it from the answer that was asked
for.

`direction` is not a typo. It is the live vocabulary of a neighbouring contract,
`IReportService.orderBy` (`@objectstack/spec/contracts`), and
`plugin-auth/objectql-adapter.ts` already translates between the two by hand — a
translation known to be necessary and enforced nowhere, which is the ADR-0049
shape.

## What changed

Both doors onto that shape, in one change:

1. **`SortNodeSchema`** (`spec/src/data/query.zod.ts`) is now `strictObject`
   with `aliases: { direction: 'order' }`. An unknown key is rejected, and
   `direction` specifically gets the translation in the error message — edit
   distance can never bridge `direction` → `order`, so a bare "unrecognized key"
   would leave the caller exactly where the silent strip did.
2. **`normalizeSortNodes`** (`metadata-protocol/src/protocol.ts`), the ingress
   every REST/RPC `orderBy` funnels through, refuses `{ field, direction }` with
   `400 INVALID_SORT` naming `order` and quoting the corrected node. Closing only
   the schema would repeat the door asymmetry of #1535/#4522: `SortNodeSchema` is
   reachable by three paths the REST normalizer never sees.

| `orderBy` you send | Before | After |
|:--|:--|:--|
| `[{ field: 'x', order: 'desc' }]` | descending | unchanged — descending |
| `[{ field: 'x', direction: 'desc' }]` | **200, ascending** | `400 INVALID_SORT`, message names `order` |
| `[{ field: 'x', order: 'desc', direction: 'asc' }]` | 200, descending | `400 INVALID_SORT` |
| `'-x'` / `['-x']` / `{ x: 'desc' }` | descending | unchanged |
| `{ direction: 'desc' }` (the `{field: direction}` map) | sorts by column `direction` | unchanged — a column may legitimately be called `direction` |

Scope is deliberately narrow: **`QuerySchema`'s top level is untouched** and
still accepts undeclared keys (`QuerySchema.safeParse({ object: 'sales',
nonsenseKey: 1 }).success === true`). That is tracked in the #4001 campaign map
for its own batch, not smuggled in here.

Related: #4674, #4720, #4363, #4371, #4001, ADR-0049.

<!-- adr-0087: registered sort-node-direction-rejected -->
