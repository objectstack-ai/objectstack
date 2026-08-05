---
"@objectstack/driver-memory": minor
---

fix(driver-memory): the analytics (cube) face compiles `$notContains` to a predicate that actually excludes rows, instead of a bare mingo `{$not: 'x'}` that constrains nothing (#5374)

**This is an observable behaviour change on a shipped surface: widgets whose
`where` carries `$notContains`, `$contains`, or an empty `$in` will show
different — correct — numbers.** Every one of them moves in the same direction,
from a wider row set to the rows actually asked for, because each of these
defects made a predicate mean less than it says.

## What was happening

`MemoryAnalyticsService` mapped each cube operator to the NAME of a mingo
operator, and the call site filled that name in as
`matchStage[field] = {[name]: comparand}`. That shape can express "compare this
field to this value" and nothing else, so the two operators that need to WRAP
their comparand were pushed through it anyway:

| `where` | compiled `$match` | analytics | `find()` |
|---|---|---|---|
| `{name: {$notContains: 'et'}}` | `{name: {$not: 'et'}}` | **3** | 2 |
| `{name: {$notContains: 'a'}}` | `{name: {$not: 'a'}}` | **3** | 0 |
| `{name: {$contains: 'a.p'}}` | `{name: {$regex: 'a.p'}}` | **1** | 0 |
| `{name: {$contains: 'ALPHA'}}` | `{name: {$regex: 'ALPHA'}}` | **0** | 1 |
| `{code: {$in: []}}` | *(no predicate emitted)* | **3** | 0 |

- **`notContains` → `'$not'`.** mingo's `$not` takes a regex or an operator
  expression; handed a bare scalar it constrains nothing. The predicate was
  emitted, appeared in the pipeline, and passed the whole table. A predicate
  that is emitted and inert is indistinguishable from a working one at the
  author's end — the same amplifying direction as #3948, reached a third way.
- **`contains` → `'$regex'`** was the right operator with the comparand handed
  in raw, so it was neither escaped (a `.` matched any character) nor
  case-folded, while the live query path escapes and matches `/…/i`. One
  `where`, two meanings, depending on which face read it (#5240).
- **an empty `$in`** hit the call site's `values.length > 0` guard and emitted
  no predicate at all, so the query widened to the whole table where `find()`
  returned nothing.
- **an operand that is not a comparand** — a `$contains` pattern, a `$exists`
  flag — went through the field's storage-form conversion anyway, so on a
  declared `datetime` column the PATTERN itself was rewritten into canonical
  form and then matched rows `find()` does not match (#4047).

## What changed

The operator table now holds a **predicate builder** per operator rather than an
operator name, so `notContains` can say `{$not: {$regex: …}}` and the class of
"this operator needs a structure and the table can only hold a name" is gone
rather than this one instance of it. `$in` / `$nin` / `$lte` / `$exists`, which
the call site had grown an `if` chain for, are ordinary rows in that table now.

The substring rule itself is **borrowed from the driver** (new narrow
`InMemoryDriver.filterSubstringPattern`, alongside `filterComparandStorageForm`)
instead of re-derived, so `contains` on the analytics face escapes and case-folds
exactly as `find()` does and the two cannot drift apart again.

The `opMap[operator] || '$eq'` fallback — under which a misspelled or unmapped
operator silently became an EQUALITY comparison — is gone. It was already
unreachable after #5345 gated the vocabulary upstream, but only until someone
widened that vocabulary, which #5345 deliberately made a one-line edit. The
predicate table is keyed by the operator union derived from that same table, so
the widening edit now **fails to compile** until the predicate exists.

Two dead entries were deleted with it: `'notSet': '$exists'` (unreachable, and
inverted if it ever had been reached) and `'inDateRange': '$gte'` (unreachable,
and a one-ended `>=` answer to a two-ended range — its own comment conceded
"Will need special handling" and nothing implemented it).

## Not changed

The `generateSql()` exit is untouched. Its operator-layer defects are #5433,
filed and deliberately not bundled.
