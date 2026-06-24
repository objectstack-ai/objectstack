---
"@objectstack/service-analytics": patch
---

fix(analytics): compare boolean filters/group-by against the real boolean, not stringified '1'

The analytics filter normalizer stringified boolean `true` → `'1'`, which the
ObjectQL strategy then coerced back to the number `1` before calling
`engine.aggregate`. Boolean fields hold a real `true`/`false`, so `1 !== true`
never matched: a metric widget filtered on a boolean field (e.g.
`{ is_critical: true }`) always returned 0, and pie/donut/bar charts grouped by
a boolean dimension failed to bucket. `stringifyForCube` now serializes booleans
as the tokens `'true'`/`'false'`, and a new `coerceFilterValueForObjectQL`
recovers a real boolean for the ObjectQL engine while the SQL path keeps binding
`1`/`0` (better-sqlite3 cannot bind a JS boolean).
