---
'@objectstack/service-analytics': minor
---

Resolve `{current_user_id}` (and every other filter placeholder) on the direct analytics query path, at parity with the list path and the dashboard dataset path.

What changes for an app author: a widget or report whose filter says `owner: '{current_user_id}'` used to render `0` for every viewer whenever the query reached the SQL strategy — the literal text was bound into the `WHERE` and matched no row, silently. Now the same filter expression means the same thing on every surface: `AnalyticsService.query` and `generateSql` expand `where`, `timeDimensions[].dateRange`, and a registered dataset's own filter / measure filters against the requesting user before any strategy compiles, so each viewer gets their own rows. A placeholder that cannot be resolved — an unknown spelling, or `{current_user_id}` on an unauthenticated request — now refuses loudly with `FILTER_TOKEN_UNKNOWN` / `FILTER_TOKEN_UNRESOLVED` (HTTP 400) instead of charting a plausible zero.

This also closes a gap on the dashboard dataset door: the dataset-scope channel used to hand strategies the registry's unresolved filter copy, which was ANDed in beside the resolved one (`owner = $viewer AND owner = '{current_user_id}'`) and selected nothing.
