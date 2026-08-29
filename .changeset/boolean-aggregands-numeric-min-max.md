---
'@objectstack/spec': patch
'@objectstack/driver-sql': patch
'@objectstack/driver-memory': patch
'@objectstack/driver-mongodb': patch
'@objectstack/objectql': patch
---

`min`/`max` over a **boolean** aggregand now answer the numbers `0`/`1` on every face — maintainer ruling 2026-08-28 (#11152, option A), superseding #11249's `false`/`true`: booleans aggregate as numbers, with no per-aggregate exception, so one flag column's `sum`/`avg`/`min`/`max` all answer in one numeric domain.

FROM → TO, per face: `driver-sql` (every dialect, `driver-sqlite-wasm` included via the shared compiler) no longer re-presents `min`/`max` results over a declared boolean as JSON booleans — `false`/`true` → `0`/`1`; row reads (`find()`) still present booleans, and `min`/`max` over an empty window still answer `null`. `driver-memory` (data and analytics faces) and objectql's in-memory fallback compare booleans as the numbers they are worth — `false`/`true` → `0`/`1`; strings, dates and numbers reach the same comparison they always did. `driver-mongodb` wraps `$min`/`$max` in the same boolean-only `$cond` coercion `$sum`/`$avg` use — `false`/`true` → `0`/`1`; null/missing still pass through, so the empty window still answers `null`. A caller reading `min`/`max` over a boolean column as a JSON boolean should read the number (`0` is false-y, `1` truthy, so boolean coercion at the call site keeps working).

The cross-driver aggregation conformance fixture (`AGGREGATION_ROWS`, `@objectstack/spec/data`) now carries the boolean column those rulings are pinned by: `flag` (3 true / 3 false), with cases for `sum`=3, `avg`=0.5, `min`=0, `max`=1, `count`=6, `count_distinct`=2 and a grouped `min` over the deliberately asymmetric groups — the reach gap #11065 and #11151 were both found through (a boolean aggregand no conformance cell could see) is closed.
