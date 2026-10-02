---
"@objectstack/spec": minor
---

feat(spec): the boolean-comparand declared-type contract in `@objectstack/spec/data` — the comparands a declared boolean field accepts in a filter, the boolean each narrows to, and the refusal words

Clause-②: yes

**What it declares.** `filter-boolean-comparand-declared-type.ts`, the boolean twin of `filter-number-comparand-declared-type.ts`:

- `BOOLEAN_COMPARAND_SPELLINGS`: the accepted non-boolean spellings, `1` / `0`, `"1"` / `"0"` and `"true"` / `"false"`, each with the boolean it narrows to. This is the set the record validator admits when a boolean field is written. `readBooleanComparand` reads a comparand by it, and names why a string is not one (`NON_BOOLEAN_STRING_FORMS`: `empty`, `padded`, `letter-case`, `placeholder`, `not-a-boolean`).
- `BOOLEAN_COMPARAND_DOOR_JUDGED_TYPES` (`BOOLEAN_VALUE_TYPES` itself), and the judged positions, which are the number door's lists by identity.
- `booleanComparandFieldVerdict` and `booleanComparandDoorVerdict`, the pure verdict: `narrows`, `door-refusal` (`INVALID_FILTER` / 400), `passes` or `deferred`.
- `booleanComparandRefusalMessage`: the refusal words, inside the 500-character client bound.
- `BOOLEAN_COMPARAND_READING_CASES`, `BOOLEAN_COMPARAND_DOOR_FIXTURE` and the derived `BOOLEAN_COMPARAND_DOOR_CASES`, for a door's suite to drive.

**What the verdict answers `door-refusal` for.** A string other than the four accepted ones, compared with a declared boolean field, at the value positions of a filter (the implicit comparand, `$eq` / `$ne` / `$gt` / `$gte` / `$lt` / `$lte`, and each member of `$in` / `$nin` / `$between`).

**What moves for consumers.** Nothing in this package refuses or narrows a filter, and every existing export is unchanged. The door that applies the verdict ships in the same release in `@objectstack/objectql`, whose changeset states what changes for a caller.
