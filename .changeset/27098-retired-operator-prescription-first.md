---
'@objectstack/spec': patch
---

fix(spec): a retired filter operator's refusal names every replacement before the 500-character client cap

Clause-②: no
Metadata-protocol: none

`POST /api/v1/data/OBJECT/query` with `{ "title": { "$regex": "acme" } }` answers `400 INVALID_FILTER`, and a client reads at most 500 characters of the message. The five refusal sites print `RETIRED_FILTER_OPERATORS[op].why` after their own lead-in, and `$regex`'s prescription opened with the history of the retirement, so `$contains` (the case-sensitive alternative) and "match in application code" (for a pattern that really needs a regex) were cut off. Both prescriptions now lead with what to write and put the history after it: `$regex` names `$icontains`, `$contains` and the application-code route first, and `$options` now says to delete it and write `$icontains`. The table, the operators it names, the cap and the error envelope are unchanged; only the order and wording of the two `why` strings change.
