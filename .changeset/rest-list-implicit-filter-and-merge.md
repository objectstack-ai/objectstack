---
"@objectstack/metadata-protocol": patch
---

fix(data): implicit field filters compose with an explicit `filter` by AND instead of being silently dropped (#4164)

`GET /api/v1/data/:object?filter={"status":"open"}&owner_id=usr_1` used to
apply only the explicit filter: the bare `owner_id` predicate was neither
merged nor reported — it rode to the engine as a stray AST key no driver
reads, and the response over-returned. The mirror of #4134's silent zero,
same disease, opposite direction.

The two now compose the way the request reads: `{ $and: [explicit, implicit] }`
— the same combinator the engine already uses to fold the `search` predicate
into an existing `where`, and one the cross-backend filter-logic conformance
suite pins. Contradictory sides (`?filter={"status":"open"}&status=closed`)
apply both predicates and intersect to an honest empty set. Pagination totals
(`total` / `hasMore`) are computed over the merged predicate, so they cannot
disagree with `records`.

**What changes for callers:** requests that sent both an explicit `filter` and
bare field parameters now get the narrower, as-written result set instead of
the explicit filter alone. Requests sending only one of the two mechanisms are
unaffected. Thanks to #4134 (shipped previously), every bare parameter that
reaches the merge is a verified field name, so the merge can never introduce a
zero-matching predicate.
