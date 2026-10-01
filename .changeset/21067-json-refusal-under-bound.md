---
"@objectstack/core": patch
"@objectstack/driver-sql": patch
"@objectstack/driver-memory": patch
"@objectstack/objectql": patch
---

fix(core): the refusal a filter gets for a scalar comparison or text operator on a multi-value or JSON field reads true on every backend that prints it, and reaches a REST caller whole

Clause-②: no

The `INVALID_FILTER` / 400 refusal `driver-sql`'s `where`, the engine's per-aggregation `filter` and `driver-memory` all print (`jsonColumnOperatorRefusalText`) explained itself with `driver-sql`'s storage ("a field this driver stores as a JSON TEXT column") and the two wrong answers SQL used to give. That is untrue on the engine and on `driver-memory`. The message was also 748 characters, and the REST envelope cuts a 4xx message at 499 plus an ellipsis, so callers on SQLite and PostgreSQL read `…Refused rather than compiled because the answ…` and never reached the sentence saying the field and the operator were withheld.

The message now reads, on every backend, in 486 characters: `A constraint in this filter WAS NOT APPLIED: it aims a scalar comparison or text operator at a multi-value or JSON field, which it cannot test for one member.`, then the same `$contains` / `$or` of `$contains` remedy, then `For no value, use "$null" or "$empty".` (a `null` comparand such as `{ f: null }`, `$eq: null` or `$ne: null` is refused too, and `$contains` could not express it), then `The field and the operator are withheld from the message; the full diagnostic is in the server log.` The diagnostic (the server-log text, and what a filter's own author is shown) gives the same reason with the operator named, names the field, and spells the remedy with the field's name. It drops the storage and the SQL history too, and is now whole on the wire for field names up to 26 characters (it was 643 characters or more and always cut).

Code, status, the refused operator set and the `$contains` remedy are unchanged. A client that matched on the old words `JSON TEXT column` or `Refused rather than compiled` should match on `code: "INVALID_FILTER"` instead.
