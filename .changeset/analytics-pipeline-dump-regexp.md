---
"@objectstack/driver-memory": patch
---

fix(driver-memory): the analytics pipeline dump shows its RegExp pattern instead of `{}` (#7853)

`MemoryAnalyticsService.query()` returns `AnalyticsResult.sql` — a stage-by-stage
dump of the mingo pipeline it actually executed, and the only thing an author
debugging an in-memory chart is given. It dumped each stage with a bare
`JSON.stringify`, and a `RegExp` has **no own enumerable properties**, so every
pattern operand rendered as `{}`:

```
-- MongoDB Aggregation Pipeline on table: deal
/* Stage 1: $match */ {"name":{"$regex":{}}}
```

The `$match` stage was reported as constraining `name` by an empty object. The
one field the reader came for is the one the dump dropped. Measured across the
twelve operators this face declares, exactly three carry a pattern and all three
were affected: `$contains`, `$icontains`, and `$notContains` (nested inside
`$not`). The same three now render:

```
/* Stage 1: $match */ {"name":{"$regex":"/et/"}}
/* Stage 1: $match */ {"name":{"$regex":"/[Bb][Ee][Tt]/"}}
/* Stage 1: $match */ {"name":{"$not":{"$regex":"/et/"}}}
```

**No executed behaviour changes.** This dump is explicitly not SQL — its own
header says `-- MongoDB Aggregation Pipeline on table: …` — so it is a
transparency surface, not a runnable one, and the rows `query()` returns and the
SQL `generateSql()` emits are byte-identical before and after. The other nine
operators' dumps are unchanged.

**Why the pattern's own literal syntax** (`/source/flags`) and not the
mongo-shaped `{"$regex":"…","$options":"…"}` the rest of the dump speaks: the
`RegExp` sits AT the `$regex` key, so a value replacer producing the mongo pair
renders the doubled `{"$regex":{"$regex":"et","$options":""}}` — a shape no mongo
query has. Flattening it to the real spelling would mean rewriting the parent
object, making the dump disagree with the pipeline it claims to dump, since what
mingo executes at that key is a JS `RegExp`. The literal form is also the only
one-token rendering that keeps the FLAGS, which matter here: `$icontains`' fold
lives in the pattern source (#6520) while `$contains` is case-exact (#7723).
