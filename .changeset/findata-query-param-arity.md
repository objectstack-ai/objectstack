---
'@objectstack/metadata-protocol': patch
---

`findData`'s shared list-query normalizer now checks the ARITY of every query
parameter it reads, instead of coercing a repeated one blind (#7321).

`IHttpRequest.query` is `Record< string, string | string[] >` and the array arm
is produced by a real first-party adapter (`NodeHttpServer` hands `?x=1&x=2`
through as `['1','2']`). Every coercion in this normalizer was written for the
string arm, so a repeated parameter was coerced into a value nobody asked for
and served under a 200:

- `?$top=1&$top=2` → `Number(['1','2'])` is `NaN` → the driver was called with
  `limit: NaN`. Same for `$skip` / `offset`.
- `?status=open&status=won` → the leftover-key bucket lowered it to
  `where: { status: ['open','won'] }`, and a bare array is not a valid field
  spec — it matches no row on any backend. An empty page, 200 OK.
- `?$search=a&$search=b`, `?$count=true&$count=false` and a repeated body
  `object` behaved the same way, each in its own flavour.

Those are now refused with `400` / `error.code: INVALID_REQUEST` — the code this
same normalizer already answers for the identical condition reached the other
way (two SPELLINGS of one slot given different values, #4181 → #3795). A
one-element array is one occurrence and is unwrapped, not refused; an empty
array is no occurrence.

**Unchanged on purpose — this is a per-parameter judgement, not a sweep.**
`$select` / `select` / `fields`, `$expand` / `populate` / `expand`,
`$searchFields`, `$orderby` / `sort` / `orderBy`, `$filter` / `filter` /
`filters` / `where` (whose array arm is a FILTER AST, not a repetition),
`groupBy` and `aggregations` all accept the array arm on purpose and keep it
byte for byte. A blanket "reject repeated parameters" rule would have broken
every one of them.

Not reachable on today's production Hono adapter, which collapses repeated
parameters to the first value before any handler runs; it becomes reachable when
that collapse is removed (#6878 route 2).
