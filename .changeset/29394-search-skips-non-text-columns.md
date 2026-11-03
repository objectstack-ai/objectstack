---
'@objectstack/objectql': patch
---

fix(objectql): `$search` no longer aims a text match at a column that can never hold text (number, boolean, date and time, json)

Clause-②: no
Metadata-protocol: none

A `$search` is expanded by the engine into one case-insensitive text match per field of the object's search set. When that set held a `number`, `currency`, `boolean`, `date`, `datetime`, `time` or `json` field (an object's `searchableFields` naming one), the engine still emitted a text match for it, and the field-type check that refuses the same match when a caller writes it never saw it. What happened next depended on the driver. One `json` field in the set made every search on the object fail with `400 INVALID_FILTER`, on PostgreSQL, SQLite and the in-memory driver alike. A numeric, boolean or temporal field matched nothing on the SQL drivers, while the in-memory driver matched a date by its text (a search for `2026` found a record dated `2026-01-05`).

Now such a field adds no match to the search. The set is read from the same field-type verdict the filter check uses (`textOperatorDoorVerdict`), not from a new list. Text, option, reference and file fields are searched as before. A search set made only of such fields answers no rows (200, not an error and not every row), and a `$searchFields` naming one is still accepted and matches nothing through it. The search set itself, and every refusal judged on it, is unchanged. To find records by a number or a date, filter with `$eq` or a range (`$gte` / `$lt`) on that field.
