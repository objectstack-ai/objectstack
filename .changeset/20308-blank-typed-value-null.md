---
"@objectstack/objectql": minor
---

fix(objectql)!: a cleared number, boolean, date, datetime or time field stores `null` on every backend, and a `progress` field refuses a non-numeric value (#20308)

Clause-②: no (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner and the ADR-0087 disposition below, never by the level). The one
narrowing: a non-numeric string written to a `progress` field is now refused
with `invalid_number` on memory and SQLite, where it used to be stored.

## What was wrong

The record validator reads a blank string — `''`, or whitespace only — as
"missing", and returns before any type check. Nothing rewrote the value, so the
driver received the blank exactly as sent. The same clear of one field therefore
had three outcomes:

- **memory and SQLite** stored `''` in a number, currency, percent, rating,
  slider, progress, summary, boolean, toggle, date, datetime or time column, on
  every write door (create, update, batch, `createMany`, `updateMany`). On SQLite
  a stored `''` on a boolean then read back as `false`.
- **PostgreSQL** refused the statement (`invalid input syntax for type
  numeric` / `boolean` / `date`), which REST answered as `500 DATABASE_ERROR` —
  or as a failed row with `INTERNAL_ERROR` on the batch doors.

objectui's edit form sends a cleared date, datetime or time box as `''`, so this
is the ordinary "clear the field and save" gesture.

Separately, `progress` had no type check at all: a non-numeric string such as
`'abc'` was stored verbatim on memory and SQLite, and failed at the driver as a
`500` on PostgreSQL.

## What changes

- **The write door reads a blank on a non-string-typed column as `null`.** Every
  field whose declared type is in the spec's `NON_TEXT_STORED_VALUE_TYPES` (the
  numeric types including `progress` and `summary`, `boolean`, `toggle`,
  `date`, `datetime`, `time`) has a blank string replaced by `null`. It happens
  at the start of `ObjectQL.insert()` and `ObjectQL.update()`, before the
  middleware, the hooks, the defaults and validation read the payload, and at
  the same point in `ObjectQL.validate()` (the dry run). Every REST, batch and
  import door writes through those methods. The caller's own objects are never
  mutated.
- **What that means for a write:** the column stores `null` on every backend,
  and PostgreSQL no longer refuses the request. A blank on a `required` field is
  refused with `required`, exactly as `null` is. On create, a blank takes the
  field's `defaultValue` exactly as `null` does, so a blank on a required field
  that declares a `defaultValue` is now accepted with the default.
- **String-stored columns are untouched.** A text, lookup or select `''` is still
  stored as `''`.
- **`progress` joins the numeric type check.** A non-numeric string on it is
  refused with `invalid_number`, as on `number`. No `min`, `max` or `scale` is
  newly enforced on it. This is the narrowing above.
- **`summary` is exempt from that type check.** It is in the spec's
  `COMPUTED_VALUE_TYPES` ("never client-written; shape is producer-owned"), so
  the roll-up producer decides its value's shape. A `max` or `min` roll-up over a
  date, datetime or time child field keeps recomputing on memory and SQLite as
  before, and a non-numeric value written to a `summary` is not judged by this
  check. A blank on a `summary` still becomes `null`.

## Rows already stored

This fixes new writes only. Rows written earlier on SQLite (and on memory,
MongoDB or libSQL) may still hold `''` in such a column; on SQLite a boolean
holding `''` reads back as `false`, and one holding whitespace as `true`.
PostgreSQL never stored one. To repair a SQLite table, run this once per
non-string-typed column (a field of one of the types listed above):

```sql
UPDATE "<object>" SET "<field>" = NULL
 WHERE typeof("<field>") = 'text' AND trim("<field>", ' ' || char(9) || char(10) || char(13)) = '';
```

<!-- adr-0087: not-required (no-migration-prescription) Nothing authored moves: `packages/spec` is untouched and no metadata key is added, removed or reshaped, so `objectstack migrate meta` has nothing to rewrite and the ledger has no row to gain. What is refused is a caller-written VALUE — a non-numeric string on a `progress` field — at the write door; stored rows are never re-read by the check, and a caller that sends a number or a blank is unaffected. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a write-door value check (not `registered` / `already-registered`); and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
