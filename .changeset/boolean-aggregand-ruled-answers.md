---
'@objectstack/driver-sql': patch
---

Boolean aggregands now answer the ruled #11249 contract on every SQL dialect. On Postgres, `sum`/`avg`/`min`/`max` over a declared `boolean` field are lowered with a cast (`avg(cast("flag" as int))`) instead of reaching the server as `avg("flag")` — which PostgreSQL refuses with SQLSTATE `42883`, so those aggregations previously failed with `DATABASE_ERROR`/500. On every dialect, `min`/`max` results over a declared boolean are now presented as JSON booleans (`false`/`true`) at the driver boundary — previously MySQL (`tinyint(1)` storage) answered `0`/`1`. `sum`/`avg` answer arithmetic (`3` / `0.5` over a 3-true/3-false column); `count`/`count_distinct` are unchanged, and `min`/`max` over an empty window still answer `null`.
