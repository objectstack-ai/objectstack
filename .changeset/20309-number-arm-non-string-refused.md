---
"@objectstack/objectql": minor
---

fix(objectql)!: a number, currency, percent, rating, slider or progress field refuses an array, a boolean or an object with `invalid_number` (#20309)

Clause-②: no (narrowing)

**BREAKING**: shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner and the ADR-0087 disposition below, never by the level). The
narrowing: an array, a boolean or an object whose `Number()` is finite, such as
`[500]`, `[]`, `true` or `false`, written to one of those fields is now refused
with `400 VALIDATION_FAILED` / `invalid_number`. It used to be accepted and
stored as sent.

## What was wrong

The record validator judged `Number(value)` on a number-typed field, but the
write carried `value` itself. Every value that JavaScript coerces to a finite
number therefore passed the check and reached the driver unchanged:

- **SQLite** stored `[500]` as the TEXT `'[500]'`, which a read returned as the
  string `"[500]"`; `[]` as the TEXT `'[]'`; and `true` / `false` as `1` / `0`.
- **memory** stored the array or the boolean itself.

`[5, 7]` and `{}` were already refused, because `Number()` of each is `NaN`.

## What changes

- On `number`, `currency`, `percent`, `rating`, `slider` and `progress`, a value
  that is neither a number nor a string is refused with `invalid_number`: an
  array, a boolean, a plain object, a `Date`. This holds on every engine, REST,
  batch and import write door, because they all write through the same
  validator.
- A number is judged and stored exactly as before, and so are the `min`, `max`
  and `scale` checks and their messages.
- A string is also unchanged. It is still judged by `Number()` and stored as
  sent. Which strings a number field accepts is a separate change.
- `summary` is still not judged by this check (it is in the spec's
  `COMPUTED_VALUE_TYPES`). A blank still becomes `null` before the check runs.

## Rows already stored

This refuses new writes only; a stored value is never re-read by the check.
Rows written earlier on SQLite may hold such a value as TEXT in a numeric
column. To find them, run this once per number-typed column:

```sql
SELECT id, "FIELD" FROM "OBJECT" WHERE typeof("FIELD") = 'text';
```

OBJECT is the object name and FIELD is the field name. A match is a cell that
SQLite could not store as a number: an array written as TEXT, or a string such
as `'0x10'`. Decide its number by hand; nothing here rewrites it.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authored moves: `packages/spec` is untouched and no metadata key is added, removed or reshaped, so `objectstack migrate meta` has nothing to rewrite and the ledger has no row to gain. What is refused is a caller-written VALUE (an array, a boolean or an object on a number-typed field) at the write door; stored rows are never re-read by the check, and a caller that sends a number, a string or a blank is unaffected. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a write-door value check (not `registered` / `already-registered`); and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
