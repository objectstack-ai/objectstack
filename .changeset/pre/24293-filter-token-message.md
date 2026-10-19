---
"@objectstack/lint": patch
---

fix(lint): `filter-token-unknown` states what the runtime does with an unresolvable filter placeholder: the data engine refuses the query with `FILTER_TOKEN_UNKNOWN` / 400

Clause-②: no

The finding's message said the value "is sent to the data engine as a literal string, matches no record, and the surface renders empty". The runtime does not do that. The data engine refuses a query that carries an unresolvable placeholder, `FILTER_TOKEN_UNKNOWN` with HTTP 400, rather than compare it as a literal string. The message now reads:

```text
Filter value "{current_user}" is not a resolvable placeholder. The data engine refuses a query that carries it (`FILTER_TOKEN_UNKNOWN`, 400), so the surface never shows the data the filter meant.
```

Unchanged: the rule id, its severity (`error`), the finding's `path`, its `hint` (the `fix:` line), and which values the rule reports. The message's first sentence is unchanged as well. `os explain filter-token-unknown` already stated the refusal and is unchanged.
