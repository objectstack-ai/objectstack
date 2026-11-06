---
'@objectstack/spec': patch
---

fix(spec): the liveness ledger grades an app page's `record` binding `live`, citing the console reader for each of its keys

Clause-②: no
Metadata-protocol: none

- `liveness/page.json` graded `record` and every key under it `planned`, with the note that nothing read a page-level `record` yet. The console now reads it: an app page's binding is read once per page open as the first row under `sort`, and every component's `visibleWhen` sees that row as `record`. `record` and every key under it (`object`, `view`, `filter` with `field` / `operator` / `value`, `sort` with `field` / `order`) are now `live`, each citing the code that reads it.
- Nothing to do on upgrade: only the shipped `liveness/page.json` grades and evidence text change. No key, schema shape or export changes.
