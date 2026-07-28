---
"@objectstack/objectql": minor
"@objectstack/driver-sql": minor
---

fix(objectql,driver-sql)!: a group key is the column's value, in the shape `find()` presents it (#3849)

`groupBy: ['qty']` now returns `3`, not `'3'`. `groupBy: ['won']` returns `true` /
`false`, not `'true'` / `'false'` on one path and `1` / `0` on the other. A bucket
key is a column value, so there is one right answer for what it looks like —
whatever that column looks like on a `find()` row — and all three paths that
produce one now give it.

### What was wrong

Three code paths produce a group key, and no two of them agreed:

| | `qty` (number) | `won` (boolean) |
|---|---|---|
| `find()` | `3` number | `true` boolean |
| `aggregate()` pushed down | `3` number | `0` / `1` **number** |
| in-memory fallback | `'3'` **string** | `'false'` / `'true'` **string** |

Two independent causes:

- `applyInMemoryAggregation` ran every key through `String()`. The pushed-down
  path never did.
- The pushed-down path returns raw builder output. #3797 taught it to present
  temporal columns the way `formatOutput` does on a `find()` row, but not the
  boolean and numeric repairs — so a SQLite boolean, which has no native type and
  is stored as `0`/`1`, surfaced as an integer from `aggregate()` and as a real
  boolean from `find()`.

`engine.aggregate` chooses between the two aggregate paths per query — by whether
the driver aggregates natively, whether it advertises the requested granularity,
and whether the reference timezone is UTC — so the same column changed shape with
no change to the data or the query.

### Why it mattered

The measures were always right, which is why this went unnoticed. What broke was
downstream code that probes a raw `Map` keyed by the value's own type. `Map`
lookup is SameValueZero, so `'1'` never finds `1`:

- **Select-option labels** (`dimension-labels.ts`) — the label table is keyed by
  the option's own `value`. A numeric option value never matched a stringified
  key, so the chart rendered the raw stored value instead of its label.
- **Lookup / master-detail labels** — the id → record-name table is built by an
  inner query that always pushes down (raw ids), then probed with the outer
  query's keys, which may be in-memory (stringified). With a numeric primary key
  — routine for external/federated objects — every label missed.
- **Cross-object rebucketing** (`cross-object-rebucket.ts`) — the FK → attribute
  map is built and probed the same way, and a miss is not a fallback but
  `RESTRICTED_BUCKET`. A numeric FK filed **every row** under `'(restricted)'`:
  one bar, correct grand total, no error.
- **Drill-through** — the raw dimension value goes into the drill filter
  verbatim, so a boolean dimension drilled from the in-memory path sent
  `{ won: 'true' }` to SQLite, whose INTEGER column cannot equal the text
  `'true'`. Zero rows.

### What changed

- `applyInMemoryAggregation` (`@objectstack/objectql`) emits the value verbatim.
  Its rows come straight from `driver.find()`, so passing the value through is
  what makes the key equal the column's own read shape.
- The internal composite bucket id is now type-preserving, so `1` and `'1'`,
  `true` and `'true'` stay distinct groups rather than merging on the way in.
  BigInt is encoded explicitly — `JSON.stringify` throws on it, and a value that
  used to bucket under `String()` must not start crashing the aggregate.
- `SqlDriver.aggregate` / `.distinct` (`@objectstack/driver-sql`) present group
  keys and `min`/`max` results with the same rules `formatOutput` applies on a
  `find()` row, generalizing the #3797 temporal fix to boolean and numeric
  columns. The `protected` helpers behind it are renamed accordingly
  (`temporalFieldKind` → `readPresentationKind`, `presentTemporalValue` →
  `presentReadValue`, `presentTemporalColumns` → `presentReadColumns`) and the
  kind union is exported as `ReadPresentationKind`.

Date-bucketed `groupBy` items are unaffected: `bucketDateValue` and the dialect
bucket expressions both produce canonical string labels, and #3839 already pinned
their empty bucket.

### Gate

`packages/qa/dogfood/test/group-key-read-shape-parity.test.ts` measures both
aggregate paths against `find()` for a number, boolean and text column, on
`driver-sql` and `driver-sqlite-wasm`. It asserts the runtime TYPE, not just the
value — folding both sides through `String()` is the reflex that hid this in the
first place and would make the check pass against the bug it exists to catch.

Each half was confirmed to fail the gate on its own: reverting only the
in-memory change reddens the number and boolean cases, reverting only the driver
change reddens the boolean cases with `0<number>` against `false<boolean>`.
