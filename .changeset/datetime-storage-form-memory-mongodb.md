---
"@objectstack/driver-memory": patch
"@objectstack/driver-mongodb": patch
---

fix(driver-memory,driver-mongodb): `Field.datetime` has one storage form per driver (#4047)

The non-SQL counterpart of ADR-0053 D-B (#3912). Both drivers let the writer
decide a datetime value's runtime type, and both compare across types by type
bracket rather than by value — so a string comparand never matched a `Date`
value, in either direction, for **every** operator including `$gte`.

A datetime column genuinely held both forms: the drivers' own
`created_at`/`updated_at` defaults bind a `Date` (mongo) or an ISO string
(memory), while REST/JSON writes, relative-date tokens and `initialData`
fixtures supply the other. A dashboard date window therefore answered with
whichever half happened to match the comparand's type — on MongoDB, where
`created_at` is a BSON `Date` and dashboard bounds are strings, that meant
**no rows at all**, which is worse than the final-day loss #3777 fixed.

Each driver now has one canonical form, applied on write and to every filter
comparand:

| Driver | `datetime` | `date` |
|---|---|---|
| `driver-mongodb` | BSON `Date` — the dialect's native instant, its `timestamptz` | `YYYY-MM-DD` text |
| `driver-memory` | canonical UTC ISO text (sorts chronologically under the string comparison mingo performs; survives JSON persistence) | `YYYY-MM-DD` text |

Both learn their temporal fields from `syncSchema`, so an object that was never
declared is left exactly as written — the drivers do not guess types from
values. `driver-memory` additionally converges rows already in the table when
the schema arrives, which catches `initialData` fixtures and anything a
persistence adapter restored (the in-memory analogue of
`backfillCanonicalDatetimes`, and idempotent like it).

`Field.date` deliberately stays timezone-naive text on both — converting it to
an instant would invent a midnight and re-couple it to a zone. The
calendar-day bound semantics from #3777/#4042 are unchanged and now compose
with the converged storage: the whole-day rewrite runs on the calendar string
first, and only the resulting bound is converted to the storage form.
