---
'@objectstack/spec': patch
---

Fix `snap.grid` on the Studio flow-builder config pointing authors at the wrong key, and gate the cause repo-wide.

`strictUnknownKeyError` indexes an alias table by `aliasProbe(key)` — lowercased, with `_`, `-` and spaces stripped. Two keys in one table that normalise identically therefore share one index, and the later entry silently overwrites the earlier one. Nothing checked for that.

`these snap settings` listed `grid: 'gridSize'` and, at the end of the same table, `grid_: 'showGrid'`. Writing `grid: 24` (the grid's pixel pitch) was answered with:

```
Did you mean `grid` -> `showGrid`?
```

`showGrid` is a boolean, so following that advice was rejected a second time. It now answers `grid` -> `gridSize`, and `gridSize: 24` parses. `visible` still covers the show/hide intent.

Three other tables carried a second spelling of a key they already had — `rollup`/`rollUp` on a field, `object_name`/`objectName` on a webhook, `strokeDasharray`/`strokeDashArray` on a chart series. Both spellings pointed at the same target there, so the overwrite changed nothing and no author could trip on it; the redundant entries are removed. Because the probe already folds case and separators, the surviving entry accepts every spelling the deleted one did — no authoring input changes meaning.

`alias-integrity.test.ts` now rejects any alias table containing two keys that share a probe, judged with the real `aliasProbe` rather than a copy of it, so this class cannot come back.
