---
'@objectstack/service-analytics': patch
---

fix(service-analytics): the ObjectQL execute face refuses a read scope carrying a filter placeholder the engine cannot resolve in the withheld `READ_SCOPE_COMPILE_FAILED` / 500 envelope, not the engine's `FILTER_TOKEN_UNKNOWN` / `FILTER_TOKEN_UNRESOLVED` / 400 (#19995)

Clause-②: no

A row-level read scope carrying an unknown filter placeholder, or a known one the request has no value for, used to reach `engine.aggregate` composed with the caller's own filter. The engine's placeholder resolver then refused it with a 400. A 4xx's message is relayed to the caller, and this one named the policy's placeholder.

The ObjectQL strategy now runs the engine's own placeholder resolver on the scope by itself, with the token context the engine builds, at both engine-bound merge sites: the base aggregate (direct and cross-object) and the referenced object's scope in the cross-object label lookup. It does this before composing the scope. A refusal there is `READ_SCOPE_COMPILE_FAILED` / 500. `POST /analytics/query` and `POST /analytics/dataset/query` withhold its message, and the full text goes to the operator's log.

Unchanged: which scopes are served. A placeholder the engine resolves, such as `{current_user_id}` for a signed-in caller, is resolved the same way here, and the scope is served. The caller's own `where` keeps its `FILTER_TOKEN_UNKNOWN` / 400 with its message.
