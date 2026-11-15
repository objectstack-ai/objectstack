---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing): a write whose `where.id` is an operator object is scoped as the predicate it is, not judged as the row "[object Object]"

Clause-②: yes (widening): a request refused today lands when every matched row is admitted; measured again by the dev before the PR
Metadata-protocol: none

The sharing write gate turned any `where.id` into the one row it judged by id, so `{ $in: [...] }` was judged as the row "[object Object]", which no caller owns. A member's multi-row delete or update of rows it owns, on a `private` or `public_read` object with an `owner_id`, answered 403 FORBIDDEN and wrote nothing.

Only a scalar id (string, number, bigint) now names the row the by-id gate judges, the rule the engine already uses to pick its by-id route. Any other value in an id slot (`$in`, `$nin`, `$eq`, an array) is a predicate, and gets the answer every bulk write gets: the writable-rows filter is ANDed into it, so the write touches only the rows the caller may update or delete, and the rest are left as they were, with no error. A by-id write with a scalar id is judged exactly as before.
