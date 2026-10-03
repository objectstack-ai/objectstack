---
'@objectstack/spec': patch
---

The shared conformance tables' case notes and names no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

The conformance tables in `@objectstack/spec` (`FILTER_LOGIC_CASES`, `FILTER_TEXT_CASES`, `FILTER_COMPARAND_TYPE_CASES`, `AGGREGATION_CASES`, `TEMPORAL_ROWS` / `TEMPORAL_CASES` / `TEMPORAL_TIME_CASES`, `VALUE_ROUNDTRIP_CASES`, `TEXT_OPERATOR_DOOR_TYPE_CLASSES` and `METADATA_ROUNDTRIP_CASES`) are what every driver, and any third-party implementation, is measured against. A case's `note` or `why` is printed when that case fails, and some drivers print it in the test title. Fifty-eight of those texts pointed at an issue-tracker number for the reason a case exists. The number goes; where the sentence did not already say what was decided, it now does. For example:

- The four empty-combinator cases say every face reduces an empty combinator to its boolean identity, and why `{}` and `$not: {}` follow from it.
- The no-value cases say `$ne`, `$nin`, `$notContains` and `$not` are NULL-safe on every face, and that `$exists` means "has a value" because SQL cannot tell a missing key from a stored null.
- The boolean-aggregand cases say a boolean is worth 1 or 0 on every face, including for `min` / `max`, and that this ruling superseded an earlier `false` / `true` answer.
- The `$empty` cases say every face answers `$empty` by the field's declared type.

Six case names change with them: `icontains (the infix/view spelling, ruled never an alias of ilike) lowers to $icontains — …` in `FILTER_TEXT_CASES`, and five names in `FILTER_COMPARAND_TYPE_CASES` (the control cell, the bigint crash cell, and the three array-in-the-equality-slot refusals, which now say they are refused at the shared face).

Text only: no case's filter, input, expected rows, verdict, error code, order or count changes, and no export, type or schema moves. A tool or test that selects or pins a case by its old note or name (for example by a tracker-number substring) needs the new spelling.
