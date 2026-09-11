---
'@objectstack/driver-sql': patch
---

A `multiple: true` boolean column keeps its `$contains` membership filter

A `multiple: true` field is stored as a JSON TEXT array, and on such a column
`$contains` is not a substring test — it is the MEMBERSHIP spelling, the one
operator #7398 left working there after refusing the equality family. The
declared-type gate added in #14079 fired on the boolean limb regardless of
storage shape, so a membership filter over a `multiple: true` `boolean` or
`toggle` column compiled to the always-false constant:

```
{ flags: { $contains: 'true' } }
- select * from `probe_tbl` where 1 = 0                 (matched nothing)
+ select * from `probe_tbl` where `flags` GLOB '*true*' (matches the rows whose array holds it)
```

That is the fail-CLOSED direction: the query returns a `200` with no rows,
byte-identical to a filter that legitimately matched nothing, so an author sees
"no matching records" and doubts their data rather than the filter. Both
registry fills — `initObjects` and `registerExternalObject` — were affected, and
both are fixed, because the repair is at the predicate they share.

The same shape on a `multiple: true` NUMBER was already correct (its registry is
filled `!field.multiple`), and #15683 spelled the equivalent carve-out for the
temporal limb at the predicate. This change spells it on the boolean limb, the
one that had neither. `booleanFields` itself is deliberately unchanged: it is a
read-coercion registry, and the three other seams that read it — the Postgres
aggregate cast, the presentation-kind door and `formatOutput`'s row pass — are
about "this column holds a boolean", which a multi-valued column still does.

⚠️ Not a widening of the gate: a SCALAR `boolean` / `toggle` column still
answers the declared no-match for every positive text operator and `$notContains`
its exact complement, unchanged. What moves is exactly the JSON-column cell.
