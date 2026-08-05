---
"@objectstack/driver-memory": minor
---

fix(driver-memory): the analytics (cube) face stops round-tripping filter comparands through `string[]`, which was losing booleans, `null` and numeric-looking strings (#5373)

**This is an observable behaviour change on a shipped surface: widgets whose
`where` carries a boolean, a `null`, or a numeric-looking string comparand will
show different — correct — numbers.** Some of them go from zero rows to a real
answer; others go from the whole table down to the rows actually asked for.

## What was happening

`MemoryAnalyticsService` lowers `AnalyticsQuery.where` into a cube-style
`{member, operator, values}` list whose `values` was typed `string[]`, because
the cube WIRE format serialises filter values as strings. So every comparand
made a JS value → string → JS value round trip on its way to the pipeline, and
that round trip is lossy for anything that is not already a string:

| `where` | stringified | recovered as | compared against | rows |
|---|---|---|---|---|
| `{is_active: true}` | `'1'` | the number `1` | stored `true` | **0** |
| `{is_active: false}` | `'0'` | the number `0` | stored `false` | **0** |
| `{closed_at: null}` | — | *(dropped entirely)* | — | **the whole table** |
| `{closed_at: {$ne: null}}` | `''` | `''` | stored `null` | **the whole table** |
| `{code: '100'}` (TEXT column) | `'100'` | the number `100` | stored `'100'` | **0** |
| `{is_active: {$ne: true}}` | `'1'` | the number `1` | stored `true`/`false` | **the whole table** |

mingo compares across JS types the way MongoDB compares across BSON types —
never equal — so none of these is an error. Each is a wrong row set, silently.

The two directions fail differently, and the widening one is worse. A boolean
filter that returns nothing renders an empty chart, which someone notices. A
`null` filter that returns everything renders a *normal-looking* chart: a
"closed_at is empty" widget quietly counted the closed records too. That is the
direction #3948 outlawed, and on an RLS read scope it is an unauthorized read
rather than a wrong number.

`{is_active: true, stage: {$nin: ['lost']}}` is `AnalyticsQuerySchema.where`'s
own docstring example. It returned zero rows on this face.

## Why the encoding could not simply be fixed

`stringifyForCube` encoded booleans as `'1'`/`'0'` "so that downstream consumers
expecting SQLite-style numeric booleans match correctly". That justification is
sound for the SQL-generating exit and false for the in-memory one — and both
exits shared the single encoding. There is no string spelling of `true` that is
right for `WHERE is_active = ?` and for a mingo `$eq` against a stored boolean at
the same time, so making the round trip lossless would have meant tagging values
in a format the two exits then have to agree to decode.

So the round trip is **gone** instead. `values` is `unknown[]`; the comparand
stays whatever the author wrote, and each exit converts at its own boundary
where it knows what it needs. This is affordable because the triple is a purely
internal intermediate: `AnalyticsQuery.where` is a `FilterCondition` and nothing
else (#5375 removed the leg that also accepted a cube-style array as input), and
the API layer actively rejects a `{member, operator, values}` array on the wire.
No caller, no spec schema and no serialized form observes its shape — this
change touches zero spec bytes.

## What changes for you

Filters are evaluated against the values you wrote:

- `{is_active: true}` selects the true rows instead of none.
- `{closed_at: null}` selects the null rows instead of every row, and
  `{closed_at: {$ne: null}}` selects the complement instead of every row.
- `{code: '100'}` on a TEXT column matches the string `'100'` instead of nothing.
- `{qty: 100}` on a numeric column is unchanged — it was already right.

`generateSql()` is corrected on the same cases, because a fix that satisfied
mingo while emitting SQL meaning something else would only have moved the bug:

- a numeric-looking string is now quoted (`code = '100'`, previously `code = 100`)
  while a real number still is not (`qty = 100`);
- a null comparand becomes a nullness test (`closed_at IS NULL` /
  `closed_at IS NOT NULL`) rather than the `= NULL` that is never true in SQL,
  or — as before this fix — no clause at all;
- booleans keep the SQLite-style `1`/`0` spelling, which was always right for
  this half.

Temporal comparands still convert, and now do so through the driver's own
storage-form rule (`filterComparandStorageForm`, keyed on the declared field
kind, #4047) rather than an ad-hoc `toISOString()`. A `Date` against a declared
`datetime` column therefore keeps meeting the canonical UTC ISO text the driver
wrote — a second derivation of that rule inside the analytics face is exactly
the in-package divergence #5240 ruled against.

Nothing else moves: operator vocabulary, the #5345 refusals, `$and` folding,
nested-relation flattening, time dimensions and the empty filter are unchanged.

## Coverage

The cases live in the shared conformance file beside the #5324/#5345 shape
table, not in a suite of their own. `FILTER_LOGIC_CASES` varies the filter's
SHAPE over an all-string fixture — deliberately, so nothing in it is about
coercion — which is why every one of its cases stayed green through this defect.
The new block varies the comparand's TYPE over the fixture measured in the
issue, and holds the same invariant: the analytics face must return the same ids
as `find()`, or refuse. Reverting only the source change fails 11 of the new
assertions, across both exits.
