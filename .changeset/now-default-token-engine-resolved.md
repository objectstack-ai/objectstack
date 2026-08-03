---
"@objectstack/objectql": patch
---

fix(objectql): resolve the `NOW()` defaultValue token in the engine, so it works on every datasource (#4597)

`Field.datetime({ defaultValue: 'NOW()' })` only ever worked on SQL. The engine's
`applyFieldDefaults` special-cased exactly two `defaultValue` shapes — the
Expression envelope and the `current_user` token — and passed everything else
through verbatim, so the four characters `NOW()` were written into the record as
a **literal string**. The SQL driver hid that: `SqlDriver.formatInput` carries an
insert-time safety net that swaps any `NOW()` string for a real ISO timestamp
before it hits the wire. Memory and MongoDB have no such net.

This is the mirror image of #4560. There, `current_user` was known to the engine
and not to the DDL, so the DDL stored the token text. Here, `NOW()` was known to
the SQL driver and not to the engine — same crack, opposite side. It surfaced two
ways:

- On a **validated** field the insert was **rejected outright**, by the engine's
  own write validator, against a value the engine itself had just filled in:
  `ValidationError: … must be a valid datetime (ISO-8601)`. Every insert omitting
  such a field failed, with an error naming a field the caller never sent.
- On a `readonly` / `system` field — which `validateRecord` skips, i.e. the ~100
  `created_at` / `updated_at` declarations across the platform objects — nothing
  was rejected at all and the string `NOW()` was **stored**.

`applyFieldDefaults` now resolves the token itself, from the same per-insert
`now` snapshot it already passes to Expression defaults, so every field defaulted
in one insert (and every row of one batch) carries the identical instant. The
spelling it matches is the spec's (`isNowDefaultToken` from
`@objectstack/spec/data`, case-insensitive and whitespace tolerant), the same
predicate a driver's DDL consults — the engine does not re-derive its own.

The token resolves into the shape the field's **declared type** stores, which is
what `SqlDriver.nowColumnDefault` already emits per type (ADR-0053), so no
datasource disagrees about the stored form:

| field type | stored value |
|---|---|
| `date` | `YYYY-MM-DD` (UTC calendar day) |
| `time` | `HH:MM:SS[.fff]` (UTC wall clock; a zero `.000` is trimmed) |
| `datetime`, and any non-temporal field that opts in | `YYYY-MM-DDTHH:MM:SS.sssZ` |

No authoring change: `defaultValue: 'NOW()'` is the same declaration it always
was, and a caller-supplied value is still never overwritten. What changes is that
it now means the same thing on memory and MongoDB as it always did on SQL.
Records written on a non-SQL datasource before this fix may hold the literal
string `NOW()` in those columns; they are not rewritten.

Both driver-side mechanisms stay, unchanged, as defence in depth: `formatInput`'s
safety net (now unreachable from the engine's insert path) and the native column
DEFAULT, which still serves writes that bypass the engine entirely — the same
division of labour `current_user` has.
