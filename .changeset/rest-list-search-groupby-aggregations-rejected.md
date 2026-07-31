---
"@objectstack/metadata-protocol": patch
"@objectstack/objectql": patch
"@objectstack/spec": patch
"@objectstack/rest": patch
---

fix(data): `searchFields` / `groupBy` / `aggregations` naming a field that does not exist are rejected, not silently degraded (#4254)

#4226 closed `sort` / `select` / `expand`; with the filter axis (#4134 / #4164 /
#4181 / #4121) that made four field-naming read axes that either apply or fail.
The same machine kept leaking on the remaining three, and each failure corrupted
something the closed axes never touched:

```
search=alpha&searchFields=no_such  -> 200  MORE rows than the narrowing allowed
groupBy=[no_such]                  -> 200  [{no_such: null, n: <true count>}]  N groups collapsed into 1
sum(no_such)                       -> 200  0 — indistinguishable from a real zero
```

Each is now refused at the shared normalizer, so `GET /data/:object`,
`POST /data/:object/query`, the export route and the runtime dispatcher give
one answer instead of four.

- **`searchFields` → `400 INVALID_FIELD`.** The `select` failure with the sign
  flipped outward: the engine dropped unknown names and, when that emptied the
  override, fell back to the FULL searchable set — so a parameter that exists
  only to narrow a search widened it, and it changed which ROWS came back, not
  just which columns. Its only in-framework caller is `GET /data/:object/export`
  — the route whose `search` support just shipped so exports would stop
  downloading "the unsearched superset … in a file that looks authoritative";
  a typo'd `searchFields` did exactly that, one parameter over. Three causes,
  three messages, because the fixes differ (the split #4226 drew on expand): a
  name that is no field is a request typo; a REAL field outside the searchable
  set needs the object changed (its message names the declared
  `searchableFields` or the auto-default's type rule, whichever applies); and
  a `searchableFields` entry that names no field is a STALE DECLARATION — a
  bug on the object, called out as such because clients (objectui's list
  search) echo the declaration verbatim. The allowed set is resolved by the
  same `@objectstack/spec/data` function the engine's search expansion
  consumes (`resolveSearchFieldResolution`, moved from objectql), so the gate
  cannot drift from what search actually scans.
- **`groupBy` → `400 INVALID_FIELD`.** The in-memory aggregation path projects
  an unknown column as `null` for every row, so all rows landed in ONE bucket
  whose count is the true row count — structurally perfect, identical to "this
  column really holds a single value". A chart draws one bar; nothing says the
  grouping never ran. Native SQL aggregation errors on the same input, so which
  backend a deployment sits on decided the answer — the "two routes, opposite
  answers" split, one axis over.
- **`aggregations` → `400 INVALID_FIELD`.** `sum(<typo>)` folded a column of
  `undefined` to `0` — the exact number an empty quarter produces, in reports
  whose whole job is to be believed (`avg`/`min`/`max` answered `null` the same
  way). `count` with no `field` (or the `'*'` sentinel) is the one legitimate
  field-less form and passes.
- **Unreadable SHAPES on the aggregation axes → `400 INVALID_QUERY`** — the
  standard-catalog code that had no emitter since it was written, like
  `INVALID_SORT` before #4226. A string `groupBy`, an entry naming no field, a
  function or `dateGranularity` outside the spec enums, a missing `alias`: each
  slipped past the `Array.isArray` routing guard (rows returned UNGROUPED) or
  computed a silent placeholder (`null` results, a column keyed `"undefined"`,
  one bucket per raw value under an unknown granularity).

Tiering is unchanged from #4226: registry + field map present → authoritative;
no registry / no field map / legacy array field map → the NAME gates skip (shape
gates still apply — they need no schema). The engine's own tolerance is
untouched: internal callers reaching `engine.find()` / `engine.aggregate()`
directly are unaffected. `@objectstack/rest` also stops logging
`INVALID_FILTER` / `INVALID_SORT` / `INVALID_QUERY` rejections as
"[REST] Unhandled error" — they are client mistakes the response already
explains, as `INVALID_FIELD` always was.

Requests that name real fields are unaffected.
