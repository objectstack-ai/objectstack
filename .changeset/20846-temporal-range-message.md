---
'@objectstack/core': minor
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/rest': patch
---

fix(objectql,rest): a `date` or `datetime` value refused for its year says so — "must be a date in the years 0001 to 9999" / "must be a datetime whose UTC year falls in the years 1000 to 9999" — instead of "must be a valid date (ISO-8601)", which was false for a value such as `0500-07-15T10:00:00Z` (#20846)

Clause-②: yes (widening) — one new export on `@objectstack/core`'s root, `SUPPORTED_TEMPORAL_YEARS`. No value's verdict moves and no wire key moves: the field code stays `invalid_date` and its `constraint` stays `{ type }`.

`POST` / `PATCH /api/v1/data/:object` and each row of `POST /api/v1/data/:object/import`
refuse a `date` outside the years 0001 to 9999 and a `datetime` whose UTC year falls
outside 1000 to 9999. When the value itself is readable — an ISO 8601 string such as
`0500-07-15T10:00:00Z` or `+010000-01-01`, or a `Date` — the refusal's message now
names the kind's years. An author who read "not valid ISO" rewrote the spelling, and no
spelling of that year is admitted.

- `@objectstack/spec`: the validation message catalog gains `invalid_date_range` and
  `invalid_datetime_range` in `en`, `zh-CN`, `ja-JP` and `es-ES`. They are two more
  sentences of the `invalid_date` code, never a wire value. The years are the template
  parameters `{{firstYear}}` / `{{lastYear}}`. A deployment that overrides a message
  under `validation.field.invalid_date` or `validation.field.invalid_datetime` does not
  cover these values. To override their text, define
  `validation.field.invalid_date_range` / `validation.field.invalid_datetime_range`.
- `@objectstack/core`: `SUPPORTED_TEMPORAL_YEARS` (`{ date: { first: 1, last: 9999 },
  datetime: { first: 1000, last: 9999 } }`, frozen) is the range
  `isOutsideTemporalYearRange` judges by. It is exported so a refusal names the range
  from the source the doors use, never a copy of its numbers.
- `@objectstack/objectql` and `@objectstack/rest`: the record validator and the import's
  cell reader choose the range sentence for such a value. An import cell with more than
  four year digits (`+010000-01-01`) is refused by the import's reader. It used to read
  "is not a valid date" and now gets the same range sentence as the write door.

**What is not affected.** Which values are refused is unchanged, and so is the refusal's
code (`invalid_date`) and `constraint`. A value that is not readable keeps its sentence:
"must be a valid date (ISO-8601)" at the write door, `"…" is not a valid date` at the import.
So does a number, which is never a written `date` or `datetime`.
