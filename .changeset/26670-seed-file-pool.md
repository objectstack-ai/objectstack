---
'@objectstack/metadata-protocol': patch
---

Clause-②: no
Metadata-protocol: none

A seed that stores many `seedFile(path)` values no longer starves the requests that arrive while it runs. On a synchronous driver (better-sqlite3, the wasm fallback) every step of a seed file's work — the `sys_file` row, the bytes, the claim that commits it — resolves as a microtask, so the claims the seed loader settled after each 200-row insert batch ran as one unbroken chain and a sign-in during a background boot seed waited seconds unread behind it. The connection pool was never the bottleneck; the event loop was. The loader now hands the event loop one turn after each row's files are stored and after each row's claim, and writes a dataset that carries seed files in insert batches of 20 rows instead of 200. Datasets without seed files are unchanged.
