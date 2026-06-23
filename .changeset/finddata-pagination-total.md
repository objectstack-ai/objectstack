---
"@objectstack/objectql": patch
---

fix(objectql): return the real `total`/`hasMore` from `findData` (#2212)

`ObjectStackProtocolImplementation.findData` previously returned placeholder
pagination metadata: `total` was always the **page** length and `hasMore` was
always `false`. Front-end tables therefore believed every result set was a
single page and never requested records past the first batch (e.g. row 51+ was
unreachable).

For a normal limited query it now runs `engine.count()` over the same `where` to
get the true match total and derives `hasMore` from `offset + page length < total`.
`engine.count()` only honors `where`, so `search`/`distinct` queries skip the
count and fall back to a page-local estimate (a full page implies there may be
more) instead of reporting a wrong total. Unlimited queries return the full set,
whose length already is the total. The aggregate/group branch now reports the
full group count as `total` with `hasMore` reflecting whether the client-side
slice dropped any groups.
