---
'@objectstack/spec': minor
'@objectstack/objectql': patch
---

feat(objectql, spec): a number or boolean comparand on a text- or option-family field compares as its string, the form the write door stores (#29486)

Clause-②: yes (widening) — a filter that compares a text-family field (`text`, `textarea`, `email`, `url`, `phone`, `password`, `markdown`, `html`, `richtext`, `code`, `signature`, `qrcode`) or an option-family field (`select`, `radio`, `multiselect`, `checkboxes`, `tags`) with a number or a boolean now matches the rows the write door stored for that value; before, it matched none on every driver, with no error.
Metadata-protocol: semantic
Skills-docs: `content/docs/deployment/cli.mdx` (`os migrate text-scalars`, `os migrate option-codes`) now says a filter on the number reads as the string. No `skills/**` page teaches how a filter reads a comparand on a text or option field.

Maintainer ruling A on #29486: a number or boolean comparand on a text- or option-family field compares as `String(value)`, the form the write side stores since #29241 (text) and #29562 (options).

**What answers differently.**

- `{ code: 42 }`, `{ code: { $in: [42, true] } }` and `{ stage: 3 }` against a `text` / `select` field written `42` / `3`: FROM no row (InMemoryDriver and SQLite measured) TO the rows written `42` or `"42"` (`3` or `"3"`). `$ne` / `$nin` FROM every row TO every row but those. `true` / `false` read as `"true"` / `"false"`, and a `bigint` within ±2^53 as the number it names.
- A range is now a STRING range. `$gt` / `$gte` / `$lt` / `$lte` bounds and `$between` members are narrowed like any comparand, so a range on a text or option field compares strings in the column's order: `{ code: { $gt: 9 } }` does not match `"10"` (`"10"` < `"9"` as strings), and `{ code: { $between: [1, 10] } }` does not match `"5"` (`"5"` > `"10"`). Before, InMemoryDriver and MongoDB matched no row for a number bound (they do not order a number against a string), and SQLite compared by the column's affinity: measured, `{ $gt: 9 }` matched `"alpha"` and `{ $gt: 4, $lt: 5 }` matched `"5"` and `"42"`, where it now matches `"42"` alone. To range over numbers, declare the field as a number.
- Every engine verb that collects a filter (`find`, `findOne`, `count`, `aggregate`, `update`, `delete`), both spellings of `where` (the object form and the `FilterArray` sugar), the per-aggregation `filter` and `having`, and every REST door that reaches them. The comparand is narrowed at the engine's field-aware filter seam, beside the number and boolean doors, so every driver receives the string.
- Unchanged: a string comparand, `null` (the null test, never `"null"`), a `Date`, the text operators (`$contains: 42` is still refused), and every other field type. A scalar comparison on a multi-value option field is still refused by the drivers ("use `$contains`"); only the comparand they are handed changes.
- Rows written before #29241 / #29562 and not yet migrated: a raw `42` on driver-memory with persistence matched `{ code: 42 }` and no longer does, as `{ code: "42" }` never did. Run `os migrate text-scalars --apply` and `os migrate option-codes --apply` (tracked in #29643).

**In-process APIs.** `@objectstack/spec/data` exports `stringStoredComparandDoorVerdict`, `stringStoredComparandFieldVerdict`, `STRING_STORED_COMPARAND_DOOR_FAMILIES`, `STRING_STORED_COMPARAND_DOOR_SCALAR_OPERATORS`, `STRING_STORED_COMPARAND_DOOR_LIST_OPERATORS`, the type `StringStoredComparandDoorFieldMeta` / `StringStoredComparandDoorVerdict`, and the cross-driver conformance table `FILTER_STRING_STORED_COMPARAND_CASES` with its fixture (`FILTER_STRING_STORED_COMPARAND_FIELDS`, `FILTER_STRING_STORED_COMPARAND_ROWS`, `StringStoredComparandRow`, `StringStoredComparandCase`). All additive.
