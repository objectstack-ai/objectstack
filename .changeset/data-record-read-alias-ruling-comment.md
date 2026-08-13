---
"@objectstack/rest": patch
---

docs(rest): record the #8039 ruling on `GET /data/:object/:id`'s query-parameter set —
`fields` / `populate` are refused BY DESIGN, not an open question (#8039)

Documentation only — `refuseUnknownQueryParams` already rejects any input the same way
it did before this change.

The route accepts exactly `select` / `expand`. It never folds the spec's alias table
(`RPC_QUERY_ALIAS_SLOTS`, which maps `fields` → alias `select` and `expand` → alias
`populate`), so the canonical `fields` spelling and the `populate` alias are outside the
accepted set and refused with a located `400 VALIDATION_ERROR` naming `select` / `expand`
as what the route accepts — never silently dropped.

That gap used to be recorded as an open question ("tracked as #8039 … rather than widened
here"). It is now settled: maintainer ruling, 2026-08-12, took **option 2** — keep the
narrow set, refuse the alias-table spellings loudly. **Option 1 (folding
`RPC_QUERY_ALIAS_SLOTS` onto this one route, so `fields` / `populate` start working here
too) was explicitly rejected** — it would be surface expansion on a public route with no
measured pull behind it, and doing it for this route alone would leave every other data
route's ingress inconsistent in the opposite direction. If the alias table is ever
declared universal across data routes, that lands as one card applying the fold to ALL
data routes at once, with its own ruling — never a quiet per-route widening.

For anyone integrating against this route: `?fields=…` and `?populate=…` are not aliases
here and will not become one without a separate, wider decision. Use `select` / `expand`.
