---
"@objectstack/objectql": patch
---

fix(objectql): a cleared number, boolean, date, datetime or time field stores `null`, on every backend (#20308)

`patch` — a bug fix in a released package. No exported symbol, no spec key and
no API signature changes.

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

Separately, `progress` and `summary` had no type check at all: a non-numeric
string such as `'abc'` was stored verbatim on memory and SQLite.

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
  field's `defaultValue` exactly as `null` does.
- **String-stored columns are untouched.** A text, lookup or select `''` is still
  stored as `''`.
- **`progress` and `summary` join the numeric type check.** A non-numeric
  string on either is refused with `invalid_number`, as on `number`. No `min`,
  `max` or `scale` is newly enforced on them.
- **One consequence for roll-ups.** A `summary` whose `summaryOperations` takes
  `min` or `max` over a `date`, `datetime` or `time` field writes a date string
  into the numeric summary. PostgreSQL already refused that recompute
  (`ERR_SUMMARY_RECOMPUTE`). Memory and SQLite now refuse it the same way,
  instead of storing the string.

## Rows already stored

This fixes new writes only. Rows written earlier on SQLite (and on memory,
MongoDB or libSQL) may still hold `''` in such a column; on SQLite a boolean
holding `''` reads back as `false`, and one holding whitespace as `true`.
PostgreSQL never stored one. To repair a
SQLite table, run this once per non-string-typed column (a field of one of the
types listed above):

```sql
UPDATE "<object>" SET "<field>" = NULL
 WHERE typeof("<field>") = 'text' AND trim("<field>", ' ' || char(9) || char(10) || char(13)) = '';
```
