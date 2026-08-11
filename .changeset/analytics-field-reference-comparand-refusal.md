---
"@objectstack/service-analytics": minor
---

fix(analytics)!: a `{ $field }` comparand is refused on both SQL-lowering doors instead of being BOUND as the comparison's value (#7598)

**⚠️ Behaviour change.** A filter whose comparand is a field reference —
`{ amount: { $gt: { $field: 'budget' } } }`, the shape
`FieldReferenceSchema` declares and `compileCelToFilter` emits for a
field-to-field comparison in a CEL permission / RLS rule — used to COMPILE on
both of this package's doors. It now refuses: `INVALID_FILTER` / 400 on the
analytics `where` door, `READ_SCOPE_COMPILE_FAILED` / 500 on the read-scope
lowering (each door's existing envelope, unchanged).

#7598 was filed reading "these compilers still REFUSE `$field`". Measured on
`origin/main` (`5823d593d`), nothing refused. For the six scalar comparison
operators — exactly the ones #5222 taught `driver-sql` to compile into a
same-table column-to-column comparison — the reference OBJECT went into the
bind list:

| face | `{ amount: { $gt: { $field: 'budget' } } }` |
|---|---|
| `read-scope-sql` | `"person"."amount" > ?` · bound to `{"$field":"budget"}` |
| `where` → `NativeSQLStrategy` | `WHERE amount > $1` · bound to the JSON TEXT `{"$field":"budget"}` |
| `where` → `/analytics/sql` echo | `WHERE amount > $1` · bound to the reference OBJECT |
| `where` → ObjectQL engine | reached `driver-sql`, which compiles it CORRECTLY since #5222 |

So the defect was a silent wrong answer, not a refusal: a syntactically perfect
predicate comparing a column against a value no row can hold. Three of the four
faces answered differently, and on the read-scope door the one answering wrongly
is an administrator's RLS predicate. The gates assumed to be catching this
(`isBindableComparand` / `isRenderableTextComparand`) had not drifted from
`driver-sql` — they are simply never ASKED about that position, only about the
LIKE family and `$in` / `$nin` / `$between` MEMBERS.

**What this does not do:** it does not bring the capability to these compilers.
The four maintainer rulings that make a referenced column name safe in a SQL
identifier position (same-table only, declared-only enumeration, tenant-isolation
column forbidden on both sides, same comparison class) all turn on metadata
`StrategyContext` does not expose — neither an object's declared field set nor its
tenant-isolation column — so these compilers cannot enforce them, and shipping a
port without them would open a comparison surface onto the tenant boundary.
Implementing it here is a `packages/spec` contract question, left open on #7598.

Field-to-field RLS rules continue to work on the ObjectQL engine path, where the
driver compiles them with the metadata it owns; they are now loudly refused,
rather than silently mis-answered, on the raw-SQL analytics path.

Positions already refused before this change keep their exact wording — the LIKE
family, `$in` / `$nin` members, and a bare `{ field: { $field: … } }` — because
each of those refusals already CONVERGES with `driver-sql`'s own #5222 refusal
arm. `minor` rather than `patch` follows #5234, the same class of change on the
same two doors.
