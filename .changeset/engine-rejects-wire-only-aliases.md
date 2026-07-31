---
"@objectstack/objectql": patch
---

fix(objectql): a direct engine call carrying `sort`/`select`/`skip`/`populate` now throws instead of silently dropping the parameter (#4371)

The engine folds `filter`→`where` and `top`→`limit` itself (#4346); the other
four pairs in `RPC_QUERY_ALIAS_SLOTS` fold at the RPC/protocol layer only,
because their value shapes need lowering (`sort`'s `{field: 'asc'}` record
form, `populate`'s name list) that belongs there. A **direct** `engine.find()`
/ `findOne()` never crosses that layer, so one of those keys used to ride the
AST verbatim, drivers read only the canonical name, and the request succeeded
with the parameter discarded — `sort` + `limit` ("the latest N") silently
returning an arbitrary N. Three shipped instances were fixed in #4370, and a
fourth sat in the engine's own autonumber seeding (`select` — now `fields`).

`find`/`findOne` now reject a non-null wire-only spelling with an error naming
the canonical key and shape, e.g.:

> `find('task') does not accept 'sort': 'sort' is a wire spelling of
> 'orderBy', folded by the RPC/protocol layer — a direct engine call bypasses
> that fold, so the value would be silently dropped, not applied. Pass
> 'orderBy' (SortNode[]: [{ field, order: 'asc' | 'desc' }]) instead.`

Migration for direct engine callers (HTTP/RPC callers are unaffected — the
wire fold is unchanged): `select: [...]` → `fields: [...]`;
`sort: {f: 'asc'}` or `sort: [{field, order}]` → `orderBy: [{field, order}]`;
`skip: n` → `offset: n`; `populate: ['rel']` → `expand: {rel: {object: 'rel'}}`.
An explicit `null` under a wire spelling remains a withdrawal (ignored), and
the where-only methods (`update`/`delete`/`count`/`aggregate`) are unchanged —
their contracts honour no sort/projection/pagination in either spelling
(unknown-key enforcement there is #4371's follow-up scope).
