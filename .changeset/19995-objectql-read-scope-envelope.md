---
'@objectstack/service-analytics': patch
---

fix(service-analytics): the ObjectQL execute face refuses a read scope it cannot run in the withheld `READ_SCOPE_COMPILE_FAILED` / 500 envelope, not the engine's `INVALID_FILTER` / 400 (#19995)

Clause-②: no

A row-level read scope carrying a comparand the engine's shared comparand faces refuse — a list in the equality slot, a scalar under `$in` / `$nin`, a one-bound `$between`, a null list member, a plain-object or `undefined` comparand — used to reach `engine.aggregate` composed with the caller's own filter, and came back as the engine's `INVALID_FILTER` / 400. A 4xx's message is relayed to the caller, and this one named the policy's fields and comparands. The NativeSQL execute face and the `/analytics/sql` echo already refused the same scope as a server fault with the message withheld (the #5367 ruling), so one scope got two envelopes depending on which analytics face served it.

The ObjectQL strategy now judges the scope on its own at both engine-bound merge sites (the base aggregate, direct and cross-object, and the referenced object's scope in the cross-object label lookup), with the same two shared functions the engine runs, before composing it. A refusal there is `READ_SCOPE_COMPILE_FAILED` / 500: `POST /analytics/query` and `POST /analytics/dataset/query` withhold its message, and the full text goes to the operator's log.

Unchanged: which scopes are served. The judgement uses the engine's own functions, so a scope the engine serves is still served, including a `{ $field }` cross-field scope and an emptied `$in` beside an own-rows grant. The caller's own `where` still answers `INVALID_FILTER` / 400 with its message, whether the analytics door or the engine refuses it.
