---
"@objectstack/objectql": patch
---

fix(objectql): `GET /meta/object/:name` serves the multi-tenant tenant-scope index (#8375)

On a multi-tenant deployment the registry stamps `indexes: [{ fields:
['organization_id'] }]` onto every object it materializes, but the by-name
`/meta` read served the same object with **no `indexes` key at all** whenever the
answer came from the `metadata` service or a `sys_metadata` overlay row. Same
object, same moment, same host — the list read reported the index and the by-name
read denied it.

`indexes` is not decoration: a consumer reading that answer concludes the object
has no tenant index, which is the input to migration planning, to index-advice
tooling and to any consumer reasoning about query cost. The platform does create
the index; only this read denied it.

The cause was a second implementation rather than a missing line. The read exits
converge the injected system columns with `applyInjectedSystemColumns`
(`@objectstack/metadata-core`), which cannot import the producer
(`applySystemFields`, `@objectstack/objectql`) without running up the dependency
graph — so it re-implemented the half it could reach, the fields map, and
silently omitted the index. The fix deletes that split: the decision is now one
function called by the producer and by the registry's object-materialization
seam, which every read exit already replays, so the two answers are one answer.

The write path takes it back off again, exactness-bounded, so the standard Studio
GET → edit → PUT still stores a byte-identical body: an author's own tenant index
— named, ordered before their others, or declared on a single-tenant deployment
where the platform would add none — survives the round trip untouched.
