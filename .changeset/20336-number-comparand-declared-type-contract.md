---
'@objectstack/spec': minor
---

`@objectstack/spec/data` declares the platform's numeric grammar for a string, and the contract of the number-comparand declared-type door: which string comparands a field whose declared type is numeric may be compared against (#20336).

Clause-②: yes

**The grammar.** A string is numeric when its whole content is a JSON number literal (`-?(0|[1-9][0-9]*)(.[0-9]+)?([eE][+-]?[0-9]+)?`) that names a finite number; it then means what the same characters mean as a JSON number. `NUMERIC_STRING_PATTERN`, `parseNumericString(s)` (the number, or `undefined`) and `readNumericString(s)` (the number, or which of eight named forms the string is: `empty`, `padded`, `placeholder`, `radix-prefix`, `non-finite`, `digit-separator`, `non-json-spelling`, `not-a-number`). `NUMERIC_STRING_GRAMMAR_CASES` records every form with the reason it is admitted or refused: `"12"`, `"-3"`, `"12.5"`, `"1e3"` and every string `String(n)` produces for a finite number are admitted; `""`, `" 12 "`, `"0x10"`, `"Infinity"`, `"NaN"`, `"1,000"`, `"+5"`, `".5"`, `"007"` and any `{placeholder}` are not.

**The door's contract.** `numberComparandDoorVerdict(field, comparand)` answers, for a comparand at a value position (implicit equality, `$eq` / `$ne` / `$gt` / `$gte` / `$lt` / `$lte`, and each member of `$in` / `$nin` / `$between`) of a filter on a field whose declared type is in `NUMERIC_VALUE_TYPES` (or a `formula` whose `returnType` is `number`): `door-refusal` (`INVALID_FILTER` / 400) for a non-numeric string, `narrows` with the number for a numeric one, `passes` for any other comparand or field, `deferred` for a `formula` without a readable `returnType`. `numberComparandRefusalMessage(site, context?)` is the refusal the door prints: the field, its declared type, the comparand, its position and what is wrong with it. A fixture object and a derived case table (`NUMBER_COMPARAND_DOOR_FIXTURE`, `NUMBER_COMPARAND_DOOR_CASES`) are published for the engine suite that pins the door.

**What moves for consumers.** Nothing yet. This is the contract only, and no door reads it in this release: a non-numeric string compared with a number field still reaches the driver as written (a 500 on PostgreSQL, an empty or different result elsewhere). The engine door that refuses it with `INVALID_FILTER` / 400 and narrows a numeric string lands with #20351, and the record validator's number arm adopts the same grammar for writes with #20309.
